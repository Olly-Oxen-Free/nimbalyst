/**
 * TeammateManager: manages the lifecycle, messaging, and state of managed teammates
 * spawned by the lead agent via query().
 *
 * Extracted from ClaudeCodeProvider to isolate the teammate subsystem.
 */

import { query, type SDKUserMessage, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterCommitProposalSettles } from '../commitProposalInFlight';
// Query interface not properly exported by SDK, so we define it inline
interface Query extends AsyncGenerator<SDKMessage, void> {
  streamInput(stream: AsyncIterable<any>): Promise<void>;
}
import path from 'path';
import fsp from 'fs/promises';
import os from 'os';
import { randomUUID } from 'node:crypto';
import { resolveClaudeConfigDir } from './claudeCode/claudeConfigDir';
import { raceNextChunkWithStallWatchdog, resolveStreamStallMs } from './claudeCode/streamStallWatchdog';
import type { TeammateOriginKind } from '../transcript/types';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManagedTeammate {
  teamName: string;
  name: string;
  agentId: string;       // "name@teamName"
  abort: AbortController;
  streamPromise: Promise<{ capturedSessionId: string | undefined; approvedShutdown: boolean }>;
  query: Query | null;   // Reference to the query object for streamInput() injection
  sessionId?: string;    // Latest captured SDK session ID (for streamInput payloads)
  color: string;
  agentType: string;
  model?: string;
  isBackgroundAgent: boolean;  // true for fire-and-forget background sub-agents (no team, no idle)
  wasResumed: boolean;         // true if this entry came from resumeIdleTeammate, not a fresh spawn
  startedAt: number;           // epoch ms when spawned
  lastActiveAt: number;        // epoch ms of most recent chunk
  toolCallCount: number;       // count of tool_use blocks observed
  cwd: string;                 // the directory this teammate actually spawned into
  // Carried from IdleTeammate.revivedFromTerminal -- see that field's doc comment.
  revivedFromTerminal?: boolean;
}

export interface IdleTeammate {
  teamName: string;
  name: string;
  sessionId: string;     // SDK session ID for resume
  agentType: string;
  model: string | undefined;
  color: string;
  cwd: string;
  prompt: string;        // original prompt
  startedAt?: number;    // epoch ms when originally spawned (preserved across idle)
  toolCallCount?: number; // count of tool_use blocks observed during the run that just finished
  lastActiveAt?: number;  // epoch ms of most recent chunk during that run
  // True when this entry came from rehydrateIdleTeammate's terminal-status
  // branch (isRevivalEligible's completed/errored path), not its always-allowed
  // non-terminal (idle/running/blocked) branch. Distinguishes a genuine PRD 003
  // "resumed teammate died again" failure from a PRD 008 "revival attempt
  // failed" one downstream in handleStreamError -- they need different wording
  // and a different persisted chunk type.
  revivedFromTerminal?: boolean;
  // Narrower than revivedFromTerminal: true only when the row's endReason was
  // 'user-shutdown', i.e. the teammate ended through an approved shutdown
  // handshake. Resuming such a session replays that handshake as history, so
  // the resume is seeded with a grounding turn (see streamTeammateOutput).
  // A lead-abandoned or finished row is not grounded -- there is no stale
  // shutdown for the model to react to.
  revivedFromShutdown?: boolean;
}

/**
 * Why a teammate went terminal. Read sites (2a's revival gate, 3a's UI) must
 * default a missing value to 'finished' -- rows written before this field
 * existed have no value here at all.
 */
export type TeammateEndReason = 'finished' | 'user-shutdown' | 'lead-abandoned' | 'errored';

/**
 * Thrown by `rehydrateIdleTeammate` when the cwd it would resume a teammate
 * into (the row's own persisted `cwd`, or the legacy `lastUsedCwd`/`process.cwd()`
 * fallback for rows written before that field existed) no longer exists on
 * disk -- e.g. a worktree cleaned up after the teammate went idle. Distinct
 * from `rehydrateIdleTeammate` returning `undefined`, which means "nothing to
 * resume" (no row, no session id, or a terminal status), not "found it, but
 * its directory is gone". Consumed by 2b's no-live-lead delivery path.
 */
export class TeammateCwdMissingError extends Error {
  constructor(public readonly agentId: string, public readonly cwd: string) {
    super(`Teammate "${agentId}"'s working directory no longer exists: ${cwd}`);
    this.name = 'TeammateCwdMissingError';
  }
}

/**
 * A teammate row as it sits in the lead session's `currentTeammates` metadata.
 * Every field is optional: rows written before a field existed keep their old
 * shape, and nothing validates them on the way back in.
 */
interface PersistedTeammateRow {
  agentId?: string;
  name?: string;
  teamName?: string;
  agentType?: string;
  status?: string;
  model?: string;
  startedAt?: number;
  sessionId?: string;
  toolCallCount?: number;
  endReason?: TeammateEndReason;
  endedAt?: number;
  /**
   * The directory this teammate actually spawned into. Absent on rows written
   * before this field existed -- read sites (rehydrateIdleTeammate) must fall
   * back to the pre-existing lastUsedCwd/process.cwd() chain for those rows.
   */
  cwd?: string;
}

/**
 * What `scheduleEmitTeammateUpdate`/`emitTeammateUpdate` carry per agentId for
 * a status transition. `endReason`/`endedAt` are only present for a terminal
 * transition ('completed' | 'errored') -- a non-terminal override (e.g.
 * 'running', 'blocked', 'idle') must omit them so the writer never stamps a
 * stray `endReason` on a still-active row.
 */
interface TeammateStatusOverride {
  status: 'running' | 'blocked' | 'completed' | 'errored' | 'idle';
  endReason?: TeammateEndReason;
  endedAt?: number;
  /**
   * Only set for the 'completed'/'finished' transition (handleStreamCompletion's
   * else-branch): by the time this override reaches emitTeammateUpdate, the
   * teammate's own ManagedTeammate entry has already been deleted, so
   * activityFields can no longer pull a captured sessionId off it. Without this,
   * the row silently loses a sessionId it had already captured, and the
   * revival-compose UI (teammateComposeMode) treats the row as fully inactive.
   */
  sessionId?: string;
}

/**
 * Lead-derived config a host send carries, so a teammate can be resumed in a
 * process where the lead's own query never ran (i.e. after a restart) and
 * TeammateManager's `lastUsed*` fields are therefore unset.
 */
export interface TeammateResumeContext {
  cwd?: string;
  permissionsPath?: string;
  /**
   * The caller has explicitly confirmed reviving a teammate the user shut down
   * themselves. Without it those rows stay unrevivable, so a stray send can
   * never restart something the user deliberately stopped.
   */
  confirmedUserShutdown?: boolean;
}

export interface PendingMessage {
  recipient: string;
  content: string;
  summary: string;
  queuedAt: number;
}

/**
 * How a batch of teammates ended, carried on `teammates:allCompleted`.
 *
 * The event fires once no teammate is left, whatever killed them, so without
 * this the host cannot tell a finished team from a crashed one and greets both
 * with the completion chime.
 */
export type TeammatesCompletionOutcome = 'clean' | 'errored' | 'abandoned';

/**
 * Dependency interface injected by the host provider (ClaudeCodeProvider).
 * Keeps TeammateManager decoupled from BaseAIProvider / EventEmitter.
 */
export interface TeammateToLeadMessage {
  teammateName: string;
  teammateAgentId: string;
  content: string;
  summary: string;
  /**
   * What caused this delivery. Rides on the queue item (rather than being
   * derived from the formatted string) so the idle-lead path, which re-drains
   * this queue, keeps the right attribution for every entry in a batch.
   */
  kind: TeammateOriginKind;
}

/**
 * Dependency interface injected by the host provider (ClaudeCodeProvider).
 * Keeps TeammateManager decoupled from BaseAIProvider / EventEmitter.
 */
export interface TeammateManagerDeps {
  logNonBlocking(sessionId: string, source: string, direction: 'input' | 'output', content: string, metadata?: Record<string, unknown>): void;
  emit(event: string, payload: any): void;
  createPreToolUseHook(cwd: string, sessionId: string | undefined, permissionsPath: string | undefined, context: { isTeammateSession: boolean }): any;
  createPostToolUseHook(cwd: string, sessionId: string | undefined): any;
  getAbortSignal(): AbortSignal | undefined;
  /**
   * Interrupt the lead agent and deliver a teammate message.
   *
   * `sessionId` is threaded in explicitly rather than left to the provider's
   * `lastUsedSessionId`, which is only set while a live lead query is streaming
   * -- the same gap `stopByAgentId`'s `leadSessionId` parameter exists to close.
   * Without it, a wake raised for a lead whose query never ran in this process
   * emits an event with no session to deliver to.
   */
  interruptWithMessage(message: string, sessionId?: string): Promise<void>;
  /**
   * Whether the lead currently has a live turn (mid-turn, or an idle wake
   * already in flight) for `interruptWithMessage` to land on. Used to decide
   * whether a revival failure needs its own desktop notification: when the
   * lead is idle, `interruptWithMessage`'s idle branch re-triggers a fresh
   * `sendMessage` turn, but that happens silently -- nothing tells the user
   * a revival failed unless they reopen this session. Optional so hosts/tests
   * that never touch revival delivery don't need to stub it; treated as "idle"
   * (false) when absent.
   */
  isLeadBusy?(): boolean;
  /** Create a canUseTool handler that delegates to the lead's permission system */
  createCanUseToolHandler(
    sessionId: string | undefined,
    workspacePath: string,
    permissionsPath: string | undefined,
    teammateName?: string,
    /** The teammate query's own SDK permission mode; it does not follow the lead's */
    queryPermissionMode?: 'plan' | 'auto' | 'default',
  ): (toolName: string, input: any, options: { signal: AbortSignal; toolUseID?: string }) =>
    Promise<{ behavior: 'allow' | 'deny'; updatedInput?: any; message?: string }>;
}

/**
 * Packaged-build options for spawning Claude Code subprocesses.
 * In production Electron builds, the SDK needs environment and binary path
 * configuration since the native binary lives inside asar-unpacked.
 */
export interface PackagedBuildOptions {
  env: Record<string, string | undefined>;
  pathToClaudeCodeExecutable?: string;
}

// ─── Class ──────────────────────────────────────────────────────────────────

export class TeammateManager {
  // ── State ─────────────────────────────────────────────────────────────────

  private managedTeammates: Map<string, ManagedTeammate> = new Map();
  private idleTeammates: Map<string, IdleTeammate> = new Map();
  private completedTeammates: Set<string> = new Set();  // agentIds
  private currentTeamContext?: string;

  // Permission requestId -> agentId of the teammate parked on it. Written when
  // ToolPermissionService announces a prompt that names a teammate, read to
  // release the right one on resolution and to keep `blocked` sticky across
  // unrelated emits (see emitTeammateUpdate).
  private blockedTeammatesByRequest: Map<string, string> = new Map();

  // Worst thing that happened to the current batch of teammates. Reset by the
  // teammates:allCompleted emit, which only fires once the batch is empty, so a
  // teammate that crashed early is still reported when a later sibling is the
  // one that finishes the batch.
  private batchOutcome: TeammatesCompletionOutcome = 'clean';

  private pendingLeadMessages: Map<string, PendingMessage[]> = new Map();
  private pendingLeadMessageFlushes: Set<string> = new Set();

  // agentId -> timer holding an approved shutdown_request during its grace
  // period. Only populated when `shutdownGraceMs` > 0; a new message for the
  // same agentId clears the timer so the teammate stays alive.
  private pendingShutdowns: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // tool_use_ids of shutdown_request SendMessage calls already handled by handlePreToolUse
  // (resumed idle teammate for approval handshake). processTeammateToolResult must skip these.
  private handledShutdownToolUseIds: Set<string> = new Set();

  // Queue of teammate messages waiting to be delivered to the lead agent
  private pendingTeammateToLeadMessages: TeammateToLeadMessage[] = [];

  private static readonly MAX_COMPLETED_TEAMMATES = 100;
  private static readonly TEAMMATE_COLORS = ['blue', 'green', 'yellow', 'purple'];
  /** Persisted non-terminal statuses a teammate can always be resumed from after a restart. */
  private static readonly RESUMABLE_PERSISTED_STATUSES = new Set(['idle', 'running', 'blocked']);
  /** How long after it ended a terminal teammate stays revivable. */
  private static readonly REVIVAL_ELIGIBILITY_WINDOW_MS = 24 * 60 * 60 * 1000;
  /** Prepended to a resume whose session ended in an approved shutdown handshake. */
  private static readonly REVIVAL_GROUNDING_MESSAGE =
    'You have been revived by the user after a prior shutdown. The previous shutdown request is ' +
    'no longer active -- respond to what follows as a fresh instruction.';
  private teammateColorIndex: number = 0;
  private bgAgentCounter: number = 0;
  private subAgentCounter: number = 0;

  // Debounce state for emitTeammateUpdate
  private pendingStatusOverrides: Map<string, TeammateStatusOverride> = new Map();
  private pendingEmitSessionId?: string;
  private emitDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Packaged-build options set by ClaudeCodeProvider for production Electron builds */
  packagedBuildOptions?: PackagedBuildOptions;

  /**
   * Whether agent teams are enabled for this session, set by ClaudeCodeProvider.
   * Gates the name-only spawn path: under the implicit-team SDK protocol a bare
   * `name` is not by itself teams-specific, so it needs an explicit opt-in. A
   * legacy `team_name` implies teams are active and needs no flag.
   */
  enableAgentTeams?: boolean;

  /**
   * How long a `shutdown_request` is held before it is actually delivered, set
   * per-turn by ClaudeCodeProvider from the per-workspace setting. 0 (the
   * default) executes immediately, exactly as before the grace period existed.
   */
  shutdownGraceMs: number = 0;
  private static readonly EMIT_DEBOUNCE_MS = 100;

  /** Captured from lead's sendMessage() for teammate spawning. */
  lastUsedCwd?: string;
  lastUsedSessionId?: string;
  lastUsedPermissionsPath?: string;

  constructor(private readonly deps: TeammateManagerDeps) {}

  // ─── Teammate-to-lead message queue ────────────────────────────────────

  /** Check if any teammate messages are waiting to be delivered to the lead. */
  hasPendingTeammateMessages(): boolean {
    return this.pendingTeammateToLeadMessages.length > 0;
  }

  /** Remove and return the next pending teammate-to-lead message (FIFO). */
  drainNextTeammateMessage(): TeammateToLeadMessage | undefined {
    return this.pendingTeammateToLeadMessages.shift();
  }

  /** Re-queue a message at the front (used when streamInput fails). */
  requeueTeammateMessage(msg: TeammateToLeadMessage): void {
    this.pendingTeammateToLeadMessages.unshift(msg);
  }

  /** Check if any managed teammates are currently running (not idle). */
  hasRunningTeammates(): boolean {
    return this.managedTeammates.size > 0;
  }

  /** Check if any teammates are active (running or idle). */
  hasActiveTeammates(): boolean {
    return this.managedTeammates.size > 0 || this.idleTeammates.size > 0;
  }

  /** Check if all active agents are background-only (sub-agents or background agents, no idle teammates). */
  hasOnlyBackgroundAgents(): boolean {
    if (this.idleTeammates.size > 0) return false;
    if (this.managedTeammates.size === 0) return false;
    for (const tm of this.managedTeammates.values()) {
      if (!tm.isBackgroundAgent) return false;
    }
    return true;
  }

  /** Get count of active agents (running + idle). */
  getActiveAgentCount(): number {
    return this.managedTeammates.size + this.idleTeammates.size;
  }

  /**
   * Record that the current batch ended badly. An outright error outranks an
   * abandon: it is the more specific thing to tell the user about.
   */
  private recordBatchFailure(outcome: Exclude<TeammatesCompletionOutcome, 'clean'>): void {
    if (this.batchOutcome === 'errored') return;
    this.batchOutcome = outcome;
  }

  /**
   * Announce that no teammate is left and open a fresh batch. Every caller has
   * already checked `hasActiveTeammates()`, which is what makes resetting here
   * the batch boundary.
   */
  private emitAllCompleted(sessionId: string | undefined): void {
    const outcome = this.batchOutcome;
    this.batchOutcome = 'clean';
    console.log(`[MANAGED-TEAMMATE] All teammates finished (${outcome}), emitting teammates:allCompleted`);
    this.deps.emit('teammates:allCompleted', { sessionId, outcome });
  }

  /**
   * Abandon all idle teammates (mark completed, clear from idle map).
   * Called when the lead's transport dies and idle teammates can no longer
   * be resumed. Emits teammates:allCompleted if no running teammates remain.
   */
  abandonIdleTeammates(sessionId: string | undefined): void {
    if (this.idleTeammates.size === 0) return;

    const overrides = new Map<string, TeammateStatusOverride>();
    for (const agentId of this.idleTeammates.keys()) {
      this.markCompleted(agentId);
      this.clearPendingMessages(agentId);
      overrides.set(agentId, { status: 'completed', endReason: 'lead-abandoned', endedAt: Date.now() });
      console.log(`[MANAGED-TEAMMATE] Abandoning idle teammate "${agentId}" (lead transport dead)`);
    }
    this.idleTeammates.clear();
    this.recordBatchFailure('abandoned');

    this.scheduleEmitTeammateUpdate(sessionId, overrides);

    if (!this.hasActiveTeammates()) {
      this.emitAllCompleted(sessionId);
    }
  }

  /**
   * Create an async iterable yielding a single SDKUserMessage.
   * Public so ClaudeCodeProvider can use it for streamInput injection.
   */
  createInjectedUserMessageStream(content: string): AsyncIterable<SDKUserMessage> {
    const payload: SDKUserMessage = {
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      parent_tool_use_id: null,
      session_id: '',  // Populated by SDK on delivery
    };
    async function* stream() {
      yield payload;
    }
    return stream();
  }

  /**
   * Seed a resume with a grounding turn ahead of the real prompt. Resuming a
   * session that ended in an approved shutdown handshake replays that handshake
   * as history, and the model's next generation answers the stale shutdown
   * instead of the new instruction ("I've already sent the shutdown response...").
   */
  private createGroundedRevivalPromptStream(prompt: string): AsyncIterable<SDKUserMessage> {
    const parts = [
      this.createInjectedUserMessageStream(TeammateManager.REVIVAL_GROUNDING_MESSAGE),
      this.createInjectedUserMessageStream(prompt),
    ];
    async function* stream() {
      for (const part of parts) yield* part;
    }
    return stream();
  }

  private markCompleted(agentId: string): void {
    // A teammate that reached a terminal state has nothing left to shut down.
    this.cancelPendingShutdown(agentId);
    this.completedTeammates.add(agentId);
    while (this.completedTeammates.size > TeammateManager.MAX_COMPLETED_TEAMMATES) {
      const oldest = this.completedTeammates.values().next().value;
      if (oldest !== undefined) {
        this.completedTeammates.delete(oldest);
      } else {
        break;
      }
    }
  }

  // ─── Name / ID helpers ──────────────────────────────────────────────────

  /**
   * Sanitize a team or teammate name to prevent path traversal.
   */
  sanitizeName(name: string, type: 'team' | 'teammate'): string {
    if (!name || typeof name !== 'string') {
      throw new Error(`${type} name must be a non-empty string`);
    }

    const sanitized = name
      .replace(/[\/\\]/g, '')
      .replace(/\.\./g, '')
      .replace(/^\.+/, '')
      .trim();

    if (!/^[a-zA-Z0-9_-]+$/.test(sanitized)) {
      throw new Error(
        `Invalid ${type} name: "${name}". Must contain only letters, numbers, hyphens, and underscores.`
      );
    }

    if (sanitized.length > 100) {
      throw new Error(`${type} name too long (max 100 characters): "${name}"`);
    }

    return sanitized;
  }

  private sanitizeTeamNameOrUndefined(teamName: unknown): string | undefined {
    if (typeof teamName !== 'string' || !teamName.trim()) {
      return undefined;
    }
    try {
      return this.sanitizeName(teamName.trim(), 'team');
    } catch {
      return undefined;
    }
  }

  /**
   * Extract the teammate name from an agentId ("name@teamName").
   */
  extractAgentName(agentId: string): string | null {
    const atIndex = agentId.indexOf('@');
    if (atIndex <= 0) return null;
    return agentId.substring(0, atIndex);
  }

  /**
   * Extract the team name from an agentId ("name@teamName").
   */
  extractTeamName(agentId: string): string | null {
    const atIndex = agentId.indexOf('@');
    if (atIndex <= 0) return null;
    return agentId.substring(atIndex + 1);
  }

  /**
   * Check if an agentId matches a recipient name (with optional team qualification).
   */
  agentIdMatchesRecipient(agentId: string, recipient: string, preferredTeam?: string): boolean {
    const name = this.extractAgentName(agentId);
    if (!name) return false;

    if (recipient.includes('@')) {
      return agentId === recipient;
    }

    if (name === recipient) {
      if (preferredTeam) {
        const team = this.extractTeamName(agentId);
        return team === preferredTeam;
      }
      return true;
    }

    return false;
  }

  private collectUniqueTeamNames(agentIds: Iterable<string>): string[] {
    const teams = new Set<string>();
    for (const agentId of agentIds) {
      const team = this.extractTeamName(agentId);
      if (team === '_background' || team === '_subagent') continue;  // Skip background/plain sub-agents
      const sanitized = this.sanitizeTeamNameOrUndefined(team);
      if (sanitized) {
        teams.add(sanitized);
      }
    }
    return [...teams];
  }

  // ─── Team context resolution ────────────────────────────────────────────

  private resolveTeamContextFromTrackedTeammates(): string | undefined {
    const activeTeams = [
      ...this.collectUniqueTeamNames(this.managedTeammates.keys()),
      ...this.collectUniqueTeamNames(this.idleTeammates.keys()),
    ];
    const uniqueActiveTeams = [...new Set(activeTeams)];
    if (uniqueActiveTeams.length === 1) {
      return uniqueActiveTeams[0];
    }

    if (uniqueActiveTeams.length === 0) {
      const completedTeams = this.collectUniqueTeamNames(this.completedTeammates.values());
      if (completedTeams.length === 1) {
        return completedTeams[0];
      }
    }

    return undefined;
  }

  private async resolveTeamContextFromSessionMetadata(sessionId?: string): Promise<string | undefined> {
    if (!sessionId) {
      return undefined;
    }

    try {
      const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(sessionId);
      const metadata = session?.metadata as any;

      const storedTeamContext = this.sanitizeTeamNameOrUndefined(metadata?.currentTeamContext);
      if (storedTeamContext) {
        return storedTeamContext;
      }

      const teammates = Array.isArray(metadata?.currentTeammates) ? metadata.currentTeammates : [];
      if (teammates.length === 0) {
        return undefined;
      }

      const runningOrIdle = teammates.filter((tm: any) => tm?.status === 'running' || tm?.status === 'idle');
      const runningOrIdleTeams: string[] = Array.from(new Set(
        runningOrIdle
          .map((tm: any) => this.sanitizeTeamNameOrUndefined(tm?.teamName))
          .filter((team: string | undefined): team is string => typeof team === 'string' && team.length > 0)
      ));

      if (runningOrIdleTeams.length === 1) {
        return runningOrIdleTeams[0];
      }

      const allTeams: string[] = Array.from(new Set(
        teammates
          .map((tm: any) => this.sanitizeTeamNameOrUndefined(tm?.teamName))
          .filter((team: string | undefined): team is string => typeof team === 'string' && team.length > 0)
      ));

      if (allTeams.length === 1) {
        return allTeams[0];
      }

      for (let i = teammates.length - 1; i >= 0; i--) {
        const candidate = this.sanitizeTeamNameOrUndefined(teammates[i]?.teamName);
        if (candidate) {
          return candidate;
        }
      }
    } catch (error) {
      console.warn('[TEAM-CONTEXT] Failed to resolve team context from session metadata:', error);
    }

    return undefined;
  }

  private async resolveTeamContextFromClaudeDirectories(): Promise<string | undefined> {
    try {
      const teamRoot = path.join(resolveClaudeConfigDir(), 'teams');
      try {
        await fsp.access(teamRoot);
      } catch {
        return undefined;
      }

      const dirEntries = await fsp.readdir(teamRoot, { withFileTypes: true });
      const entries = dirEntries
        .filter(entry => entry.isDirectory())
        .map(entry => this.sanitizeTeamNameOrUndefined(entry.name))
        .filter((team: string | undefined): team is string => Boolean(team));

      if (entries.length === 1) {
        return entries[0];
      }
    } catch (error) {
      console.warn('[TEAM-CONTEXT] Failed to resolve team context from ~/.claude/teams:', error);
    }

    return undefined;
  }

  async resolveTeamContext(sessionId?: string): Promise<string | undefined> {
    const existing = this.sanitizeTeamNameOrUndefined(this.currentTeamContext);
    if (existing) {
      return existing;
    }

    const fromTracked = this.resolveTeamContextFromTrackedTeammates();
    if (fromTracked) {
      this.currentTeamContext = fromTracked;
      console.log(`[TEAM-CONTEXT] Rehydrated team context from teammate state: "${fromTracked}"`);
      return fromTracked;
    }

    const fromMetadata = await this.resolveTeamContextFromSessionMetadata(sessionId);
    if (fromMetadata) {
      this.currentTeamContext = fromMetadata;
      console.log(`[TEAM-CONTEXT] Rehydrated team context from session metadata: "${fromMetadata}"`);
      return fromMetadata;
    }

    const fromDirectories = await this.resolveTeamContextFromClaudeDirectories();
    if (fromDirectories) {
      this.currentTeamContext = fromDirectories;
      console.log(`[TEAM-CONTEXT] Rehydrated team context from ~/.claude/teams: "${fromDirectories}"`);
      return fromDirectories;
    }

    return undefined;
  }

  /**
   * Build a stable session-scoped team name for a spawn that supplied none.
   * Pre-normalized to sanitizeName's charset, which throws rather than normalizes.
   */
  private synthesizeTeamName(sessionId?: string): string {
    const slug = (sessionId ?? '').slice(0, 8).replace(/[^a-zA-Z0-9_-]/g, '');
    return slug ? `team-${slug}` : 'team';
  }

  /**
   * Resolve the team a name-only spawn belongs to, synthesizing only as a last
   * resort. A resumed session has a real team in its context or rehydratable
   * state; synthesizing over it would change every agentId's `@team` suffix and
   * make already-spawned teammates unreachable via SendMessage's bare-name
   * routing (see agentIdMatchesRecipient's preferredTeam branch).
   */
  private async resolveTeamNameForSpawn(sessionId?: string): Promise<string> {
    const current = this.sanitizeTeamNameOrUndefined(this.currentTeamContext);
    if (current) return current;

    const resolved = await this.resolveTeamContext(sessionId);
    if (resolved) return resolved;

    const synthesized = this.synthesizeTeamName(sessionId);
    console.log(`[TEAM-CONTEXT] No team context for this session; synthesized "${synthesized}"`);
    return synthesized;
  }

  // ─── Team context from tool results ─────────────────────────────────────

  // legacy (explicit-team protocol, SDK <0.3.x): parses TeamCreate tool
  // results; no TeamCreate tool exists in SDK 0.3.221's tool surface.
  /**
   * Extract team name from TeamCreate tool result content.
   */
  extractTeamNameFromToolResult(toolResult: unknown): string | undefined {
    if (!toolResult) return undefined;

    if (typeof toolResult === 'object' && !Array.isArray(toolResult)) {
      const obj = toolResult as Record<string, unknown>;
      if (typeof obj.team_name === 'string' && obj.team_name.trim()) {
        return obj.team_name.trim();
      }
      if (typeof obj.teamName === 'string' && obj.teamName.trim()) {
        return obj.teamName.trim();
      }
      if (typeof obj.text === 'string') {
        const fromText = this.extractTeamNameFromToolResult(obj.text);
        if (fromText) return fromText;
      }
      if (obj.data) {
        const fromData = this.extractTeamNameFromToolResult(obj.data);
        if (fromData) return fromData;
      }
      if (obj.content) {
        const fromContent = this.extractTeamNameFromToolResult(obj.content);
        if (fromContent) return fromContent;
      }
    }

    if (Array.isArray(toolResult)) {
      for (const item of toolResult) {
        const fromItem = this.extractTeamNameFromToolResult(item);
        if (fromItem) return fromItem;
      }
      return undefined;
    }

    if (typeof toolResult === 'string') {
      const trimmed = toolResult.trim();
      if (!trimmed) return undefined;

      try {
        const parsed = JSON.parse(trimmed);
        const fromParsed = this.extractTeamNameFromToolResult(parsed);
        if (fromParsed) return fromParsed;
      } catch {
        // fall through to regex
      }

      const jsonMatch = trimmed.match(/"team_name"\s*:\s*"([^"]+)"/);
      if (jsonMatch?.[1]) {
        return jsonMatch[1];
      }

      const leadAgentMatch = trimmed.match(/team-lead@([a-zA-Z0-9_-]+)/);
      if (leadAgentMatch?.[1]) {
        return leadAgentMatch[1];
      }

      // Not anchored on `.claude/`: CLAUDE_CONFIG_DIR can put teams/ under any
      // directory name, so match on the teams/<name>/config.json tail instead.
      const configPathMatch = trimmed.match(/teams[\/\\]([a-zA-Z0-9_-]+)[\/\\]config\.json/);
      if (configPathMatch?.[1]) {
        return configPathMatch[1];
      }

      const cleanupMatch = trimmed.match(/Cleaned up directories and worktrees for team\s+"([a-zA-Z0-9_-]+)"/i);
      if (cleanupMatch?.[1]) {
        return cleanupMatch[1];
      }
    }

    return undefined;
  }

  /**
   * Update/clear the current team context based on TeamCreate/TeamDelete results.
   */
  updateTeamContextFromToolResult(
    toolName: string,
    toolArgs: Record<string, unknown> | undefined,
    toolResult: unknown,
    isError: boolean,
  ): void {
    if (toolName === 'TeamCreate' && !isError) {
      const resultTeamName = this.extractTeamNameFromToolResult(toolResult);
      const candidateTeam = resultTeamName || (typeof toolArgs?.team_name === 'string' ? toolArgs.team_name : undefined);
      if (!candidateTeam) return;

      try {
        const sanitized = this.sanitizeName(candidateTeam, 'team');
        this.currentTeamContext = sanitized;
        console.log(`[TEAM-CONTEXT] Set current team context to "${sanitized}"`);
      } catch (error) {
        console.warn('[TEAM-CONTEXT] Ignoring invalid TeamCreate team name in result:', candidateTeam, error);
      }
      return;
    }

    if (toolName === 'TeamDelete' && !isError) {
      const deletedTeam = this.extractTeamNameFromToolResult(toolResult) || (typeof toolArgs?.team_name === 'string' ? toolArgs.team_name : undefined);
      const sanitizedDeletedTeam = this.sanitizeTeamNameOrUndefined(deletedTeam);
      if (!sanitizedDeletedTeam) {
        console.warn('[TEAM-CONTEXT] TeamDelete returned without a resolvable team name; preserving current context');
        return;
      }

      if (!this.currentTeamContext || this.currentTeamContext === sanitizedDeletedTeam) {
        console.log(`[TEAM-CONTEXT] Cleared current team context (deleted "${sanitizedDeletedTeam}")`);
        this.currentTeamContext = undefined;
      } else {
        console.log(
          `[TEAM-CONTEXT] TeamDelete removed "${sanitizedDeletedTeam}" but current context is "${this.currentTeamContext}", preserving current context`
        );
      }
    }
  }

  // ─── Synthetic logging ──────────────────────────────────────────────────

  /**
   * Log a synthetic tool_use + tool_result pair to the session transcript.
   */
  private logSyntheticToolPair(
    sessionId: string | undefined,
    toolUseId: string,
    toolName: string,
    toolInput: any,
    resultContent: any,
    useMessageType?: string
  ): void {
    if (!sessionId) return;

    this.deps.logNonBlocking(
      sessionId,
      'claude-code',
      'output',
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: toolUseId,
            name: toolName,
            input: toolInput,
          }]
        },
        parent_tool_use_id: null,
      }),
      { messageType: useMessageType ? `${useMessageType}_use` : 'synthetic_tool_use' }
    );

    this.deps.logNonBlocking(
      sessionId,
      'claude-code',
      'output',
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: typeof resultContent === 'string'
              ? resultContent
              : JSON.stringify(resultContent)
          }]
        },
        parent_tool_use_id: null,
      }),
      { messageType: useMessageType ? `${useMessageType}_result` : 'synthetic_tool_result' }
    );
  }

  // ─── Team config file I/O ──────────────────────────────────────────────

  private async updateTeamConfig(
    teamName: string,
    agentId: string,
    name: string,
    agentType: string,
    model: string | undefined,
    cwd: string,
    prompt: string,
    color: string
  ): Promise<void> {
    try {
      const sanitizedTeamName = this.sanitizeName(teamName, 'team');
      const sanitizedName = this.sanitizeName(name, 'teammate');

      const teamConfigPath = path.join(resolveClaudeConfigDir(), 'teams', sanitizedTeamName, 'config.json');
      const teamDir = path.dirname(teamConfigPath);

      await fsp.mkdir(teamDir, { recursive: true });

      const inboxesDir = path.join(teamDir, 'inboxes');
      await fsp.mkdir(inboxesDir, { recursive: true });

      const inboxPath = path.join(inboxesDir, `${sanitizedName}.json`);
      try {
        await fsp.access(inboxPath);
      } catch {
        await fsp.writeFile(inboxPath, JSON.stringify({ messages: [] }, null, 2));
      }

      const configLockPath = teamConfigPath + '.lock';
      const result = await this.withSimpleFileLock(configLockPath, async () => {
        let config: any;

        let configExists = false;
        try {
          await fsp.access(teamConfigPath);
          configExists = true;
        } catch { /* does not exist */ }

        if (configExists) {
          const configContent = await fsp.readFile(teamConfigPath, 'utf-8');
          config = JSON.parse(configContent);

          const existingMember = config.members?.find((m: any) => m.agentId === agentId);
          if (existingMember) {
            console.log(`[TEAM-CONFIG] Teammate "${agentId}" already registered in team config`);
            return;
          }

          if (!config.members) {
            config.members = [];
          }

          config.members.push({
            agentId,
            name,
            agentType,
            model: model || 'haiku',
            color,
            planModeRequired: false,
            joinedAt: Date.now(),
            tmuxPaneId: 'in-process',
            cwd,
            subscriptions: [],
            prompt,
            backendType: 'in-process',
          });
        } else {
          console.warn(`[TEAM-CONFIG] Creating new team config for "${teamName}" - this should have been created by TeamCreate`);
          config = {
            name: teamName,
            description: '',
            createdAt: Date.now(),
            leadAgentId: `team-lead@${teamName}`,
            members: [{
              agentId,
              name,
              agentType,
              model: model || 'haiku',
              color,
              planModeRequired: false,
              joinedAt: Date.now(),
              tmuxPaneId: 'in-process',
              cwd,
              subscriptions: [],
              prompt,
              backendType: 'in-process',
            }],
          };
        }

        const tmpPath = teamConfigPath + '.tmp';
        await fsp.writeFile(tmpPath, JSON.stringify(config, null, 2));
        await fsp.rename(tmpPath, teamConfigPath);
        console.log(`[TEAM-CONFIG] Registered teammate "${agentId}" in team config at ${teamConfigPath}`);
      });

      if (result === null) {
        console.warn(`[TEAM-CONFIG] Timed out acquiring config lock for team "${teamName}" - teammate "${agentId}" not registered`);
      }
    } catch (error) {
      console.error(`[TEAM-CONFIG] Failed to update team config for "${agentId}":`, error);
    }
  }

  private async removeTeammateFromConfig(teamName: string, agentId: string): Promise<void> {
    try {
      const sanitizedTeamName = this.sanitizeName(teamName, 'team');

      const teamConfigPath = path.join(resolveClaudeConfigDir(), 'teams', sanitizedTeamName, 'config.json');

      try {
        await fsp.access(teamConfigPath);
      } catch {
        console.log(`[TEAM-CONFIG] No config file found for team "${teamName}" - nothing to remove`);
        return;
      }

      const configContent = await fsp.readFile(teamConfigPath, 'utf-8');
      const config = JSON.parse(configContent);

      if (!config.members || !Array.isArray(config.members)) {
        return;
      }

      const originalLength = config.members.length;
      config.members = config.members.filter((m: any) => m.agentId !== agentId);

      if (config.members.length < originalLength) {
        const tmpPath = teamConfigPath + '.tmp';
        await fsp.writeFile(tmpPath, JSON.stringify(config, null, 2));
        await fsp.rename(tmpPath, teamConfigPath);
        console.log(`[TEAM-CONFIG] Removed completed teammate "${agentId}" from team config`);
      } else {
        console.log(`[TEAM-CONFIG] Teammate "${agentId}" not found in team config members - already removed`);
      }
    } catch (error) {
      console.error(`[TEAM-CONFIG] Failed to remove teammate "${agentId}" from config:`, error);
    }
  }

  // ─── File lock utility ──────────────────────────────────────────────────

  private async withSimpleFileLock<T>(
    lockPath: string,
    action: () => Promise<T>,
    timeoutMs: number = 5000,
    retryDelayMs: number = 25,
  ): Promise<T | null> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      let fh: import('fs/promises').FileHandle | null = null;
      try {
        fh = await fsp.open(lockPath, 'wx');
        try {
          return await action();
        } finally {
          if (fh !== null) {
            try {
              await fh.close();
            } catch {
              // Ignore close errors
            }
          }
          try {
            await fsp.unlink(lockPath);
          } catch {
            // Ignore lock cleanup errors
          }
        }
      } catch (error: any) {
        const code = error?.code;
        if (code !== 'EEXIST') {
          throw error;
        }
        // Check for stale locks (e.g., process crashed while holding lock)
        try {
          const lockStat = await fsp.stat(lockPath);
          const lockAgeMs = Date.now() - lockStat.mtimeMs;
          if (lockAgeMs > 30000) {
            console.warn(`[FILE-LOCK] Removing stale lock at "${lockPath}" (age: ${Math.round(lockAgeMs / 1000)}s)`);
            try {
              await fsp.unlink(lockPath);
            } catch {
              // Another process may have cleaned it up
            }
          }
        } catch {
          // Lock file may have been removed between our check and stat
        }
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }

    return null;
  }

  // ─── Message helpers ────────────────────────────────────────────────────

  private buildShutdownRequestPrompt(requestId: string, messageFromLead?: string): string {
    const trimmedMessage = typeof messageFromLead === 'string' ? messageFromLead.trim() : '';
    const lines = [
      'The team lead sent you a shutdown request. You must process it now.',
      `request_id: ${requestId}`,
      trimmedMessage ? `lead_message: ${trimmedMessage}` : '',
      'Immediately call SendMessage with:',
      'type: "shutdown_response"',
      'recipient: "team-lead"',
      `request_id: "${requestId}"`,
      'approve: true',
      'content: "Shutting down now."',
      'After sending the shutdown_response, stop all work and exit.',
    ];
    return lines.filter(Boolean).join('\n');
  }

  // ─── Message delivery ───────────────────────────────────────────────────

  private queueLeadMessage(
    agentId: string,
    recipient: string,
    content: string,
    summary: string,
  ): number {
    const queue = this.pendingLeadMessages.get(agentId) || [];
    queue.push({
      recipient,
      content,
      summary,
      queuedAt: Date.now(),
    });
    this.pendingLeadMessages.set(agentId, queue);
    return queue.length;
  }

  private clearPendingMessages(agentId: string): void {
    this.pendingLeadMessages.delete(agentId);
    this.pendingLeadMessageFlushes.delete(agentId);
  }

  /**
   * Drop a shutdown still inside its grace period. Called from every path that
   * delivers a fresh message to a teammate -- that is the whole point of the
   * grace period: talking to a teammate again calls its shutdown off.
   *
   * Returns whether a pending shutdown was actually cancelled.
   */
  private cancelPendingShutdown(agentId: string): boolean {
    const timer = this.pendingShutdowns.get(agentId);
    if (!timer) return false;
    clearTimeout(timer);
    this.pendingShutdowns.delete(agentId);
    console.log(`[MANAGED-TEAMMATE] Cancelled pending shutdown for "${agentId}" -- a new message arrived during the grace period`);
    return true;
  }

  /**
   * Deliver an approved shutdown prompt to whichever state the teammate is in
   * *now*. State is re-resolved here rather than captured when the request came
   * in, because a running teammate can finish its turn and go idle (or be torn
   * down entirely) while the grace period is still counting down.
   */
  private async executeShutdown(
    agentId: string,
    recipient: string,
    shutdownPrompt: string,
    leadSessionId: string | undefined,
  ): Promise<void> {
    const running = this.managedTeammates.get(agentId);
    if (running) {
      const queueDepth = this.queueLeadMessage(agentId, recipient, shutdownPrompt, 'Shutdown request from lead');
      console.log(`[MANAGED-TEAMMATE] Queued shutdown request for running teammate "${recipient}" (agentId: ${agentId}, queueDepth=${queueDepth})`);
      try {
        await this.flushPendingMessages(agentId, running.query);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[MANAGED-TEAMMATE] Failed to flush shutdown request to "${recipient}":`, reason);
      }
      return;
    }

    const idle = this.idleTeammates.get(agentId);
    if (idle) {
      console.log(`[MANAGED-TEAMMATE] Shutdown request for idle teammate "${recipient}" - resuming for approval handshake`);
      this.resumeIdleTeammate(leadSessionId, agentId, idle, shutdownPrompt);
      return;
    }

    console.log(`[MANAGED-TEAMMATE] Shutdown for "${agentId}" is no longer deliverable - the teammate is neither running nor idle`);
  }

  /**
   * Run a shutdown now, or hold it for the configured grace period first.
   * With the default `shutdownGraceMs` of 0 this is the original inline call.
   */
  private async scheduleShutdown(
    agentId: string,
    recipient: string,
    shutdownPrompt: string,
    leadSessionId: string | undefined,
  ): Promise<void> {
    if (this.shutdownGraceMs <= 0) {
      await this.executeShutdown(agentId, recipient, shutdownPrompt, leadSessionId);
      return;
    }

    if (this.pendingShutdowns.has(agentId)) {
      console.log(`[MANAGED-TEAMMATE] Shutdown for "${agentId}" is already inside its grace period - not stacking another`);
      return;
    }

    console.log(`[MANAGED-TEAMMATE] Holding shutdown for "${agentId}" for ${this.shutdownGraceMs}ms before it executes`);
    const timer = setTimeout(() => {
      this.pendingShutdowns.delete(agentId);
      void this.executeShutdown(agentId, recipient, shutdownPrompt, leadSessionId);
    }, this.shutdownGraceMs);
    this.pendingShutdowns.set(agentId, timer);
  }

  private async appendToInbox(
    agentId: string,
    message: { content: string; summary: string; queuedAt: number },
  ): Promise<boolean> {
    try {
      const teammateName = this.extractAgentName(agentId);
      const rawTeamName = this.extractTeamName(agentId);
      const teamName = this.sanitizeTeamNameOrUndefined(rawTeamName);
      if (!teammateName || !teamName) {
        return false;
      }

      const sanitizedTeammateName = this.sanitizeName(teammateName, 'teammate');
      const inboxDir = path.join(resolveClaudeConfigDir(), 'teams', teamName, 'inboxes');
      const inboxPath = path.join(inboxDir, `${sanitizedTeammateName}.json`);
      const lockPath = `${inboxPath}.lock`;
      await fsp.mkdir(inboxDir, { recursive: true });

      const wrote = await this.withSimpleFileLock(lockPath, async () => {
        let inboxFile: any = [];
        let inboxArray: any[] = [];

        try {
          const raw = (await fsp.readFile(inboxPath, 'utf-8')).trim();
          if (raw.length > 0) {
            try {
              inboxFile = JSON.parse(raw);
              if (Array.isArray(inboxFile)) {
                inboxArray = inboxFile;
              } else if (inboxFile && Array.isArray(inboxFile.messages)) {
                inboxArray = inboxFile.messages;
              }
            } catch (parseError) {
              console.warn(`[MANAGED-TEAMMATE] Failed to parse inbox file "${inboxPath}", recreating:`, parseError);
              inboxFile = [];
              inboxArray = [];
            }
          }
        } catch (readError: any) {
          if (readError?.code !== 'ENOENT') throw readError;
          // File doesn't exist yet - start with empty arrays
        }

        inboxArray.push({
          from: 'team-lead',
          text: message.content,
          summary: message.summary || 'Message from lead',
          timestamp: new Date(message.queuedAt || Date.now()).toISOString(),
          read: false,
        });

        const nextInboxFile = Array.isArray(inboxFile)
          ? inboxArray
          : { ...inboxFile, messages: inboxArray };

        const tmpPath = `${inboxPath}.tmp-${process.pid}-${Date.now()}`;
        await fsp.writeFile(tmpPath, JSON.stringify(nextInboxFile, null, 2), 'utf-8');
        await fsp.rename(tmpPath, inboxPath);
        return true;
      });

      if (wrote === null) {
        console.warn(`[MANAGED-TEAMMATE] Timed out acquiring inbox lock for "${agentId}" at ${lockPath}`);
        return false;
      }

      return wrote;
    } catch (error) {
      console.warn(`[MANAGED-TEAMMATE] Failed to append message to inbox for "${agentId}":`, error);
      return false;
    }
  }

  private async flushPendingMessages(
    agentId: string,
    teammateQuery: Query | null,
  ): Promise<void> {
    const initialQueue = this.pendingLeadMessages.get(agentId);
    if (!initialQueue || initialQueue.length === 0) {
      return;
    }
    if (this.pendingLeadMessageFlushes.has(agentId)) {
      return;
    }

    this.pendingLeadMessageFlushes.add(agentId);
    try {
      while (true) {
        const queue = this.pendingLeadMessages.get(agentId);
        if (!queue || queue.length === 0) {
          break;
        }

        const nextMessage = queue[0];
        const formattedMessage = `[Message from team-lead]\n\n${nextMessage.content}`;

        if (teammateQuery && typeof teammateQuery.streamInput === 'function') {
          try {
            await teammateQuery.streamInput(this.createInjectedUserMessageStream(formattedMessage));
            queue.shift();
            console.log(`[MANAGED-TEAMMATE] Delivered queued message via streamInput to "${nextMessage.recipient}" (agentId: ${agentId}). Remaining queue=${queue.length}`);
            continue;
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            console.warn(`[MANAGED-TEAMMATE] streamInput delivery failed for "${nextMessage.recipient}" (agentId: ${agentId}); keeping queued for retry: ${reason}`);
          }
        }

        const appendedToInbox = await this.appendToInbox(agentId, nextMessage);
        if (appendedToInbox) {
          queue.shift();
          console.log(`[MANAGED-TEAMMATE] Delivered queued message via inbox for "${nextMessage.recipient}" (agentId: ${agentId}). Remaining queue=${queue.length}`);
          continue;
        }

        const streamAvailable = teammateQuery && typeof teammateQuery.streamInput === 'function';
        const reason = streamAvailable ? 'streamInput failed' : 'streamInput unavailable';
        console.warn(`[MANAGED-TEAMMATE] Pausing flush for "${nextMessage.recipient}" (agentId: ${agentId}); both delivery methods failed: ${reason}`);
        break;
      }
    } finally {
      const queue = this.pendingLeadMessages.get(agentId);
      if (queue && queue.length === 0) {
        this.pendingLeadMessages.delete(agentId);
      }
      this.pendingLeadMessageFlushes.delete(agentId);
    }
  }

  /**
   * Deliver a teammate's message to the lead agent.
   *
   * Queues the message internally and interrupts the lead agent so it can
   * process the message. Messages never enter the user-facing prompt queue.
   */
  private deliverMessageToLead(
    sessionId: string | undefined,
    teammateAgentId: string,
    teammateName: string,
    content: string,
    summary: string,
  ): void {
    if (sessionId) {
      const teammateMessageChunk = {
        type: 'teammate_message_to_lead',
        _isTeammateOutput: true,
        _teammateAgentId: teammateAgentId,
        _teammateName: teammateName,
        content,
        summary,
        timestamp: Date.now(),
      };
      this.deps.logNonBlocking(
        sessionId, 'claude-code', 'output',
        JSON.stringify(teammateMessageChunk),
        { messageType: 'teammate_message_to_lead' }
      );
      this.deps.emit('teammate:transcriptUpdated', { sessionId, agentId: teammateAgentId });
    }

    // Queue the message and interrupt the lead to process it
    this.pendingTeammateToLeadMessages.push({
      teammateName,
      teammateAgentId,
      content,
      summary,
      kind: 'wake-message',
    });

    // #1682: never interrupt the lead mid-commit; the message stays queued until the call settles.
    afterCommitProposalSettles(sessionId, () => this.deps.interruptWithMessage(`[Teammate message from "${teammateName}"]\n\n${content}`, sessionId)).catch(err => {
      console.warn(`[MANAGED-TEAMMATE] Failed to interrupt lead with teammate message:`, err);
    });

    this.deps.emit('message:logged', {
      sessionId,
      direction: 'output' as const,
    });
  }

  /**
   * Deliver a revival failure (a completed/errored teammate that PRD 008's
   * widened gate admitted into resumeIdleTeammate, but the resume itself never
   * completed) to the lead's conversation -- called from `handleStreamError`
   * (a resume that started but then died) and from `sendMessageFromHost` (a
   * resume that never started at all, e.g. `TeammateCwdMissingError`).
   *
   * Deliberately NOT a fork of `deliverMessageToLead`: same persisted-write +
   * interrupt shape, but a distinct `'revival_failed'` chunk type so the
   * transcript renders "revival failed", not the generic "message from
   * teammate" wording -- and so `ClaudeCodeRawParser` needs its own dedicated
   * branch rather than accidentally reusing (and thus polluting) the meaning
   * of `'teammate_message_to_lead'`.
   *
   * Both halves are best-effort and must not throw: a revival failure racing
   * the session closing mid-attempt should not itself crash anything.
   */
  private deliverRevivalFailure(
    sessionId: string | undefined,
    teammateAgentId: string,
    teammateName: string,
    reason: string,
  ): void {
    const content = `Reviving teammate "${teammateName}" failed: ${reason}`;
    const summary = `${teammateName} revival failed`;

    // Captured before interruptWithMessage runs: its idle branch synchronously
    // latches isLeadBusy() true (teammateIdleMessagePending) as soon as it fires,
    // so checking afterward would always read "busy" and the notification below
    // would never fire for the exact case it exists for.
    const leadWasBusy = this.deps.isLeadBusy?.() ?? false;

    if (sessionId) {
      const revivalFailureChunk = {
        type: 'revival_failed',
        _isTeammateOutput: true,
        _teammateAgentId: teammateAgentId,
        _teammateName: teammateName,
        content,
        summary,
        timestamp: Date.now(),
      };
      this.deps.logNonBlocking(
        sessionId, 'claude-code', 'output',
        JSON.stringify(revivalFailureChunk),
        { messageType: 'revival_failed' }
      );
      this.deps.emit('teammate:transcriptUpdated', { sessionId, agentId: teammateAgentId });
    }

    // Same queue interruptWithMessage's idle-lead branch drains from -- without
    // this, an idle-but-live lead would find nothing to wake to and neither the
    // injected message nor the undelivered-notification fallback would fire.
    this.pendingTeammateToLeadMessages.push({
      teammateName,
      teammateAgentId,
      content,
      summary,
      kind: 'revival-failed',
    });

    const formattedMessage = `[Teammate revival failed: "${teammateName}"]\n\n${content}`;
    // #1682: never interrupt the lead mid-commit; the message stays queued until the call settles.
    afterCommitProposalSettles(sessionId, () => this.deps.interruptWithMessage(formattedMessage, sessionId)).catch(err => {
      console.warn(`[MANAGED-TEAMMATE] Failed to interrupt lead with revival failure:`, err);
    });

    this.deps.emit('message:logged', {
      sessionId,
      direction: 'output' as const,
    });

    // No live lead turn to interrupt -- the persisted transcript line and the
    // silently re-triggered idle wake are the only trace of this failure.
    // Fire a desktop notification so the user learns about it without having
    // to reopen this session. A busy lead already has interruptWithMessage's
    // mid-turn branch landing the failure inline, so notifying there too would
    // be a duplicate.
    if (!leadWasBusy) {
      this.deps.emit('teammate:revivalFailed', { sessionId, teammateAgentId, teammateName, reason });
    }
  }

  // ─── UI sync ────────────────────────────────────────────────────────────

  /**
   * Mark the teammate named by an open permission prompt as blocked, so the
   * architect can see which teammate is actually waiting on them instead of
   * every teammate showing the same running spinner. `requestId` is the only
   * handle `toolPermission:resolved` carries, so the attribution is remembered
   * under it.
   */
  markTeammatePermissionPending(sessionId: string | undefined, teammateName: string, requestId: string): void {
    const matches = [...this.managedTeammates.values()].filter(tm => tm.name === teammateName);
    if (matches.length !== 1) {
      // canUseTool is only handed the plain teammate name, so two same-named
      // teammates in different teams are indistinguishable here. Showing no one
      // as blocked beats blaming the wrong teammate.
      console.warn(`[MANAGED-TEAMMATE] Cannot attribute permission request ${requestId} to a teammate: ${matches.length} match "${teammateName}"`);
      return;
    }

    const agentId = matches[0].agentId;
    this.blockedTeammatesByRequest.set(requestId, agentId);
    console.log(`[MANAGED-TEAMMATE] "${agentId}" blocked awaiting permission (request=${requestId})`);
    this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'blocked' }]]));
  }

  /**
   * Release the marker set by markTeammatePermissionPending — the prompt was
   * approved, denied, cancelled or aborted.
   */
  markTeammatePermissionResolved(sessionId: string | undefined, requestId: string): void {
    const agentId = this.blockedTeammatesByRequest.get(requestId);
    if (!agentId) return;

    this.blockedTeammatesByRequest.delete(requestId);
    // The teammate may have gone idle, completed or errored while the prompt
    // was open; that terminal status was already emitted and must win.
    if (!this.managedTeammates.has(agentId)) return;
    this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: this.statusForManaged(agentId) }]]));
  }

  /**
   * Deliver a message to a teammate on the host's behalf (a UI-initiated send,
   * not the lead model's own SendMessage tool call). Reuses the exact
   * running/idle delivery paths the SendMessage tool-routing branch uses
   * (queueLeadMessage+flushPendingMessages / resumeIdleTeammate) rather than
   * duplicating the inbox-file locking or resume-prompt logic.
   *
   * Unlike the tool-routing branch, the caller already has the exact agentId
   * (sourced from TeammateInfo in the UI), so no fuzzy recipient-name matching
   * is needed here.
   *
   * `delivered: true` on the idle path means resume was successfully
   * initiated, not that the teammate has necessarily read the message yet --
   * resumeIdleTeammate is fire-and-forget by design; a resume failure surfaces
   * later through the existing stream-error/notification path (see 3a), not
   * through this method's return value.
   */
  async sendMessageFromHost(
    leadSessionId: string | undefined,
    agentId: string,
    content: string,
    resumeContext?: TeammateResumeContext,
  ): Promise<{ delivered: boolean; wasIdle: boolean }> {
    // The user talking to a teammate during its shutdown grace period calls the
    // shutdown off -- that window exists precisely for this.
    this.cancelPendingShutdown(agentId);

    const running = this.managedTeammates.get(agentId);
    if (running) {
      this.queueLeadMessage(agentId, running.name, content, 'Message from architect');
      try {
        await this.flushPendingMessages(agentId, running.query);
        return { delivered: true, wasIdle: false };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[MANAGED-TEAMMATE] Failed to deliver host message to "${agentId}":`, reason);
        return { delivered: false, wasIdle: false };
      }
    }

    const idle = this.idleTeammates.get(agentId);
    if (idle) {
      this.resumeIdleTeammate(leadSessionId, agentId, idle, content);
      return { delivered: true, wasIdle: true };
    }

    // Both maps are memory-only, so a Nimbalyst restart empties them while the
    // teammate's SDK session is still on disk and resumable. Rehydrate from the
    // session metadata the emit path already persists.
    let rehydrated: IdleTeammate | undefined;
    try {
      rehydrated = await this.rehydrateIdleTeammate(leadSessionId, agentId, resumeContext?.confirmedUserShutdown);
    } catch (err) {
      // A resume-prep failure (e.g. TeammateCwdMissingError from 1b's existence
      // check) that happens BEFORE any ManagedTeammate placeholder exists --
      // handleStreamError never runs for this, so it needs its own delivery.
      const reason = err instanceof Error ? err.message : String(err);
      const displayName = agentId.split('@')[0] || agentId;
      console.warn(`[MANAGED-TEAMMATE] Revival prep failed for "${agentId}":`, reason);
      this.deliverRevivalFailure(leadSessionId, agentId, displayName, reason);
      return { delivered: false, wasIdle: false };
    }
    if (rehydrated) {
      // streamTeammateOutput reads cwd/permissions off the manager instance,
      // and nothing has assigned them in a process where the lead never ran.
      this.seedLeadContext(resumeContext);
      this.resumeIdleTeammate(leadSessionId, agentId, rehydrated, content);
      return { delivered: true, wasIdle: true };
    }

    return { delivered: false, wasIdle: false };
  }

  /**
   * Fill in the lead-derived config streamTeammateOutput needs, for a process
   * where the lead's own query never ran. Only fills gaps: a live lead's values
   * are authoritative.
   */
  private seedLeadContext(resumeContext?: TeammateResumeContext): void {
    if (!resumeContext) return;
    this.lastUsedCwd ??= resumeContext.cwd;
    this.lastUsedPermissionsPath ??= resumeContext.permissionsPath;
  }

  /**
   * Rebuild an IdleTeammate from persisted session metadata for a teammate this
   * process never spawned. Returns undefined when there is nothing resumable --
   * no row, no persisted SDK session id (pre-feature data), or a row the
   * revival gate refuses (see isRevivalEligible).
   */
  private async rehydrateIdleTeammate(
    leadSessionId: string | undefined,
    agentId: string,
    confirmedUserShutdown?: boolean,
  ): Promise<IdleTeammate | undefined> {
    if (!leadSessionId) return undefined;

    let entry: PersistedTeammateRow | undefined;
    try {
      const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');
      const session = await AISessionsRepository.get(leadSessionId);
      const teammates = session?.metadata?.currentTeammates;
      entry = Array.isArray(teammates)
        ? (teammates as PersistedTeammateRow[]).find(tm => tm?.agentId === agentId)
        : undefined;
    } catch (error) {
      console.error(`[MANAGED-TEAMMATE] Failed to read persisted teammates for "${agentId}":`, error);
      return undefined;
    }

    const sessionId = entry?.sessionId;
    if (!entry || typeof sessionId !== 'string' || !sessionId) return undefined;

    if (!TeammateManager.isRevivalEligible(entry, confirmedUserShutdown)) return undefined;

    // The row's own cwd is the most authoritative source -- it's what this
    // teammate actually ran in, which may differ from the current process's
    // own cwd (e.g. the team spawned into its own git worktree). Only legacy
    // rows written before this field existed fall back to lastUsedCwd/process.cwd().
    const cwd = entry.cwd ?? this.lastUsedCwd ?? process.cwd();
    try {
      await fsp.access(cwd);
    } catch {
      throw new TeammateCwdMissingError(agentId, cwd);
    }

    const [fallbackName, fallbackTeam] = agentId.split('@');
    return {
      teamName: entry.teamName ?? fallbackTeam ?? 'team',
      name: entry.name ?? fallbackName ?? agentId,
      sessionId,
      agentType: entry.agentType ?? 'general-purpose',
      model: entry.model,
      color: TeammateManager.colorForAgentId(agentId),
      cwd,
      prompt: '',
      startedAt: entry.startedAt,
      toolCallCount: entry.toolCallCount,
      revivedFromTerminal: entry.status === 'completed' || entry.status === 'errored',
      revivedFromShutdown: entry.endReason === 'user-shutdown',
    };
  }

  /**
   * Whether a persisted row may be brought back by a host send.
   *
   * 'running'/'blocked' rows are stale after a restart -- the subprocess died
   * with the app -- so they resume exactly like 'idle', unconditionally: they
   * never reached a terminal status, so they carry no endReason/endedAt for the
   * window below to judge.
   *
   * PRD 003 stopped there, refusing 'completed'/'errored' outright. This widens
   * that: a terminal row whose SDK session is still plausibly resumable --
   * ended no more than REVIVAL_ELIGIBILITY_WINDOW_MS ago (a row exactly at the
   * boundary is still eligible) -- comes back too, except one the user shut
   * down themselves, which needs the caller's explicit confirmation.
   *
   * Judgment call: a row with **no** endedAt (written before that field
   * existed, or otherwise unreadable) is treated as not subject to the cutoff
   * rather than as expired. Rejecting every such row would make revival
   * invisible for exactly the data that predates it, which is the worse
   * default. An unknown endReason likewise falls through to eligible, matching
   * the 'finished' default the write path's `??` chain already applies.
   */
  private static isRevivalEligible(entry: PersistedTeammateRow, confirmedUserShutdown?: boolean): boolean {
    if (!entry.sessionId || !entry.status) return false;
    if (TeammateManager.RESUMABLE_PERSISTED_STATUSES.has(entry.status)) return true;
    if (entry.status !== 'completed' && entry.status !== 'errored') return false;

    const age = entry.endedAt === undefined ? undefined : Date.now() - entry.endedAt;
    if (age !== undefined && age > TeammateManager.REVIVAL_ELIGIBILITY_WINDOW_MS) return false;

    return entry.endReason === 'user-shutdown' ? confirmedUserShutdown === true : true;
  }

  /** Stable stand-in for the spawn-order color, which is not persisted. */
  private static colorForAgentId(agentId: string): string {
    let hash = 0;
    for (let i = 0; i < agentId.length; i++) {
      hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
    }
    return TeammateManager.TEAMMATE_COLORS[hash % TeammateManager.TEAMMATE_COLORS.length];
  }

  /**
   * Status of a still-managed teammate: blocked for as long as it owns any open
   * permission prompt (it can have more than one in flight), else running.
   */
  private statusForManaged(agentId: string): 'running' | 'blocked' {
    for (const blockedAgentId of this.blockedTeammatesByRequest.values()) {
      if (blockedAgentId === agentId) return 'blocked';
    }
    return 'running';
  }

  /**
   * Debounced version of emitTeammateUpdate. Accumulates status overrides
   * and flushes after EMIT_DEBOUNCE_MS to batch rapid lifecycle transitions.
   */
  private scheduleEmitTeammateUpdate(
    sessionId: string | undefined,
    statusOverrides?: Map<string, TeammateStatusOverride>
  ): void {
    if (!sessionId) return;

    this.pendingEmitSessionId = sessionId;
    if (statusOverrides) {
      for (const [agentId, override] of statusOverrides) {
        this.pendingStatusOverrides.set(agentId, override);
      }
    }

    if (this.emitDebounceTimer !== null) {
      clearTimeout(this.emitDebounceTimer);
    }

    this.emitDebounceTimer = setTimeout(() => {
      this.emitDebounceTimer = null;
      const overrides = new Map(this.pendingStatusOverrides);
      const sid = this.pendingEmitSessionId;
      this.pendingStatusOverrides.clear();
      this.pendingEmitSessionId = undefined;

      this.emitTeammateUpdate(sid, overrides).catch(err => {
        console.error('[CLAUDE-CODE] Failed to emit debounced teammate update:', err);
      });
    }, TeammateManager.EMIT_DEBOUNCE_MS);
  }

  /**
   * Flush any pending debounced teammate update immediately.
   */
  private flushPendingEmit(): void {
    if (this.emitDebounceTimer !== null) {
      clearTimeout(this.emitDebounceTimer);
      this.emitDebounceTimer = null;

      const overrides = new Map(this.pendingStatusOverrides);
      const sid = this.pendingEmitSessionId;
      this.pendingStatusOverrides.clear();
      this.pendingEmitSessionId = undefined;

      if (sid) {
        this.emitTeammateUpdate(sid, overrides).catch(err => {
          console.error('[CLAUDE-CODE] Failed to emit flushed teammate update:', err);
        });
      }
    }
  }

  async emitTeammateUpdate(
    sessionId: string | undefined,
    statusOverrides?: Map<string, TeammateStatusOverride>
  ): Promise<void> {
    if (!sessionId) {
      return;
    }

    try {
      const { AISessionsRepository } = await import('../../../storage/repositories/AISessionsRepository');
      const currentSession = await AISessionsRepository.get(sessionId);
      const currentMetadata = currentSession?.metadata || {};

      const existingTeammates: Array<{
        name: string;
        agentId: string;
        teamName: string;
        agentType: string;
        status: 'running' | 'blocked' | 'completed' | 'errored' | 'idle';
        model?: string;
        startedAt?: number;
        lastActiveAt?: number;
        toolCallCount?: number;
        /**
         * The teammate's own SDK session id. Absent on rows written before this
         * field existed, and on a teammate emitted before its first chunk was
         * seen -- never assume it is present.
         */
        sessionId?: string;
        endReason?: TeammateEndReason;
        endedAt?: number;
        cwd?: string;
      }> = Array.isArray(currentMetadata.currentTeammates) ? currentMetadata.currentTeammates as any[] : [];

      const seenAgentIds = new Set<string>();
      const updatedTeammates = existingTeammates.map(tm => {
        seenAgentIds.add(tm.agentId);
        const managed = this.managedTeammates.get(tm.agentId);
        const activityFields = managed ? {
          startedAt: managed.startedAt,
          lastActiveAt: managed.lastActiveAt,
          toolCallCount: managed.toolCallCount,
          // Captured mid-stream, well after the teammate was first emitted, so
          // it has to be re-read on every emit rather than written once at spawn.
          sessionId: managed.sessionId ?? tm.sessionId,
          cwd: managed.cwd,
        } : {};
        if (statusOverrides?.has(tm.agentId)) {
          const override = statusOverrides.get(tm.agentId)!;
          // Only stamp endReason/endedAt for this agentId's own terminal
          // transition -- an unrelated status override elsewhere in the same
          // debounced batch must not touch, let alone blank out, a value
          // already written by a prior terminal transition here.
          const terminalFields = override.endReason
            ? { endReason: override.endReason, endedAt: override.endedAt ?? Date.now() }
            : {};
          const overrideSessionId = override.sessionId ? { sessionId: override.sessionId } : {};
          return { ...tm, ...activityFields, status: override.status, ...terminalFields, ...overrideSessionId };
        } else if (managed) {
          // Not 'running': any unrelated emit (another teammate's tool call)
          // would otherwise clear a blocked teammate's status while its prompt
          // is still open.
          return { ...tm, ...activityFields, status: this.statusForManaged(tm.agentId) };
        } else if (this.idleTeammates.has(tm.agentId)) {
          const idleInfo = this.idleTeammates.get(tm.agentId);
          return {
            ...tm,
            sessionId: idleInfo?.sessionId ?? tm.sessionId,
            toolCallCount: idleInfo?.toolCallCount,
            lastActiveAt: idleInfo?.lastActiveAt,
            cwd: idleInfo?.cwd ?? tm.cwd,
            status: 'idle' as const,
          };
        }
        return tm;
      });

      for (const [agentId, tm] of this.managedTeammates) {
        if (!seenAgentIds.has(agentId)) {
          const override = statusOverrides?.get(agentId);
          updatedTeammates.push({
            name: tm.name,
            agentId: tm.agentId,
            teamName: tm.teamName,
            agentType: tm.agentType,
            status: override ? override.status : this.statusForManaged(agentId),
            model: tm.model,
            startedAt: tm.startedAt,
            lastActiveAt: tm.lastActiveAt,
            toolCallCount: tm.toolCallCount,
            sessionId: tm.sessionId,
            cwd: tm.cwd,
            ...(override?.endReason ? { endReason: override.endReason, endedAt: override.endedAt ?? Date.now() } : {}),
          });
        }
      }

      for (const [agentId, tm] of this.idleTeammates) {
        if (!seenAgentIds.has(agentId)) {
          const override = statusOverrides?.get(agentId);
          updatedTeammates.push({
            name: tm.name,
            agentId,
            teamName: tm.teamName,
            agentType: tm.agentType,
            status: override ? override.status : 'idle',
            model: tm.model,
            startedAt: tm.startedAt,
            toolCallCount: tm.toolCallCount,
            lastActiveAt: tm.lastActiveAt,
            sessionId: tm.sessionId,
            cwd: tm.cwd,
            ...(override?.endReason ? { endReason: override.endReason, endedAt: override.endedAt ?? Date.now() } : {}),
          });
        }
      }

      await AISessionsRepository.updateMetadata(sessionId, {
        metadata: {
          ...currentMetadata,
          currentTeammates: updatedTeammates,
        }
      });

      this.deps.emit('message:logged', {
        sessionId,
        direction: 'output'
      });
    } catch (error) {
      console.error('[CLAUDE-CODE] Failed to update session metadata with teammates:', error);
    }
  }

  // ─── Lifecycle: shared completion handler ────────────────────────────────

  /**
   * Handle teammate stream completion or error. Called from both spawn and resume paths.
   */
  private handleStreamCompletion(
    sessionId: string | undefined,
    agentId: string,
    teamName: string,
    idleTemplate: IdleTeammate,
    result: {
      capturedSessionId: string | undefined;
      approvedShutdown: boolean;
      capturedResultText: string | undefined;
      sentMessageToLead: boolean;
      /**
       * The session id streamTeammateOutput assigned/resumed up front, known
       * before the stream produced any chunk. Only used as a last-resort
       * fallback for the 'finished' branch below, when the SDK itself never
       * echoed a session_id chunk back.
       */
      assignedSessionId?: string;
    },
  ): void {
    const managed = this.managedTeammates.get(agentId);
    const isBackground = managed?.isBackgroundAgent ?? false;

    this.managedTeammates.delete(agentId);

    if (result.approvedShutdown) {
      this.markCompleted(agentId);
      this.clearPendingMessages(agentId);
      if (!isBackground) void this.removeTeammateFromConfig(teamName, agentId);
      console.log(`[MANAGED-TEAMMATE] "${agentId}" shut down (approved)`);
      this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'completed', endReason: 'user-shutdown', endedAt: Date.now() }]]));
    } else if (result.capturedSessionId && !isBackground) {
      // Only go idle for real teammates, not background agents
      this.idleTeammates.set(agentId, {
        ...idleTemplate,
        sessionId: result.capturedSessionId,
        toolCallCount: managed?.toolCallCount ?? 0,
        lastActiveAt: managed?.lastActiveAt,
      });
      console.log(`[MANAGED-TEAMMATE] "${agentId}" idle (session=${result.capturedSessionId})`);
      this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'idle' }]]));

      // Hand the finished turn back to the lead — a teammate that never called
      // SendMessage would otherwise strand its answer here. The idle notice is
      // unconditional; only the captured result body is gated on sentMessageToLead,
      // so a teammate that already messaged the lead does not get it re-delivered.
      // Must run BEFORE the all-completed check below: deliverMessageToLead's
      // interruptWithMessage() synchronously latches isLeadBusy(), which suppresses a
      // duplicate desktop notification when this was also the last active teammate.
      const displayName = idleTemplate.name;
      const resumeHint = 'Resume it with SendMessage, or shut it down if it is no longer needed.';
      let content: string;
      let summary = `${displayName} idle`;
      if (!result.sentMessageToLead && result.capturedResultText) {
        content = `Teammate "${displayName}" finished its turn and is now idle. Its final result:\n\n${result.capturedResultText}\n\n${resumeHint}`;
      } else if (!result.sentMessageToLead) {
        content = `Teammate "${displayName}" finished its turn without reporting a result, and is now idle. ${resumeHint}`;
        summary = `${displayName} idle (no result)`;
      } else {
        content = `Teammate "${displayName}" finished its turn and is now idle. ${resumeHint}`;
      }
      this.deliverMessageToLead(sessionId, agentId, displayName, content, summary);
    } else {
      this.markCompleted(agentId);
      this.clearPendingMessages(agentId);
      if (!isBackground) void this.removeTeammateFromConfig(teamName, agentId);
      const reason = isBackground ? 'background agent completed' : 'no session ID';
      console.log(`[MANAGED-TEAMMATE] "${agentId}" completed (${reason})`);
      const finishedSessionId = result.capturedSessionId ?? result.assignedSessionId;
      this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, {
        status: 'completed',
        endReason: 'finished',
        endedAt: Date.now(),
        ...(finishedSessionId ? { sessionId: finishedSessionId } : {}),
      }]]));

      // Deliver sub-agent/background agent result to lead so it can present findings to the user.
      // This reuses the same deliverMessageToLead path that teammates use for SendMessage.
      // Skip if the agent already sent a SendMessage to the lead during its stream —
      // that message IS the result and delivering capturedResultText would duplicate it.
      if (isBackground && result.capturedResultText && !result.sentMessageToLead) {
        const displayName = idleTemplate.name;
        this.deliverMessageToLead(
          sessionId, agentId, displayName,
          result.capturedResultText,
          `${displayName} completed`,
        );
      }
    }

    // If no more active teammates remain, notify the host so the session can end
    if (!this.hasActiveTeammates()) {
      this.emitAllCompleted(sessionId);
    }
  }

  private handleStreamError(
    sessionId: string | undefined,
    agentId: string,
    teamName: string,
    err: Error,
  ): void {
    const managed = this.managedTeammates.get(agentId);
    const isBackground = managed?.isBackgroundAgent ?? false;
    const wasResumed = managed?.wasResumed ?? false;
    const revivedFromTerminal = managed?.revivedFromTerminal ?? false;
    const teammateName = managed?.name ?? agentId;

    this.managedTeammates.delete(agentId);
    this.markCompleted(agentId);
    this.clearPendingMessages(agentId);
    this.idleTeammates.delete(agentId);
    if (!isBackground) void this.removeTeammateFromConfig(teamName, agentId);
    console.warn(`[MANAGED-TEAMMATE] "${agentId}" errored:`, err.message);
    this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'errored', endReason: 'errored', endedAt: Date.now() }]]));
    this.recordBatchFailure('errored');

    // Wake the lead's own conversation for a resumed teammate that died — the lead
    // already believes it initiated a resume that will report back (see task 1a).
    // Must run BEFORE the emitAllCompleted check below: deliverMessageToLead's
    // interruptWithMessage() synchronously latches isLeadBusy() (mid-turn or
    // teammateIdleMessagePending), which is what suppresses a duplicate desktop
    // notification when this was also the last active teammate.
    if (wasResumed && revivedFromTerminal) {
      // PRD 008: this resume was a revival of a previously completed/errored
      // teammate (see isRevivalEligible), not a PRD 003 idle-resume. Distinct
      // wording + chunk type -- see deliverRevivalFailure's own doc comment.
      this.deliverRevivalFailure(sessionId, agentId, teammateName, err.message);
    } else if (wasResumed) {
      this.deliverMessageToLead(
        sessionId,
        agentId,
        teammateName,
        `Resuming teammate "${teammateName}" failed: ${err.message}`,
        `${teammateName} resume failed`,
      );
    }

    // If no more active teammates remain, notify the host so the session can end
    if (!this.hasActiveTeammates()) {
      this.emitAllCompleted(sessionId);
    }
  }

  // ─── Lifecycle: spawn ───────────────────────────────────────────────────

  spawnManagedTeammate(sessionId: string | undefined, taskInput: any): void {
    // team_name is absent under the implicit-team protocol; the gate normally
    // passes a resolved one through, so this only backstops direct callers.
    const teamName = this.sanitizeName(
      taskInput.team_name || this.currentTeamContext || this.synthesizeTeamName(sessionId),
      'team',
    );
    const name = this.sanitizeName(taskInput.name, 'teammate');
    const agentId = `${name}@${teamName}`;
    const prompt = taskInput.prompt || 'Do your assigned work.';
    const agentType = taskInput.subagent_type || 'general-purpose';
    const model = taskInput.model;
    const color = TeammateManager.TEAMMATE_COLORS[this.teammateColorIndex % TeammateManager.TEAMMATE_COLORS.length];
    this.teammateColorIndex++;
    const cwd = this.lastUsedCwd || process.cwd();

    void this.updateTeamConfig(teamName, agentId, name, agentType, model, cwd, prompt, color);

    const teammateAbort = new AbortController();

    // NOTE: Teammate abort is intentionally NOT wired to the lead's abort signal.
    // The lead may be interrupted (via interruptWithMessage) without killing teammates.
    // Teammates are only aborted by explicit stop(name) or killAll() calls.

    // Register placeholder BEFORE starting the stream so that early
    // chunks can look up the teammate entry (avoids null query race).
    // streamPromise is assigned after streamTeammateOutput() returns.
    const now = Date.now();
    const placeholder: ManagedTeammate = {
      teamName,
      name,
      agentId,
      abort: teammateAbort,
      streamPromise: null as any, // will be set below
      query: null,
      sessionId: undefined,
      color,
      agentType,
      model,
      isBackgroundAgent: false,
      wasResumed: false,
      startedAt: now,
      lastActiveAt: now,
      toolCallCount: 0,
      cwd,
    };
    this.managedTeammates.set(agentId, placeholder);

    const streamPromise = this.streamTeammateOutput(
      sessionId, agentId, teamName, name, prompt, agentType, model, color, teammateAbort
    );
    placeholder.streamPromise = streamPromise;

    const idleTemplate: IdleTeammate = { teamName, name, sessionId: '', agentType, model, color, cwd, prompt, startedAt: now };
    streamPromise.then((result) => {
      this.handleStreamCompletion(sessionId, agentId, teamName, idleTemplate, result);
    }).catch((err) => {
      this.handleStreamError(sessionId, agentId, teamName, err);
    });
  }

  // ─── Background agent helpers ────────────────────────────────────────────

  private sanitizeBackgroundAgentName(description: string): string {
    return description
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 30) || 'task';
  }

  private spawnBackgroundAgent(
    sessionId: string | undefined,
    agentId: string,
    name: string,
    teamName: string,
    prompt: string,
    agentType: string,
    model: string | undefined,
  ): void {
    const color = TeammateManager.TEAMMATE_COLORS[this.teammateColorIndex % TeammateManager.TEAMMATE_COLORS.length];
    this.teammateColorIndex++;
    const cwd = this.lastUsedCwd || process.cwd();

    // No updateTeamConfig -- background agents have no real team

    const bgAbort = new AbortController();

    const now = Date.now();
    const placeholder: ManagedTeammate = {
      teamName,
      name,
      agentId,
      abort: bgAbort,
      streamPromise: null as any,
      query: null,
      sessionId: undefined,
      color,
      agentType,
      model,
      isBackgroundAgent: true,
      wasResumed: false,
      startedAt: now,
      lastActiveAt: now,
      toolCallCount: 0,
      cwd,
    };
    this.managedTeammates.set(agentId, placeholder);

    const streamPromise = this.streamTeammateOutput(
      sessionId, agentId, teamName, name, prompt, agentType, model, color, bgAbort
    );
    placeholder.streamPromise = streamPromise;

    const idleTemplate: IdleTeammate = { teamName, name, sessionId: '', agentType, model, color, cwd, prompt, startedAt: now };
    streamPromise.then((result) => {
      this.handleStreamCompletion(sessionId, agentId, teamName, idleTemplate, result);
    }).catch((err) => {
      this.handleStreamError(sessionId, agentId, teamName, err);
    });
  }

  // ─── Lifecycle: stream ──────────────────────────────────────────────────

  private async streamTeammateOutput(
    sessionId: string | undefined,
    agentId: string,
    teamName: string,
    name: string,
    prompt: string,
    agentType: string,
    model: string | undefined,
    color: string,
    abortController: AbortController,
    resumeSessionId?: string,
    groundRevival?: boolean,
  ): Promise<{ capturedSessionId: string | undefined; assignedSessionId: string; approvedShutdown: boolean; capturedResultText: string | undefined; sentMessageToLead: boolean }> {
    const cwd = this.lastUsedCwd || process.cwd();
    const teammateAdditionalDirectories = [os.tmpdir()];

    const permissionsPath = this.lastUsedPermissionsPath;

    // Build environment: use packaged build env if available (production Electron),
    // otherwise fall back to process.env (development mode)
    const baseEnv = this.packagedBuildOptions?.env ?? process.env;

    const permissionMode = 'default' as const;
    const options: any = {
      model: model || 'haiku',
      maxTurns: 20,
      permissionMode,
      persistSession: true,
      // SECURITY: Use empty settingSources so the subprocess cannot load
      // allow-rules from settings files and auto-approve tools internally.
      // All permission decisions must flow through our canUseTool callback,
      // which routes to Nimbalyst's ToolPermissionService and shows the
      // permission dialog to the user.
      settingSources: [],
      cwd,
      abortController,
      // legacy (explicit-team protocol, SDK <0.3.x): team-scoped extraArgs/env
      // vars for the teammate subprocess.
      extraArgs: {
        'agent-id': agentId,
        'agent-name': name,
        'team-name': teamName,
        'agent-color': color,
        'agent-type': agentType,
      },
      env: {
        ...baseEnv,
        CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
        CLAUDE_CODE_ENABLE_TASKS: '1',
        CLAUDE_CODE_TEAM_NAME: teamName,
        CLAUDE_CODE_TASK_LIST_ID: teamName,
        CLAUDE_CODE_AGENT_ID: agentId,
        CLAUDE_CODE_AGENT_NAME: name,
        CLAUDE_CODE_AGENT_TYPE: agentType,
      },
      hooks: {
        'PreToolUse': [{ hooks: [this.deps.createPreToolUseHook(cwd, sessionId, permissionsPath, { isTeammateSession: true })] }],
        'PostToolUse': [{ hooks: [this.deps.createPostToolUseHook(cwd, sessionId)] }],
      },
      canUseTool: this.deps.createCanUseToolHandler(sessionId, cwd, permissionsPath, name, permissionMode),
      additionalDirectories: teammateAdditionalDirectories,
    };

    // Apply packaged-build options (production Electron)
    if (this.packagedBuildOptions?.pathToClaudeCodeExecutable) {
      options.pathToClaudeCodeExecutable = this.packagedBuildOptions.pathToClaudeCodeExecutable;
    }

    // Known before the SDK streams anything back: a resume already carries its
    // own session id; a fresh spawn gets one from us via options.sessionId. This
    // guarantees handleStreamCompletion always has a usable id to persist, even
    // for a stream that ends without ever emitting a session_id chunk.
    const ownSessionId = resumeSessionId ?? randomUUID();
    if (resumeSessionId) {
      options.resume = resumeSessionId;
      console.log(`[MANAGED-TEAMMATE] Resuming "${name}" (${agentId}) with session=${resumeSessionId}`);
    } else {
      options.sessionId = ownSessionId;
      console.log(`[MANAGED-TEAMMATE] Spawning "${name}" (${agentId}) with model=${options.model}`);
    }

    // The SDK's query() takes `string | AsyncIterable<SDKUserMessage>`; the
    // iterable form is what lets a grounded revival deliver two turns.
    const teammateQuery = query({
      prompt: groundRevival ? this.createGroundedRevivalPromptStream(prompt) : prompt,
      options,
    });

    const teammate = this.managedTeammates.get(agentId);
    if (teammate) {
      teammate.query = teammateQuery as unknown as Query;
    }

    let capturedSessionId: string | undefined;
    let approvedShutdown = false;
    let capturedResultText: string | undefined;
    let sentMessageToLead = false;
    // Tools this teammate has started but not yet seen a result for. Tool
    // execution is a legitimate silence, so it disarms the stall watchdog below.
    let outstandingToolCalls = 0;

    // A wedged subprocess emits no chunk, no error, and never ends its iterator,
    // so `for await` here blocked forever and the teammate stayed "running" while
    // the lead waited on a report that was never coming. Race each chunk against
    // a stall timer instead, exactly as the lead's own stream does. NIM-1481.
    const iterator = (teammateQuery as AsyncIterable<any>)[Symbol.asyncIterator]();
    const streamStallMs = resolveStreamStallMs();
    // Teammates have no interrupt-with-message channel; the only interruption is
    // an explicit stop(name)/killAll(), which aborts this controller. Racing the
    // abort event lands the stop immediately rather than waiting for the SDK to
    // reject the in-flight next().
    const abortPromise = new Promise<'interrupted'>(resolve => {
      if (abortController.signal.aborted) {
        resolve('interrupted');
        return;
      }
      abortController.signal.addEventListener('abort', () => resolve('interrupted'), { once: true });
    });

    while (true) {
      const nextPromise = iterator.next();
      // Armed only while the teammate itself is expected to be producing output.
      // A running tool or an open permission prompt is the user's silence, not a
      // stall, and reaping either would destroy real work. Re-evaluated every
      // iteration so the disarm is never a one-way switch.
      //
      // Tradeoff, deliberate: while disarmed the loop waits indefinitely, so a
      // tool that never returns or a prompt nobody answers still hangs the
      // teammate. Both are visible to the user (the teammate shows as blocked,
      // the prompt is on screen), unlike the silent wedge this watchdog exists
      // to catch. The lead's own loop makes the same trade.
      const watchdogActive = outstandingToolCalls === 0 && this.statusForManaged(agentId) !== 'blocked';
      const raceResult = await raceNextChunkWithStallWatchdog<any>({
        nextPromise,
        interruptPromise: abortPromise,
        watchdogActive,
        stallMs: streamStallMs,
      });

      if (raceResult.kind === 'interrupted') {
        void nextPromise.catch(() => {});
        // Throw rather than break: an aborted teammate must not land in
        // handleStreamCompletion and be filed as idle-and-resumable, which is
        // what the SDK's own abort rejection used to prevent.
        throw new Error(`Teammate "${name}" was stopped.`);
      }

      if (raceResult.kind === 'stalled') {
        // Abandon the pending next() so its abort-induced rejection isn't an
        // unhandled rejection, then tear down the wedged subprocess.
        void nextPromise.catch(() => {});
        console.error(`[MANAGED-TEAMMATE] STREAM_STALL_DETECTED for "${agentId}": no chunk for ${streamStallMs}ms. Aborting wedged subprocess.`);
        try { abortController.abort(); } catch { /* best effort */ }
        // Throw so the existing .catch(handleStreamError) at every call site
        // marks the teammate errored and the host announces the failure instead
        // of the completion chime.
        throw new Error(
          `Teammate "${name}" stopped responding: no output for ${Math.round(streamStallMs / 1000)}s.`
        );
      }

      if (raceResult.kind === 'chunk-error') {
        // Preserve the pre-existing behavior: an iterator.next() rejection
        // propagates to the caller's catch handler.
        throw raceResult.error;
      }

      const iterResult = raceResult.result;
      if (iterResult.done) break;
      const chunk = iterResult.value;

      if (chunk.session_id && !capturedSessionId) {
        capturedSessionId = chunk.session_id;
        // Fail loud if we asked the SDK to resume this teammate's session X and it
        // reports a different session Y. Otherwise the teammate silently loses its
        // prior conversation and the lead thinks it's continuing.
        if (resumeSessionId && capturedSessionId !== resumeSessionId) {
          throw new Error(
            `[MANAGED-TEAMMATE] Session resume mismatch for "${agentId}": requested ` +
            `resume of "${resumeSessionId}" but SDK reported session "${capturedSessionId}". ` +
            `The teammate's prior conversation is not loaded.`
          );
        }
        console.log(`[MANAGED-TEAMMATE] Captured session ID for "${agentId}": ${capturedSessionId}`);
        const managed = this.managedTeammates.get(agentId);
        if (managed) {
          managed.sessionId = capturedSessionId;
        }
      }

      try {
        await this.flushPendingMessages(agentId, teammateQuery as unknown as Query);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.warn(`[MANAGED-TEAMMATE] Unexpected flush error for "${agentId}": ${reason}`);
      }

      if (chunk.type === 'assistant' || chunk.type === 'user') {
        // Update activity tracking on the managed teammate entry
        const managedEntry = this.managedTeammates.get(agentId);
        if (managedEntry) {
          managedEntry.lastActiveAt = Date.now();
        }

        const taggedChunk = {
          ...chunk,
          _isTeammateOutput: true,
          _teammateAgentId: agentId,
        };

        if (sessionId) {
          this.deps.logNonBlocking(
            sessionId, 'claude-code', 'output',
            JSON.stringify(taggedChunk),
            { messageType: 'teammate_output' }
          );
          this.deps.emit('teammate:transcriptUpdated', { sessionId, agentId });
        }

        if (chunk.type === 'user' && Array.isArray(chunk.message?.content)) {
          for (const block of chunk.message.content) {
            // Tool finished -- re-arm the stall watchdog for whatever the
            // teammate does next.
            if (block.type === 'tool_result') {
              outstandingToolCalls = Math.max(0, outstandingToolCalls - 1);
            }
          }
        }

        if (chunk.type === 'assistant' && chunk.message?.content && Array.isArray(chunk.message.content)) {
          // Count tool_use blocks for activity tracking
          for (const block of chunk.message.content) {
            if (block.type === 'tool_use') {
              if (managedEntry) managedEntry.toolCallCount++;
              // A tool is now executing; silence until its result comes back is
              // legitimate, so disarm the stall watchdog until then.
              outstandingToolCalls++;
            }
          }

          for (const block of chunk.message.content) {
            if (block.type === 'tool_use' && block.name === 'SendMessage' && block.input) {
              const toolInput = block.input as any;
              const recipient = toolInput.recipient;
              const messageType = toolInput.type || 'message';
              if (recipient && (recipient === 'team-lead' || recipient === 'lead' || recipient === 'team_lead') && messageType === 'message') {
                const messageContent = toolInput.content || '';
                const messageSummary = toolInput.summary || '';
                console.log(`[MANAGED-TEAMMATE] "${name}" (${agentId}) sent message to lead: "${messageSummary}"`);
                this.deliverMessageToLead(sessionId, agentId, name, messageContent, messageSummary);
                sentMessageToLead = true;
              }

              if (messageType === 'shutdown_response' && toolInput.approve === true) {
                console.log(`[MANAGED-TEAMMATE] "${name}" (${agentId}) approved shutdown`);
                approvedShutdown = true;
              }
            }
          }
        }
      }

      if (chunk.type === 'result') {
        // Capture result text for sub-agents to deliver to lead on completion
        if (typeof (chunk as any).result === 'string') {
          capturedResultText = (chunk as any).result;
        }
        if (sessionId) {
          const completionChunk = {
            ...chunk,
            _isTeammateOutput: true,
            _teammateAgentId: agentId,
            _teammateCompleted: true,
          };
          this.deps.logNonBlocking(
            sessionId, 'claude-code', 'output',
            JSON.stringify(completionChunk),
            { messageType: 'teammate_completed' }
          );
          this.deps.emit('teammate:transcriptUpdated', { sessionId, agentId });
        }
      }
    }

    if (approvedShutdown) {
      this.deliverMessageToLead(
        sessionId, agentId, name,
        `Teammate "${name}" has shut down (approved shutdown request).`,
        `${name} shut down`,
      );
    }

    return { capturedSessionId, assignedSessionId: ownSessionId, approvedShutdown, capturedResultText, sentMessageToLead };
  }

  // ─── Lifecycle: resume ──────────────────────────────────────────────────

  private resumeIdleTeammate(
    sessionId: string | undefined,
    agentId: string,
    idleInfo: IdleTeammate,
    prompt: string,
  ): void {
    this.idleTeammates.delete(agentId);

    const teammateAbort = new AbortController();
    // NOTE: Teammate abort is intentionally NOT wired to the lead's abort signal.
    // See spawnManagedTeammate() for rationale.

    const streamPromise = this.streamTeammateOutput(
      sessionId, agentId, idleInfo.teamName, idleInfo.name,
      prompt, idleInfo.agentType, idleInfo.model, idleInfo.color,
      teammateAbort, idleInfo.sessionId, idleInfo.revivedFromShutdown
    );

    // Preserve startedAt from idle info; reset activity tracking
    const now = Date.now();
    this.managedTeammates.set(agentId, {
      teamName: idleInfo.teamName,
      name: idleInfo.name,
      agentId,
      abort: teammateAbort,
      streamPromise,
      query: null,
      sessionId: idleInfo.sessionId,
      color: idleInfo.color,
      agentType: idleInfo.agentType,
      model: idleInfo.model,
      isBackgroundAgent: false,
      wasResumed: true,
      startedAt: idleInfo.startedAt ?? now,
      lastActiveAt: now,
      toolCallCount: idleInfo.toolCallCount ?? 0,
      cwd: idleInfo.cwd,
      revivedFromTerminal: idleInfo.revivedFromTerminal,
    });

    streamPromise.then((result) => {
      // Clear the grounding flag on the re-idle template: this turn already
      // delivered it, and carrying it forward would re-ground every later
      // ordinary resume with a shutdown notice that is no longer true.
      this.handleStreamCompletion(
        sessionId, agentId, idleInfo.teamName,
        { ...idleInfo, revivedFromShutdown: false },
        result,
      );
    }).catch((err) => {
      this.handleStreamError(sessionId, agentId, idleInfo.teamName, err);
    });

    this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'running' }]]));
  }

  // ─── Lifecycle: stop / kill / shutdown ──────────────────────────────────

  killAll(): void {
    this.flushPendingEmit();
    const overrides = new Map<string, TeammateStatusOverride>();

    if (this.managedTeammates.size > 0) {
      console.log(`[MANAGED-TEAMMATE] Killing ${this.managedTeammates.size} running teammate(s)`);
      for (const [agentId, tm] of this.managedTeammates) {
        console.log(`[MANAGED-TEAMMATE] Aborting "${agentId}"`);
        tm.abort.abort();
        if (!tm.isBackgroundAgent) void this.removeTeammateFromConfig(tm.teamName, agentId);
        overrides.set(agentId, { status: 'errored', endReason: 'errored', endedAt: Date.now() });
      }
      this.managedTeammates.clear();
    }

    if (this.idleTeammates.size > 0) {
      console.log(`[MANAGED-TEAMMATE] Clearing ${this.idleTeammates.size} idle teammate(s)`);
      for (const [agentId, idleInfo] of this.idleTeammates.entries()) {
        console.log(`[MANAGED-TEAMMATE] Removing idle teammate "${agentId}"`);
        void this.removeTeammateFromConfig(idleInfo.teamName, agentId);
        // Mechanically identical to stopByAgentId on an idle teammate -- a
        // deliberate kill, not a stream error. See stop/stopByAgentId below.
        overrides.set(agentId, { status: 'completed', endReason: 'user-shutdown', endedAt: Date.now() });
      }
      this.idleTeammates.clear();
    }

    this.pendingLeadMessages.clear();
    this.pendingLeadMessageFlushes.clear();
    this.completedTeammates.clear();
    this.handledShutdownToolUseIds.clear();

    if (overrides.size > 0 && this.lastUsedSessionId) {
      // Immediate emit for killAll - no debounce since we're tearing down
      this.emitTeammateUpdate(this.lastUsedSessionId, overrides).catch(err => {
        console.error('[CLAUDE-CODE] Failed to emit teammate kill update:', err);
      });
    }
  }

  /**
   * Stop a specific managed teammate by exact `agentId` -- addressed by the
   * UI, which already has the exact id, unlike the lead model's own
   * SendMessage tool which goes through `stop(name)`'s fuzzy matching.
   *
   * `leadSessionId` is threaded in explicitly rather than read from
   * `this.lastUsedSessionId`, which is only set while a live lead query is
   * streaming and is therefore unset for the first UI action after a
   * restart -- the same gap `sendMessageFromHost`'s `leadSessionId`
   * parameter exists to close. Without this, a post-restart stop would
   * abort the subprocess but silently skip the status emit.
   *
   * Stopping a teammate that is already terminal (completed/errored) or
   * unknown is a graceful no-op, not an error -- the UI may race a
   * completion event that already cleared it from both maps.
   */
  stopByAgentId(agentId: string, leadSessionId: string | undefined): { stopped: boolean } {
    const running = this.managedTeammates.get(agentId);
    if (running) {
      console.log(`[MANAGED-TEAMMATE] Stopping running teammate "${agentId}" (user requested)`);
      running.abort.abort();
      this.managedTeammates.delete(agentId);
      this.clearPendingMessages(agentId);
      // Deliberate, direct user action -- mechanically no less deliberate than
      // an approved shutdown handshake. Must never resurface under 2a's gate.
      this.scheduleEmitTeammateUpdate(leadSessionId, new Map([[agentId, { status: 'errored', endReason: 'user-shutdown', endedAt: Date.now() }]]));
      return { stopped: true };
    }

    const idle = this.idleTeammates.get(agentId);
    if (idle) {
      console.log(`[MANAGED-TEAMMATE] Stopping idle teammate "${agentId}" (user requested)`);
      this.idleTeammates.delete(agentId);
      this.markCompleted(agentId);
      this.clearPendingMessages(agentId);
      void this.removeTeammateFromConfig(idle.teamName, agentId);
      this.scheduleEmitTeammateUpdate(leadSessionId, new Map([[agentId, { status: 'completed', endReason: 'user-shutdown', endedAt: Date.now() }]]));
      return { stopped: true };
    }

    console.log(`[MANAGED-TEAMMATE] Stop requested for "${agentId}" but it is not running or idle (already terminal)`);
    return { stopped: false };
  }

  stop(name: string): boolean {
    for (const [agentId, tm] of this.managedTeammates) {
      if (this.agentIdMatchesRecipient(agentId, name, this.currentTeamContext)) {
        console.log(`[MANAGED-TEAMMATE] Stopping running teammate "${agentId}"`);
        tm.abort.abort();
        this.managedTeammates.delete(agentId);
        this.clearPendingMessages(agentId);
        if (this.lastUsedSessionId) {
          this.scheduleEmitTeammateUpdate(this.lastUsedSessionId, new Map([[agentId, { status: 'errored', endReason: 'user-shutdown', endedAt: Date.now() }]]));
        }
        return true;
      }
    }
    for (const [agentId, tm] of this.idleTeammates) {
      if (this.agentIdMatchesRecipient(agentId, name, this.currentTeamContext)) {
        console.log(`[MANAGED-TEAMMATE] Stopping idle teammate "${agentId}"`);
        this.idleTeammates.delete(agentId);
        this.markCompleted(agentId);
        this.clearPendingMessages(agentId);
        void this.removeTeammateFromConfig(tm.teamName, agentId);
        if (this.lastUsedSessionId) {
          this.scheduleEmitTeammateUpdate(this.lastUsedSessionId, new Map([[agentId, { status: 'completed', endReason: 'user-shutdown', endedAt: Date.now() }]]));
        }
        return true;
      }
    }
    return false;
  }

  /** Returns true and removes the id if this shutdown was already handled by handlePreToolUse. */
  consumeHandledShutdown(toolUseId: string | undefined): boolean {
    if (!toolUseId) return false;
    return this.handledShutdownToolUseIds.delete(toolUseId);
  }

  /**
   * A `shutdown_request` SendMessage handled entirely by the SDK's tool
   * result (no running stream to resume for approval) -- the same deliberate
   * shutdown handshake as `handleStreamCompletion`'s `approvedShutdown`
   * branch above, just reached for a teammate that was already idle or never
   * needed the resume-for-approval path. Write the same 'user-shutdown'
   * reason for consistency.
   */
  handleShutdownResult(sessionId: string | undefined, recipientName: string): void {
    for (const [agentId, idleInfo] of this.idleTeammates) {
      if (this.agentIdMatchesRecipient(agentId, recipientName, this.currentTeamContext)) {
        console.log(`[MANAGED-TEAMMATE] Shutdown result for idle teammate "${recipientName}" - cleaning up`);
        this.idleTeammates.delete(agentId);
        this.markCompleted(agentId);
        this.clearPendingMessages(agentId);
        void this.removeTeammateFromConfig(idleInfo.teamName, agentId);
        this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'completed', endReason: 'user-shutdown', endedAt: Date.now() }]]));
        if (!this.hasActiveTeammates()) {
          this.emitAllCompleted(sessionId);
        }
        return;
      }
    }

    for (const [agentId, managedInfo] of this.managedTeammates) {
      if (this.agentIdMatchesRecipient(agentId, recipientName, this.currentTeamContext)) {
        console.log(`[MANAGED-TEAMMATE] Shutdown result for managed teammate "${recipientName}" - aborting and cleaning up`);
        managedInfo.abort.abort();
        this.managedTeammates.delete(agentId);
        this.markCompleted(agentId);
        this.clearPendingMessages(agentId);
        void this.removeTeammateFromConfig(managedInfo.teamName, agentId);
        this.scheduleEmitTeammateUpdate(sessionId, new Map([[agentId, { status: 'completed', endReason: 'user-shutdown', endedAt: Date.now() }]]));
        if (!this.hasActiveTeammates()) {
          this.emitAllCompleted(sessionId);
        }
        return;
      }
    }

    console.log(`[MANAGED-TEAMMATE] Shutdown result for "${recipientName}" - not found in idle or managed maps (may already be completed)`);
  }

  // ─── PreToolUse helpers ─────────────────────────────────────────────────

  private denyPreToolUse(reason: string) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      }
    };
  }

  /**
   * Handle teammate-related tool calls intercepted from the PreToolUse hook.
   * Returns `{ handled: true, result }` if this tool call was teammate-related
   * and should not be processed further by the caller.
   */
  async handlePreToolUse(
    toolName: string,
    toolInput: any,
    toolUseID: string | undefined,
    sessionId: string | undefined,
  ): Promise<{ handled: true; result: any } | { handled: false }> {

    // ── Teammate spawn interception ─────────────────────────────────────
    // SDK 0.3.221 renamed the model-facing spawn tool Task -> Agent and
    // deprecated team_name ("the session has a single implicit team"), so a
    // schema-compliant model sends `Agent` with a bare `name` and no team.
    // Match both tool names; honor `team_name` when an older session sends it.
    if ((toolName === 'Task' || toolName === 'Agent') && toolInput?.name) {
      const legacyTeamName = this.sanitizeTeamNameOrUndefined(toolInput.team_name);
      console.log(
        `[MANAGED-TEAMMATE] Spawn tool observed: toolName="${toolName}", name="${toolInput.name}", team_name="${legacyTeamName ?? ''}", agentTeamsEnabled=${this.enableAgentTeams === true}`
      );

      // A legacy team_name implies teams are active; a bare name does not.
      if (legacyTeamName || this.enableAgentTeams) {
        const teamName = legacyTeamName ?? await this.resolveTeamNameForSpawn(sessionId);
        const name = this.sanitizeName(toolInput.name, 'teammate');
        const agentId = `${name}@${teamName}`;

        if (this.currentTeamContext !== teamName) {
          this.currentTeamContext = teamName;
          console.log(`[TEAM-CONTEXT] Updated current team context from ${toolName} spawn: "${teamName}"`);
        }

        if (this.managedTeammates.has(agentId)) {
          return {
            handled: true,
            result: this.denyPreToolUse(
              `Teammate "${name}" is ALREADY running (spawned earlier). Use SendMessage to communicate with it.`
            ),
          };
        }

        if (this.idleTeammates.has(agentId)) {
          return {
            handled: true,
            result: this.denyPreToolUse(
              `Teammate "${name}" is idle and waiting for messages. Use SendMessage to communicate with it -- do NOT spawn a new Task.`
            ),
          };
        }

        // Log synthetic tool_use + tool_result pair. The synthetic tool_use is
        // named 'Task' regardless of the observed tool name -- it is the key the
        // transcript widget registry is built on.
        if (sessionId) {
          this.logSyntheticToolPair(
            sessionId,
            toolUseID || `task-${Date.now()}`,
            'Task',
            toolInput,
            {
              status: 'teammate_spawned',
              agent_id: agentId,
              name,
              team_name: teamName,
              agent_type: toolInput.subagent_type || 'general-purpose',
              model: toolInput.model,
              color: 'blue',
            },
            'teammate_task'
          );
        }

        this.spawnManagedTeammate(sessionId, { ...toolInput, team_name: teamName });

        this.emitTeammateUpdate(sessionId).catch(err => {
          console.error('[CLAUDE-CODE] Failed to emit teammate update:', err);
        });

        return {
          handled: true,
          result: this.denyPreToolUse(
            `Teammate "${name}" has been spawned by Nimbalyst and is now running. agent_id: ${agentId}. The teammate will communicate via SendMessage. Do NOT retry this Task call -- the teammate is already active.\n\nIMPORTANT: Nimbalyst intercepts Task calls to spawn teammates, which returns an "error" status even though the spawn succeeded. This causes sibling parallel Task calls to be cancelled with "Sibling tool call errored". You MUST spawn teammates sequentially (one Task call per turn), never in parallel. Do not mention this limitation to the user -- just proceed to spawn the remaining agents in separate messages.`
          ),
        };
      }
    }

    // ── Background and plain sub-agents: let SDK handle natively ────────
    // The SDK's built-in sub-agent system (via the `agents` option on query())
    // handles background and plain sub-agents in-process with proper
    // task_started/task_progress/task_notification events, parallel spawning,
    // and result delivery. We only intercept named spawns (real teammates
    // above) which need our managed lifecycle and messaging.

    // ── SendMessage routing ─────────────────────────────────────────────
    if (toolName === 'SendMessage' && toolInput?.recipient) {
      const recipient = toolInput.recipient;
      const messageType = toolInput.type || 'message';

      // Check running teammates
      const matchingRunning = [...this.managedTeammates.entries()].find(([agentId]) => {
        return this.agentIdMatchesRecipient(agentId, recipient, this.currentTeamContext);
      });

      if (matchingRunning && messageType === 'shutdown_request') {
        const [agentId] = matchingRunning;
        const requestId = `shutdown-${Date.now()}@${recipient}`;
        const shutdownMessage = toolInput.content || toolInput.message || '';
        const shutdownPrompt = this.buildShutdownRequestPrompt(requestId, shutdownMessage);

        await this.scheduleShutdown(agentId, recipient, shutdownPrompt, sessionId);

        // Track that this shutdown was handled via preToolUse so processTeammateToolResult
        // does not redundantly call handleShutdownResult when the denied tool_result arrives.
        if (toolUseID) this.handledShutdownToolUseIds.add(toolUseID);

        this.logSyntheticToolPair(
          sessionId,
          toolUseID || `send-${Date.now()}`,
          'SendMessage',
          toolInput,
          {
            success: true,
            message: `Shutdown request sent to ${recipient}. Request ID: ${requestId}`,
            request_id: requestId,
            target: recipient,
          },
          'teammate_shutdown'
        );

        return {
          handled: true,
          result: this.denyPreToolUse(
            `Shutdown request queued for running teammate "${recipient}". Request ID: ${requestId}`
          ),
        };
      }

      if (matchingRunning && messageType === 'message') {
        const [agentId, teammate] = matchingRunning;
        const messageContent = toolInput.content || toolInput.message || '';
        const messageSummary = toolInput.summary || 'Message from lead';
        this.cancelPendingShutdown(agentId);

        const teammateQuery = teammate.query;
        if (!teammateQuery || typeof teammateQuery.streamInput !== 'function') {
          console.warn(`[MANAGED-TEAMMATE] Running teammate "${recipient}" has no streamInput reference yet; queueing for retry with inbox fallback`);
        }

        const queueDepth = this.queueLeadMessage(agentId, recipient, messageContent, messageSummary);
        console.log(`[MANAGED-TEAMMATE] Queued lead message for running teammate "${recipient}" (agentId: ${agentId}, queueDepth=${queueDepth})`);

        try {
          await this.flushPendingMessages(agentId, teammateQuery);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`[MANAGED-TEAMMATE] Failed to flush queued message to "${recipient}":`, reason);
        }

        return {
          handled: true,
          result: this.denyPreToolUse(
            `Message delivered to running teammate "${recipient}" via managed channel. Do not retry.`
          ),
        };
      }

      // Check idle teammates
      const matchingIdle = [...this.idleTeammates.entries()].find(([agentId]) => {
        return this.agentIdMatchesRecipient(agentId, recipient, this.currentTeamContext);
      });

      if (matchingIdle) {
        const [agentId, idleInfo] = matchingIdle;

        if (messageType === 'shutdown_request') {
          const requestId = `shutdown-${Date.now()}@${recipient}`;
          const shutdownMessage = toolInput.content || toolInput.message || '';
          const shutdownPrompt = this.buildShutdownRequestPrompt(requestId, shutdownMessage);
          await this.scheduleShutdown(agentId, recipient, shutdownPrompt, sessionId);

          // Track that this shutdown was handled via preToolUse so processTeammateToolResult
          // does not redundantly call handleShutdownResult when the denied tool_result arrives.
          if (toolUseID) this.handledShutdownToolUseIds.add(toolUseID);

          this.logSyntheticToolPair(
            sessionId,
            toolUseID || `send-${Date.now()}`,
            'SendMessage',
            toolInput,
            {
              success: true,
              message: `Shutdown request sent to ${recipient}. Request ID: ${requestId}`,
              request_id: requestId,
              target: recipient,
            },
            'teammate_shutdown'
          );

          return {
            handled: true,
            result: this.denyPreToolUse(
              `Shutdown request sent to idle teammate "${recipient}" (request_id: ${requestId}) and awaiting approval.`
            ),
          };
        }

        if (messageType !== 'message') {
          console.log(`[MANAGED-TEAMMATE] SendMessage type "${messageType}" to idle teammate "${recipient}" - letting SDK handle natively`);
          // Fall through to SDK handling
        } else {
          const messageContent = toolInput.content || toolInput.message || '';
          this.cancelPendingShutdown(agentId);
          console.log(`[MANAGED-TEAMMATE] Resuming idle teammate "${recipient}" (session=${idleInfo.sessionId}) with message`);
          this.resumeIdleTeammate(sessionId, agentId, idleInfo, messageContent);

          this.logSyntheticToolPair(
            sessionId,
            toolUseID || `send-${Date.now()}`,
            'SendMessage',
            toolInput,
            {
              success: true,
              message: `Resume initiated for idle teammate "${recipient}"; message sent but not yet confirmed delivered.`,
              target: recipient,
            },
            'teammate_message'
          );

          return {
            handled: true,
            result: this.denyPreToolUse(
              `Resume initiated for idle teammate "${recipient}"; message sent but not yet confirmed delivered.`
            ),
          };
        }
      }

      // Check completed teammates
      const matchingCompleted = [...this.completedTeammates].find(agentId => {
        return this.agentIdMatchesRecipient(agentId, recipient, this.currentTeamContext);
      });

      if (matchingCompleted) {
        if (messageType === 'shutdown_request') {
          console.log(`[MANAGED-TEAMMATE] SendMessage shutdown_request to completed teammate "${recipient}" - already shut down, intercepting`);
          return {
            handled: true,
            result: this.denyPreToolUse(
              `Teammate "${recipient}" has already shut down. No action needed.`
            ),
          };
        }

        console.log(`[MANAGED-TEAMMATE] SendMessage to completed teammate "${recipient}" (type: ${messageType}) - letting SDK handle natively`);
        // Fall through to let SDK handle it
      }
    }

    return { handled: false };
  }
}

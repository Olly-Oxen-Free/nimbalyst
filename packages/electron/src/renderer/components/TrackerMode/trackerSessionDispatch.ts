/**
 * Tracker item -> AI session dispatch, shared by the detail panel's "Launch
 * Session" button and the kanban card's dispatch button.
 *
 * Prompt synthesis (including its trailing `tracker_update` self-report
 * instruction) stays in `trackerSessionLaunch.ts` and is reused verbatim.
 * Navigation stays with the caller: these functions return the session id to
 * open, or null when nothing was created.
 */

import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { ModelIdentifier } from '@nimbalyst/runtime/ai/server/types';
import type { SessionMeta } from '../../store/atoms/sessions';
import { isClaudeCliTerminalSession } from '../UnifiedAI/claudeCliInputRouting';
import {
  buildTrackerLaunchContext,
  getEffectiveTrackerLaunchPromptTemplateForWorkspace,
} from './trackerSessionLaunch';

export interface TrackerDispatchOptions {
  trackerItemId: string;
  trackerItem: TrackerRecord | undefined;
  workspacePath: string | undefined;
  defaultModel: string | undefined;
}

export interface TrackerResumeOptions extends TrackerDispatchOptions {
  /** The item's linked session, if it already has one. */
  linkedSession: SessionMeta | undefined;
}

/**
 * Create a session for a tracker item, link it, and pre-fill the synthesized
 * prompt as a draft (never sent automatically).
 *
 * @returns the new session id, or null when session creation failed.
 */
export async function launchTrackerSession({
  trackerItemId,
  trackerItem,
  workspacePath,
  defaultModel,
}: TrackerDispatchOptions): Promise<string | null> {
  const effectiveTemplate = await getEffectiveTrackerLaunchPromptTemplateForWorkspace(workspacePath);
  const trackerContext = buildTrackerLaunchContext(trackerItemId, trackerItem, effectiveTemplate);

  // Derive provider from the user's default model rather than hardcoding
  // 'claude-code'. Mirrors AgentMode.createNewSession so a Codex-only
  // workspace launches a Codex session, not a failed claude-code one.
  // See nimbalyst#176.
  const sessionId = crypto.randomUUID();
  const parsedModel = defaultModel ? ModelIdentifier.tryParse(defaultModel) : null;
  const provider = parsedModel?.provider || 'claude-code';
  const result = await window.electronAPI.invoke('sessions:create', {
    session: {
      id: sessionId,
      provider,
      model: defaultModel,
      title: 'New Session',
    },
    workspaceId: workspacePath,
  });
  if (!result?.success || !result?.id) return null;

  await window.electronAPI.invoke('tracker:link-session', {
    trackerId: trackerContext.trackerLinkId,
    sessionId: result.id,
  });
  await window.electronAPI.invoke(
    'ai:saveDraftInput',
    result.id,
    trackerContext.draftInput,
    workspacePath,
  );
  return result.id;
}

/**
 * Reopen a tracker item's linked session, resuming the provider-side
 * conversation when possible.
 *
 * `resumeSessionId` only exists on the terminal-backed claude-cli path, so
 * every other provider — and a claude-cli session with no recorded
 * `providerSessionId` — falls back to a fresh {@link launchTrackerSession}.
 *
 * @returns the session id to open, or null when a fallback launch failed.
 */
export async function resumeTrackerSession(options: TrackerResumeOptions): Promise<string | null> {
  const { linkedSession, workspacePath } = options;
  if (!linkedSession || !workspacePath || !isClaudeCliTerminalSession(linkedSession.provider)) {
    return launchTrackerSession(options);
  }

  const session = await window.electronAPI.invoke('sessions:get', linkedSession.id) as
    { session?: { providerSessionId?: string } } | null;
  const providerSessionId = session?.session?.providerSessionId;
  if (!providerSessionId) return launchTrackerSession(options);

  const ensured = await window.electronAPI.terminal.ensureClaudeCliSession({
    sessionId: linkedSession.id,
    workspacePath,
    model: linkedSession.model,
    resumeSessionId: providerSessionId,
  });
  if (!ensured.success) {
    throw new Error(
      ensured.claudeNotInstalled
        ? 'Claude Code CLI is not installed.'
        : ensured.error || 'Failed to resume the Claude Code CLI session.',
    );
  }
  return linkedSession.id;
}

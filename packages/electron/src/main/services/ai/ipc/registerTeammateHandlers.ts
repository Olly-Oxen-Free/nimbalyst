import { safeHandle } from '../../../utils/ipcRegistry';
import { resolveTaskSubagentToolUseId } from '../aiServiceUtils';
import { createRawMessageStoreAdapter } from '../../TranscriptMigrationAdapters';
import { ProviderFactory, ClaudeCodeProvider } from '@nimbalyst/runtime/ai/server';
import { getSessionStateManager } from '@nimbalyst/runtime/ai/server/SessionStateManager';
import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import {
  projectTeammateRawMessages,
  projectTaskSubagentRawMessages,
} from '@nimbalyst/runtime/ai/server/transcript/projectRawMessages';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/transcript/TranscriptProjector';
import type { AIProviderType } from '@nimbalyst/runtime/ai/server/types';

/**
 * Teammate and Task sub-agent handlers: direct UI delivery to a teammate,
 * stopping one, and projecting a teammate's or sub-agent's transcript out of
 * the lead session's raw log. Request/response only -- no event stream, so no
 * centralized listener is needed (docs/IPC_LISTENERS.md governs event
 * subscriptions, not invoke-style calls).
 */
export function registerTeammateHandlers(): void {
  // Deliver a message to a specific Teammate directly from the UI (a
  // sub-agent chip click-to-thread flow), rather than through the lead
  // model's own SendMessage tool call.
  safeHandle('ai:sendMessageToTeammate', async (_event, sessionId: string, agentId: string, content: string, confirmedUserShutdown?: boolean) => {
    if (!sessionId || !agentId || !content) {
      throw new Error('sessionId, agentId, and content are required');
    }

    const session = await AISessionsRepository.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    if (session.provider !== 'claude-code') {
      return { success: false, error: 'Teammates only exist under the claude-code provider' };
    }

    const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
    if (!provider || typeof (provider as any).sendMessageToManagedTeammate !== 'function') {
      return { success: false, error: 'No active provider for session' };
    }

    // Mark the session running the way a normal lead turn does, before the
    // send: resuming an idle teammate can fail and wake the lead's own
    // conversation, and that wake is dropped for a session the state manager
    // is not tracking -- which is every session whose lead turn ended (or
    // never ran) in this process. This is a deliberate user action, so
    // starting the session here reflects what the user just did.
    const stateManager = getSessionStateManager();
    const wasActive = stateManager.isSessionActive(sessionId);
    if (!wasActive) {
      await stateManager.startSession({
        sessionId,
        workspacePath: session.workspacePath,
      });
    }

    // After a restart the provider has no live query, so the lead session id
    // and the lead's cwd/permission paths have to come from the session record.
    const { delivered, wasIdle } = await (provider as ClaudeCodeProvider).sendMessageToManagedTeammate(
      agentId,
      content,
      sessionId,
      {
        cwd: session.worktreePath || session.workspacePath,
        permissionsPath: session.worktreeProjectPath || session.worktreePath || session.workspacePath,
        // Without this the revival gate refuses a teammate the user shut
        // down themselves, so a stray send can never restart one.
        confirmedUserShutdown,
      },
    );
    if (!delivered && !wasActive) {
      // Nothing was started, so nothing will ever end the session we just
      // started. `delivered: true` is left alone: on the idle path the resume
      // outcome arrives after this handler returns and needs it active.
      await stateManager.endSession(sessionId);
    }
    return { success: delivered, wasIdle };
  });

  safeHandle('ai:stopTeammate', async (
    _event,
    sessionId: string,
    agentId: string,
    workspacePath: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!sessionId) throw new Error('sessionId is required');
    if (!agentId) throw new Error('agentId is required');
    if (!workspacePath) throw new Error('workspacePath is required');

    const session = await AISessionsRepository.get(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    // Same ownership rule as ai:getTeammateTranscript: a worktree session
    // is reachable from either its parent workspace or its worktree.
    const ownsSession = session.workspacePath === workspacePath
      || (!!session.worktreePath && session.worktreePath === workspacePath);
    if (session.workspacePath && !ownsSession) {
      throw new Error(
        `Session ${sessionId} belongs to ${session.workspacePath}, not ${workspacePath}`,
      );
    }
    if (session.provider !== 'claude-code') {
      return { success: false, error: 'Teammates only exist under the claude-code provider' };
    }

    const provider = ProviderFactory.getProvider(session.provider as AIProviderType, sessionId);
    if (!provider || typeof (provider as any).stopManagedTeammateById !== 'function') {
      return { success: false, error: 'No active provider for session' };
    }

    const { stopped } = (provider as ClaudeCodeProvider).stopManagedTeammateById(agentId, sessionId);
    return { success: stopped };
  });

  // A teammate has no session row of its own: its chunks live in the LEAD
  // session's raw ai_agent_messages, tagged with its agent id, and are
  // suppressed from the lead's visible stream. Project them here so the
  // renderer gets TranscriptViewMessage[] without touching the DB itself.
  // Raw rather than ai_transcript_events because the canonical table holds
  // no teammate-scoped events.
  safeHandle('ai:getTeammateTranscript', async (
    _event,
    sessionId: string,
    agentId: string,
    workspacePath: string,
  ): Promise<TranscriptViewMessage[]> => {
    if (!sessionId) throw new Error('sessionId is required');
    if (!agentId) throw new Error('agentId is required');
    if (!workspacePath) throw new Error('workspacePath is required');

    const session = await AISessionsRepository.get(sessionId);
    if (!session) return [];

    // Same ownership rule as SessionManager.loadSession: a worktree session
    // is reachable from either its parent workspace or its worktree.
    const ownsSession = session.workspacePath === workspacePath
      || (!!session.worktreePath && session.worktreePath === workspacePath);
    if (session.workspacePath && !ownsSession) {
      throw new Error(
        `Session ${sessionId} belongs to ${session.workspacePath}, not ${workspacePath}`,
      );
    }

    const rawMessages = await createRawMessageStoreAdapter().getMessages(sessionId);
    return projectTeammateRawMessages(rawMessages, agentId);
  });

  // A Task sub-agent has no session row of its own: `forwardSubagentText`
  // relays its chunks through the LEAD session's own iterator, tagged with
  // `parent_tool_use_id`, and they're persisted like any other raw row.
  // Callers key by either `taskId` or `toolUseId` -- the inline-expand
  // widget only ever has the latter (the spawning message's own tool_use
  // id). A `taskId` is resolved to its `toolUseId` via
  // `session.metadata.currentTasks`, the persisted mirror of the
  // provider's in-memory `activeTasks`, so this works whether or not the
  // session's provider instance is currently live.
  safeHandle('ai:getTaskSubagentTranscript', async (
    _event,
    sessionId: string,
    lookup: { taskId?: string; toolUseId?: string },
    workspacePath: string,
  ): Promise<TranscriptViewMessage[]> => {
    if (!sessionId) throw new Error('sessionId is required');
    if (!lookup?.taskId && !lookup?.toolUseId) {
      throw new Error('taskId or toolUseId is required');
    }
    if (!workspacePath) throw new Error('workspacePath is required');

    const session = await AISessionsRepository.get(sessionId);
    if (!session) return [];

    // Same ownership rule as ai:getTeammateTranscript: a worktree session
    // is reachable from either its parent workspace or its worktree.
    const ownsSession = session.workspacePath === workspacePath
      || (!!session.worktreePath && session.worktreePath === workspacePath);
    if (session.workspacePath && !ownsSession) {
      throw new Error(
        `Session ${sessionId} belongs to ${session.workspacePath}, not ${workspacePath}`,
      );
    }

    const toolUseId = resolveTaskSubagentToolUseId(session.metadata, lookup);
    if (!toolUseId) return [];

    const rawMessages = await createRawMessageStoreAdapter().getMessages(sessionId);
    return projectTaskSubagentRawMessages(rawMessages, toolUseId);
  });
}

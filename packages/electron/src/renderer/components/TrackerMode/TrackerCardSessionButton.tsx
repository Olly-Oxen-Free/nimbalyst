/**
 * Run/resume/focus button for a tracker board card, passed to the shared
 * `TrackerBoardCard` (packages/collab-client) as `sessionActionSlot`.
 *
 * Lives in electron rather than collab-client because it dispatches into
 * electron's local session registry, which has no meaning in a browser tab.
 */

import React, { useCallback, useMemo } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { MaterialSymbol } from '@nimbalyst/runtime/ui/icons/MaterialSymbol';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { store } from '../../store';
import { errorNotificationService } from '../../services/ErrorNotificationService';
import {
  refreshSessionListAtom,
  sessionProcessingAtom,
  sessionRegistryAtom,
  setSelectedWorkstreamAtom,
} from '../../store/atoms/sessions';
import { setWindowModeAtom } from '../../store/atoms/windowMode';
import { activeWorkspacePathAtom } from '../../store/atoms/openProjects';
import { defaultAgentModelAtom } from '../../store/atoms/appSettings';
import { workstreamStateAtom } from '../../store/atoms/workstreamState';
import { resolveLinkedSessions } from '../../utils/resolveLinkedSessions';
import { isClaudeCliTerminalSession } from '../UnifiedAI/claudeCliInputRouting';
import { launchTrackerSession, resumeTrackerSession } from './trackerSessionDispatch';
import { assertTrackerItemInWorkspace } from './trackerSessionLaunch';
import {
  deriveTrackerCardSessionAction,
  SESSION_ACTION_ICON,
  SESSION_ACTION_LABEL,
} from './trackerCardSessionAction';

interface TrackerCardSessionButtonProps {
  item: TrackerRecord;
}

export const TrackerCardSessionButton: React.FC<TrackerCardSessionButtonProps> = ({ item }) => {
  const workspacePath = useAtomValue(activeWorkspacePathAtom);
  const defaultModel = useAtomValue(defaultAgentModelAtom);
  const sessionRegistry = useAtomValue(sessionRegistryAtom);
  const setSelectedWorkstream = useSetAtom(setSelectedWorkstreamAtom);
  const setWindowMode = useSetAtom(setWindowModeAtom);
  const refreshSessionList = useSetAtom(refreshSessionListAtom);

  const linkedSession = useMemo(
    () => resolveLinkedSessions(item, sessionRegistry)[0],
    [item, sessionRegistry],
  );
  const isLinkedSessionProcessing = useAtomValue(sessionProcessingAtom(linkedSession?.id ?? ''));
  const sessionAction = deriveTrackerCardSessionAction(!!linkedSession, isLinkedSessionProcessing);

  // Mirrors TrackerMainView's handleSwitchToAgentMode: an existing linked
  // session may itself be a workstream/worktree root or a workstream child,
  // so reopening it (resume/focus) needs the same type resolution a fresh
  // launch (always a plain 'session') doesn't.
  const navigateToSession = useCallback((sessionId: string) => {
    if (!workspacePath) return;
    const registry = store.get(sessionRegistryAtom);
    const sessionMeta = registry.get(sessionId);
    let targetId = sessionId;
    let type: 'session' | 'workstream' | 'worktree' = 'session';
    if (sessionMeta?.parentSessionId && registry.get(sessionMeta.parentSessionId)) {
      targetId = sessionMeta.parentSessionId;
      type = 'workstream';
    } else {
      const state = store.get(workstreamStateAtom(sessionId));
      type = state.type === 'worktree' ? 'worktree' : state.type === 'workstream' ? 'workstream' : 'session';
    }
    setSelectedWorkstream({ workspacePath, selection: { type, id: targetId } });
    setWindowMode('agent');
  }, [workspacePath, setSelectedWorkstream, setWindowMode]);

  const handleSessionAction = useCallback(async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!workspacePath) return;

    if (sessionAction === 'focus') {
      if (linkedSession) navigateToSession(linkedSession.id);
      return;
    }

    try {
      assertTrackerItemInWorkspace(item, workspacePath);
    } catch (err) {
      errorNotificationService.showError('Session not started', (err as Error).message);
      return;
    }

    if (sessionAction === 'resume' && linkedSession) {
      if (!isClaudeCliTerminalSession(linkedSession.provider)) {
        // Non-claude-cli providers can't resume; reopen the existing session
        // record instead of dispatching, which would otherwise fall back to
        // creating a duplicate session (see trackerSessionDispatch.ts).
        navigateToSession(linkedSession.id);
        return;
      }
      try {
        const sessionId = await resumeTrackerSession({
          trackerItemId: item.id,
          trackerItem: item,
          workspacePath,
          defaultModel,
          linkedSession,
        });
        if (!sessionId) return;
        await refreshSessionList();
        navigateToSession(sessionId);
      } catch (err) {
        console.error('[TrackerCardSessionButton] Failed to resume session:', err);
      }
      return;
    }

    try {
      const sessionId = await launchTrackerSession({
        trackerItemId: item.id,
        trackerItem: item,
        workspacePath,
        defaultModel,
      });
      if (!sessionId) return;
      await refreshSessionList();
      navigateToSession(sessionId);
    } catch (err) {
      console.error('[TrackerCardSessionButton] Failed to launch session:', err);
    }
  }, [sessionAction, linkedSession, workspacePath, defaultModel, item, refreshSessionList, navigateToSession]);

  return (
    <button
      type="button"
      draggable={false}
      data-testid="tracker-card-session-button"
      aria-label={SESSION_ACTION_LABEL[sessionAction]}
      title={SESSION_ACTION_LABEL[sessionAction]}
      className={`tracker-card-session-button shrink-0 inline-flex items-center justify-center w-6 h-6 rounded hover:bg-nim-tertiary transition-colors ${
        sessionAction === 'focus' ? 'text-[var(--nim-primary)]' : 'text-nim-faint opacity-60 hover:opacity-100'
      }`}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onDragStart={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={handleSessionAction}
    >
      <MaterialSymbol
        icon={SESSION_ACTION_ICON[sessionAction]}
        size={14}
        className={sessionAction === 'focus' ? 'animate-spin' : undefined}
      />
    </button>
  );
};

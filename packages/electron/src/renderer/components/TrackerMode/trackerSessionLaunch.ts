import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import { getRecordTitle } from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';
import { store } from '@nimbalyst/runtime/store';
import { settingAtom } from '../../store/atoms/settingAtomFamily';
import {
  DEFAULT_TRACKER_LAUNCH_PROMPT_TEMPLATE,
  buildTrackerLaunchTemplateVars,
  renderTrackerLaunchPrompt,
} from '../../../shared/trackerLaunchPromptTemplate';

const MAX_WORKTREE_NAME_LENGTH = 64;

export interface TrackerLaunchContext {
  workspacePath: string | undefined;
  trackerLinkId: string;
  draftInput: string;
  worktreeName: string;
}

/**
 * Whether a pending worktree launch still belongs to the project on screen. The
 * tracker view stays mounted across a rail switch, so without this the branch
 * picker would stay open and list the new project's branches for the old item.
 */
export function isTrackerLaunchForWorkspace(
  context: TrackerLaunchContext | null,
  workspacePath: string | null | undefined,
): context is TrackerLaunchContext {
  return !!context && !!context.workspacePath && context.workspacePath === workspacePath;
}

/** Validate at submission: the project can change while the branch picker is open. */
export async function createTrackerWorktreeSession(
  context: TrackerLaunchContext,
  activeWorkspacePath: string | null,
  options: { baseBranch: string; name?: string },
  createSession: (options: { baseBranch: string; name?: string; initialDraft: string }) => Promise<string | undefined>,
): Promise<string | undefined> {
  if (!context.workspacePath || context.workspacePath !== activeWorkspacePath) {
    throw new Error('The active project changed. Cancel and start the worktree from the original project.');
  }
  // Invoke synchronously after the check so creation captures the same active project.
  return createSession({ ...options, initialDraft: context.draftInput });
}

function slugifyWorktreeName(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function deriveTrackerWorktreeName(itemId: string, title: string): string {
  const itemSlug = slugifyWorktreeName(itemId) || 'tracker-item';
  const titleSlug = slugifyWorktreeName(title);
  const combined = titleSlug && titleSlug !== itemSlug
    ? `${itemSlug}-${titleSlug}`
    : itemSlug;

  return combined
    .slice(0, MAX_WORKTREE_NAME_LENGTH)
    .replace(/-+$/g, '');
}

/**
 * Resolve the effective tracker launch prompt template for a workspace:
 * project override (ai:getProjectTrackerLaunchPromptTemplate) if set, else the
 * global ai.trackerLaunchPromptTemplate setting. Falls back to the global
 * value (not the hardcoded default) on any IPC failure, since the global
 * setting is already cached client-side in the settings atom.
 */
export async function getEffectiveTrackerLaunchPromptTemplateForWorkspace(
  workspacePath: string | undefined,
): Promise<string> {
  const globalTemplate = store.get(settingAtom('ai.trackerLaunchPromptTemplate'));
  if (!workspacePath) return globalTemplate;
  try {
    const result = await window.electronAPI.invoke('ai:getProjectTrackerLaunchPromptTemplate', workspacePath);
    if (result?.success && typeof result.override === 'string') {
      return result.override;
    }
  } catch (err) {
    console.error('[trackerSessionLaunch] Failed to load project template override:', err);
  }
  return globalTemplate;
}

/**
 * Refuse a launch whose item belongs to another project. A board that shows
 * another project's items (#1822) would otherwise start the agent in the
 * board's folder with a prompt about the other project.
 */
export function assertTrackerItemInWorkspace(
  trackerItem: TrackerRecord | undefined,
  workspacePath: string | null | undefined,
): asserts trackerItem is TrackerRecord {
  if (!trackerItem) {
    throw new Error('The tracker item is not loaded in this project.');
  }
  if (trackerItem.system.workspace !== workspacePath) {
    throw new Error(
      `This item belongs to ${trackerItem.system.workspace}, not ${workspacePath ?? 'this project'}.`,
    );
  }
}

export function buildTrackerLaunchContext(
  trackerItemId: string,
  trackerItem?: TrackerRecord,
  effectiveTemplate: string = DEFAULT_TRACKER_LAUNCH_PROMPT_TEMPLATE,
): TrackerLaunchContext {
  const title = trackerItem ? getRecordTitle(trackerItem) : trackerItemId;
  const vars = buildTrackerLaunchTemplateVars(trackerItemId, trackerItem);

  return {
    workspacePath: trackerItem?.system.workspace,
    trackerLinkId: trackerItem?.system.documentPath
      ? `file:${trackerItem.system.documentPath}`
      : trackerItemId,
    draftInput: renderTrackerLaunchPrompt(effectiveTemplate, vars),
    worktreeName: deriveTrackerWorktreeName(vars.itemId, title),
  };
}

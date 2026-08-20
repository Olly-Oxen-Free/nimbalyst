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
  trackerLinkId: string;
  draftInput: string;
  worktreeName: string;
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

export function buildTrackerLaunchContext(
  trackerItemId: string,
  trackerItem?: TrackerRecord,
  effectiveTemplate: string = DEFAULT_TRACKER_LAUNCH_PROMPT_TEMPLATE,
): TrackerLaunchContext {
  const title = trackerItem ? getRecordTitle(trackerItem) : trackerItemId;
  const vars = buildTrackerLaunchTemplateVars(trackerItemId, trackerItem);

  return {
    trackerLinkId: trackerItem?.system.documentPath
      ? `file:${trackerItem.system.documentPath}`
      : trackerItemId,
    draftInput: renderTrackerLaunchPrompt(effectiveTemplate, vars),
    worktreeName: deriveTrackerWorktreeName(vars.itemId, title),
  };
}

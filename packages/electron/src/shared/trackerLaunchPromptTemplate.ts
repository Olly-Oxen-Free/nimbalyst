import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  getRecordFieldStr,
  getRecordPriority,
  getRecordStatus,
  getRecordTitle,
} from '@nimbalyst/runtime/plugins/TrackerPlugin/trackerRecordAccessors';

export interface TrackerLaunchTemplateVars {
  itemId: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  description: string;
  sourcePath: string;
  /** Pre-formatted "type: X, status: Y, priority: Z" (only present fields), '' if none set. */
  meta: string;
  /** Pre-formatted "\n\n<description>", '' if unset. */
  descriptionBlock: string;
  /** Pre-formatted "\n\nSource: @<path>", '' if unset. */
  sourceLine: string;
}

// Composite placeholders ({meta}, {descriptionBlock}, {sourceLine}) reproduce the
// exact spacing of the pre-template hardcoded builder: a raw field placeholder
// resolves to '' when unset with no line dropped, since dropping a line that
// mixes a placeholder with a user's own static text would silently eat content
// they wrote on purpose.
export const DEFAULT_TRACKER_LAUNCH_PROMPT_TEMPLATE =
  'implement tracker item {itemId}: {title}{meta}{descriptionBlock}{sourceLine}\n\n' +
  'Update this tracker item\'s status when done using tracker_update with id "{itemId}".';

export function buildTrackerLaunchTemplateVars(
  trackerItemId: string,
  trackerItem?: TrackerRecord,
): TrackerLaunchTemplateVars {
  const title = trackerItem ? getRecordTitle(trackerItem) : trackerItemId;
  const itemId = trackerItem?.issueKey || trackerItemId;

  const type = trackerItem?.primaryType || '';
  const status = (trackerItem && getRecordStatus(trackerItem)) || '';
  const priority = (trackerItem && getRecordPriority(trackerItem)) || '';
  const description = (trackerItem && getRecordFieldStr(trackerItem, 'description')) || '';
  const sourcePath = trackerItem?.system.documentPath || '';

  const metaParts: string[] = [];
  if (type) metaParts.push(`type: ${type}`);
  if (status) metaParts.push(`status: ${status}`);
  if (priority) metaParts.push(`priority: ${priority}`);
  const meta = metaParts.length > 0 ? `\n${metaParts.join(', ')}` : '';

  const descriptionBlock = description ? `\n\n${description}` : '';
  const sourceLine = sourcePath ? `\n\nSource: @${sourcePath}` : '';

  return { itemId, title, type, status, priority, description, sourcePath, meta, descriptionBlock, sourceLine };
}

/**
 * Dumb {token} substitution -- no conditional line-dropping. A custom template
 * that references an unset field just gets an empty string in place; the
 * composite fields (meta/descriptionBlock/sourceLine) are what carry the
 * "only show this if present" behavior, computed once in buildTrackerLaunchTemplateVars.
 * An unrecognized {token} is left as literal text rather than silently deleted.
 */
export function renderTrackerLaunchPrompt(
  template: string,
  vars: TrackerLaunchTemplateVars,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const record = vars as unknown as Record<string, string>;
    return Object.prototype.hasOwnProperty.call(vars, key) ? record[key] : match;
  });
}

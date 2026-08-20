// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';
import {
  buildTrackerLaunchTemplateVars,
  renderTrackerLaunchPrompt,
} from '../trackerLaunchPromptTemplate';

function makeTrackerRecord(overrides: Partial<TrackerRecord> = {}): TrackerRecord {
  return {
    id: 'feature_1',
    primaryType: 'feature',
    typeTags: ['feature'],
    issueKey: 'NIM-1',
    source: 'native',
    archived: false,
    syncStatus: 'local',
    fields: {
      title: 'Title',
      status: 'in-progress',
      priority: 'high',
      description: 'Description text.',
    },
    system: {
      workspace: '/repo',
      createdAt: '2026-07-16T12:00:00.000Z',
      updatedAt: '2026-07-16T12:00:00.000Z',
    },
    ...overrides,
  };
}

describe('buildTrackerLaunchTemplateVars', () => {
  it('leaves composite fields empty when the tracker item has no type/status/priority/description/source', () => {
    const vars = buildTrackerLaunchTemplateVars('feature_1', makeTrackerRecord({
      primaryType: '' as unknown as string,
      fields: { title: 'Title' },
    }));

    expect(vars.meta).toBe('');
    expect(vars.descriptionBlock).toBe('');
    expect(vars.sourceLine).toBe('');
  });

  it('falls back to the raw item id/title when no tracker record is provided', () => {
    const vars = buildTrackerLaunchTemplateVars('feature_1');
    expect(vars.itemId).toBe('feature_1');
    expect(vars.title).toBe('feature_1');
    expect(vars.meta).toBe('');
  });
});

describe('renderTrackerLaunchPrompt', () => {
  it('substitutes a raw placeholder with an empty string when the field is unset, without dropping the line', () => {
    const vars = buildTrackerLaunchTemplateVars('feature_1', makeTrackerRecord({
      fields: { title: 'Title' }, // no priority
    }));

    const result = renderTrackerLaunchPrompt('Priority: {priority} (default medium)', vars);
    expect(result).toBe('Priority:  (default medium)');
  });

  it('leaves an unrecognized placeholder as literal text', () => {
    const vars = buildTrackerLaunchTemplateVars('feature_1', makeTrackerRecord());
    const result = renderTrackerLaunchPrompt('{itemId} - {notARealField}', vars);
    expect(result).toBe('NIM-1 - {notARealField}');
  });
});

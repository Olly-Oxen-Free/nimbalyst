// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { deriveTrackerCardSessionAction } from '../trackerCardSessionAction';

describe('deriveTrackerCardSessionAction', () => {
  it('returns run when the item has no linked session', () => {
    expect(deriveTrackerCardSessionAction(false, false)).toBe('run');
  });

  it('returns resume when the linked session is idle', () => {
    expect(deriveTrackerCardSessionAction(true, false)).toBe('resume');
  });

  it('returns focus when the linked session is processing', () => {
    expect(deriveTrackerCardSessionAction(true, true)).toBe('focus');
  });
});

// @vitest-environment node
/**
 * A teammate that crashed used to sound exactly like one that delivered: both
 * ended on the same completion chime, because `teammates:allCompleted` carried
 * nothing but a session id. These pin the two halves apart -- and pin the clean
 * finish to the chime it has always played, so the fix cannot regress into
 * notifying on every finish.
 */

import { describe, expect, it, vi } from 'vitest';

import { announceTeammatesCompletion, type TeammatesCompletionOutcome } from '../teammateCompletionSignal';

const announce = async (outcome: TeammatesCompletionOutcome | undefined) => {
  const playCompletionSound = vi.fn();
  const showFailureNotification = vi.fn();
  await announceTeammatesCompletion(outcome, { playCompletionSound, showFailureNotification });
  return {
    chimed: playCompletionSound.mock.calls.length > 0,
    reason: showFailureNotification.mock.calls.at(0)?.[0] as string | undefined,
  };
};

describe('announceTeammatesCompletion', () => {
  it('plays the completion chime and nothing else for a clean batch', async () => {
    expect(await announce('clean')).toEqual({ chimed: true, reason: undefined });
  });

  it('replaces the chime with a notification naming why the batch ended badly', async () => {
    const errored = await announce('errored');
    expect(errored.chimed).toBe(false);
    expect(errored.reason).toMatch(/error/);

    // The silent-death path: no error was ever thrown, the lead just died and
    // its idle teammates can no longer be resumed.
    const abandoned = await announce('abandoned');
    expect(abandoned.chimed).toBe(false);
    expect(abandoned.reason).toMatch(/abandoned/);
    expect(abandoned.reason).not.toBe(errored.reason);
  });

  it('falls back to the chime when the provider sent no outcome at all', async () => {
    expect(await announce(undefined)).toEqual({ chimed: true, reason: undefined });
  });
});

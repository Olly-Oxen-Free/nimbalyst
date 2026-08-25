// @vitest-environment jsdom
/**
 * Live-update signal listener (R5). Main forwards one `teammate:transcript-updated`
 * per logged teammate chunk; this must route into the (sessionId, agentId) atom
 * family so only the matching open popover (task 2b) refetches.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeSet = vi.fn();

vi.mock('@nimbalyst/runtime/store', () => ({
  store: { set: (...args: unknown[]) => storeSet(...args) },
}));

import { teammateTranscriptSignalAtomFamily, teammateTranscriptSignalKey } from '../../atoms/agentMode';
import { initTeammateTranscriptListeners } from '../teammateTranscriptListeners';

type Handler = (data: any) => void;

function installFakeIpc() {
  const handlers = new Map<string, Handler>();
  const unsubscribes = new Map<string, ReturnType<typeof vi.fn>>();
  (window as any).electronAPI = {
    on: (channel: string, handler: Handler) => {
      handlers.set(channel, handler);
      const unsubscribe = vi.fn();
      unsubscribes.set(channel, unsubscribe);
      return unsubscribe;
    },
  };
  return { handlers, unsubscribes };
}

describe('initTeammateTranscriptListeners', () => {
  beforeEach(() => {
    storeSet.mockReset();
  });

  it('bumps the signal atom keyed by (sessionId, agentId)', () => {
    const { handlers } = installFakeIpc();
    const dispose = initTeammateTranscriptListeners();

    handlers.get('teammate:transcript-updated')!({ sessionId: 'session-1', agentId: 'alice@team' });

    const [atom, updater] = storeSet.mock.calls[0];
    expect(atom).toEqual(teammateTranscriptSignalAtomFamily(teammateTranscriptSignalKey('session-1', 'alice@team')));
    expect((updater as (prev: number) => number)(0)).toBe(1);
    dispose();
  });

  it('ignores an event missing sessionId or agentId', () => {
    const { handlers } = installFakeIpc();
    const dispose = initTeammateTranscriptListeners();

    handlers.get('teammate:transcript-updated')!({ sessionId: 'session-1' });
    handlers.get('teammate:transcript-updated')!({ agentId: 'alice@team' });

    expect(storeSet).not.toHaveBeenCalled();
    dispose();
  });

  it('unsubscribes on dispose', () => {
    const { unsubscribes } = installFakeIpc();

    initTeammateTranscriptListeners()();

    expect(unsubscribes.get('teammate:transcript-updated')).toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
/**
 * Live-update signal listener (R4). Main forwards one `task:transcript-updated`
 * per logged Task sub-agent chunk; this must route into the (sessionId, taskId)
 * atom family so only the matching open Task surface refetches.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const storeSet = vi.fn();

vi.mock('@nimbalyst/runtime/store', () => ({
  store: { set: (...args: unknown[]) => storeSet(...args) },
}));

import { taskTranscriptSignalAtomFamily, taskTranscriptSignalKey } from '../../atoms/agentMode';
import { initTaskTranscriptListeners } from '../taskTranscriptListeners';

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

describe('initTaskTranscriptListeners', () => {
  beforeEach(() => {
    storeSet.mockReset();
  });

  it('bumps the signal atom keyed by (sessionId, taskId)', () => {
    const { handlers } = installFakeIpc();
    const dispose = initTaskTranscriptListeners();

    handlers.get('task:transcript-updated')!({ sessionId: 'session-1', taskId: 'task-7' });

    const [atom, updater] = storeSet.mock.calls[0];
    expect(atom).toEqual(taskTranscriptSignalAtomFamily(taskTranscriptSignalKey('session-1', 'task-7')));
    expect((updater as (prev: number) => number)(0)).toBe(1);
    dispose();
  });

  it('ignores an event missing sessionId or taskId', () => {
    const { handlers } = installFakeIpc();
    const dispose = initTaskTranscriptListeners();

    handlers.get('task:transcript-updated')!({ sessionId: 'session-1' });
    handlers.get('task:transcript-updated')!({ taskId: 'task-7' });

    expect(storeSet).not.toHaveBeenCalled();
    dispose();
  });

  it('unsubscribes on dispose', () => {
    const { unsubscribes } = installFakeIpc();

    initTaskTranscriptListeners()();

    expect(unsubscribes.get('task:transcript-updated')).toHaveBeenCalled();
  });
});

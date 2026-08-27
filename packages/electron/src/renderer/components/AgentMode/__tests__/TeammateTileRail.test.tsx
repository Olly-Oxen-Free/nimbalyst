// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Narrow mocks only - never the runtime barrel. The real atom module is
// replaced so a test can drive sessionTeammatesAtom's contents directly.
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom: makeAtom } = await import('jotai');
  const signalAtoms = new Map<string, PrimitiveAtom<number>>();
  const openTiles = makeAtom<string[]>([]);
  const teammates = makeAtom<unknown[]>([]);
  return {
    teammateTranscriptSignalKey: (sessionId: string, agentId: string) => `${sessionId}:${agentId}`,
    teammateTranscriptSignalAtomFamily: (key: string) => {
      let existing = signalAtoms.get(key);
      if (!existing) {
        existing = makeAtom(0);
        signalAtoms.set(key, existing);
      }
      return existing;
    },
    openTeammateTilesAtomFamily: () => openTiles,
    sessionTeammatesAtom: () => teammates,
    // Mirrors the real close atom: drop the id from the open list.
    closeTeammateTileAtom: makeAtom(
      null,
      (get, set, arg: { sessionId: string; agentId: string }) => {
        set(openTiles, get(openTiles).filter(id => id !== arg.agentId));
      },
    ),
  };
});

vi.mock('../../../store/atoms/sessions', async () => {
  const { atom: makeAtom } = await import('jotai');
  return { sessionListWorkspaceAtom: makeAtom('/ws') };
});

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="rich-transcript" data-cache-key={sessionId} />
  ),
}));

import { TeammateTileRail } from '../TeammateTileRail';
import { openTeammateTilesAtomFamily, sessionTeammatesAtom } from '../../../store/atoms/agentMode';

const getTeammateTranscript = vi.fn();
const stopTeammate = vi.fn();
const sendMessageToTeammate = vi.fn();

const openTilesAtom = openTeammateTilesAtomFamily('lead-1') as PrimitiveAtom<string[]>;
const teammatesAtom = sessionTeammatesAtom('lead-1') as unknown as PrimitiveAtom<unknown[]>;

function teammate(agentId: string, name: string, status: string) {
  return { agentId, name, status, teamName: 'squad', agentType: 'general-purpose', toolCallCount: 3 };
}

function renderRail() {
  const store = createStore();
  store.set(openTilesAtom, []);
  store.set(teammatesAtom, [
    teammate('agent-a', 'code-reviewer', 'running'),
    teammate('agent-b', 'db-migrator', 'idle'),
  ]);
  const result = render(
    <Provider store={store}>
      <TeammateTileRail sessionId="lead-1" />
    </Provider>,
  );
  return {
    ...result,
    store,
    rail: () => result.container.querySelector('.teammate-tile-rail'),
    tiles: () => Array.from(result.container.querySelectorAll('.teammate-tile')),
  };
}

async function openTile(store: ReturnType<typeof createStore>, ...agentIds: string[]) {
  await act(async () => {
    store.set(openTilesAtom, agentIds);
  });
}

describe('TeammateTileRail', () => {
  beforeEach(() => {
    getTeammateTranscript.mockReset().mockResolvedValue([{ type: 'assistant_message', content: 'hi' }]);
    stopTeammate.mockReset().mockResolvedValue({ success: true });
    sendMessageToTeammate.mockReset().mockResolvedValue({ success: true });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTeammateTranscript: getTeammateTranscript,
      aiStopTeammate: stopTeammate,
      aiSendMessageToTeammate: sendMessageToTeammate,
    };
  });

  afterEach(cleanup);

  it('renders nothing until a teammate is opened, then one tile fetching that teammate', async () => {
    const { store, rail, tiles } = renderRail();
    expect(rail()).toBeNull();

    await openTile(store, 'agent-a');

    expect(tiles()).toHaveLength(1);
    expect(getTeammateTranscript).toHaveBeenCalledWith('lead-1', 'agent-a', '/ws');
    expect(rail()!.textContent).toContain('code-reviewer');
  });

  it('opens a second concurrent tile alongside the first rather than replacing it', async () => {
    const { store, tiles } = renderRail();
    await openTile(store, 'agent-a');
    await openTile(store, 'agent-a', 'agent-b');

    expect(tiles().map(t => t.getAttribute('data-agent-id'))).toEqual(['agent-a', 'agent-b']);
  });

  it('caps the rail so the main thread keeps width priority, at a per-tile floor', async () => {
    const { store, rail, tiles } = renderRail();
    await openTile(store, 'agent-a', 'agent-b');

    expect(rail()!.getAttribute('style')).toContain('max-width: 50%');
    expect(rail()!.className).toContain('overflow-x-auto');
    expect(tiles()[0].getAttribute('style')).toContain('320px');
  });

  it('shows a Stop control for a running teammate and calls aiStopTeammate on click', async () => {
    const { store, container } = renderRail();
    await openTile(store, 'agent-a');

    await act(async () => {
      fireEvent.click(container.querySelector('.teammate-tile-stop')!);
    });

    expect(stopTeammate).toHaveBeenCalledWith('lead-1', 'agent-a', '/ws');
  });

  it('lets the architect compose and send a message to a running teammate', async () => {
    const { store, container } = renderRail();
    await openTile(store, 'agent-a');

    const textarea = container.querySelector('.teammate-tile-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'status update please' } });
    await act(async () => {
      fireEvent.click(container.querySelector('.teammate-tile-send')!);
    });

    expect(sendMessageToTeammate).toHaveBeenCalledWith('lead-1', 'agent-a', 'status update please');
  });

  it('shows no compose input for a completed teammate, since it has no process left to receive one', async () => {
    const { store, container } = renderRail();
    await act(async () => {
      store.set(teammatesAtom, [teammate('agent-a', 'code-reviewer', 'completed')]);
    });
    await openTile(store, 'agent-a');

    expect(container.querySelector('.teammate-tile-input')).toBeNull();
    expect(container.querySelector('.teammate-tile-inactive')).not.toBeNull();
  });

  it('closes only the tile whose close control was used', async () => {
    const { store, tiles, container } = renderRail();
    await openTile(store, 'agent-a', 'agent-b');

    await act(async () => {
      fireEvent.click(container.querySelectorAll('.teammate-tile-close')[0]);
    });

    expect(tiles().map(t => t.getAttribute('data-agent-id'))).toEqual(['agent-b']);
  });
});

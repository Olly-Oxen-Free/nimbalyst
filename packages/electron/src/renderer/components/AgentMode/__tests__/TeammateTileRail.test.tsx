// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Narrow mocks only - never the runtime barrel. The real atom module is
// replaced so a test can drive sessionTeammatesAtom's contents directly. Its
// export list mirrors exactly what TeammateTile imports; an export the tile no
// longer imports would be a silent no-op mock.
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom: makeAtom } = await import('jotai');
  const signalAtoms = new Map<string, PrimitiveAtom<number>>();
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
    sessionTeammatesAtom: () => teammates,
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

// The real AIInput pulls the `@nimbalyst/runtime` barrel (and the Lexical tree
// behind it). Stub it down to the three props the tile drives it with.
vi.mock('../../UnifiedAI/AIInput', () => ({
  AIInput: ({ value, onChange, onSend, sessionId, disabled }: {
    value: string;
    onChange: (next: string) => void;
    onSend: () => void;
    sessionId?: string;
    disabled?: boolean;
  }) => (
    <div data-testid="ai-input" data-session-id={sessionId}>
      <textarea
        className="ai-input-stub"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="ai-input-stub-send" onClick={() => onSend()}>Send</button>
    </div>
  ),
}));

import { TeammateTile } from '../TeammateTileRail';
import { sessionTeammatesAtom } from '../../../store/atoms/agentMode';

const getTeammateTranscript = vi.fn();
const stopTeammate = vi.fn();
const sendMessageToTeammate = vi.fn();

const teammatesAtom = sessionTeammatesAtom('lead-1') as unknown as PrimitiveAtom<unknown[]>;

function teammate(
  agentId: string,
  name: string,
  status: string,
  extra: { sessionId?: string; endReason?: string; endedAt?: number } = {},
) {
  return { agentId, name, status, teamName: 'squad', agentType: 'general-purpose', toolCallCount: 3, ...extra };
}

/** An ended row the revival gate accepts without a confirm step. */
function revivable(endReason = 'finished') {
  return teammate('agent-a', 'code-reviewer', 'completed', {
    sessionId: 'sdk-session-a',
    endReason,
    endedAt: Date.now() - 60_000,
  });
}

/** Types into the shared input's stub and hits its send control. */
async function compose(container: HTMLElement, text: string) {
  fireEvent.change(container.querySelector('.ai-input-stub') as HTMLTextAreaElement, {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(container.querySelector('.ai-input-stub-send')!);
  });
}

/**
 * Renders one teammate tile the way `TiledRegion` mounts it: the tile no
 * longer owns the open list or a close control of its own (the pane's
 * `TileHeaderBar` does), so this drives it directly off session metadata.
 */
async function renderTile(teammates: unknown[] = [
  teammate('agent-a', 'code-reviewer', 'running'),
  teammate('agent-b', 'db-migrator', 'idle'),
], composeActive = true) {
  const store = createStore();
  store.set(teammatesAtom, teammates);
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Provider store={store}>
        <TeammateTile sessionId="lead-1" agentId="agent-a" composeActive={composeActive} />
      </Provider>,
    );
  });
  return {
    ...result,
    store,
    tile: () => result.container.querySelector('.teammate-tile'),
  };
}

describe('TeammateTile', () => {
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

  it('fetches and renders the transcript of the teammate it was given', async () => {
    const { tile } = await renderTile();

    expect(getTeammateTranscript).toHaveBeenCalledWith('lead-1', 'agent-a', '/ws');
    expect(tile()!.textContent).toContain('code-reviewer');
  });

  it('shows a Stop control for a running teammate and calls aiStopTeammate on click', async () => {
    const { container } = await renderTile();

    await act(async () => {
      fireEvent.click(container.querySelector('.teammate-tile-stop')!);
    });

    expect(stopTeammate).toHaveBeenCalledWith('lead-1', 'agent-a', '/ws');
  });

  it('lets the architect compose and send a message to a running teammate', async () => {
    const { container } = await renderTile();

    await compose(container, 'status update please');

    expect(sendMessageToTeammate).toHaveBeenCalledWith('lead-1', 'agent-a', 'status update please', undefined);
  });

  // The shared input keys its undo stack and voice-command registration off
  // `sessionId`, and the lead's own compose bar is mounted at the same time, so
  // a tile has to claim a key of its own rather than the lead's.
  it('drives the shared AIInput under a tile-scoped session key', async () => {
    const { container } = await renderTile();

    expect(container.querySelector('[data-testid="ai-input"]')!.getAttribute('data-session-id'))
      .toBe('lead-1:agent-a');
  });

  it('renders no compose surface at all in a pane where another tile is focused', async () => {
    const { container } = await renderTile(undefined, false);

    expect(container.querySelector('[data-testid="ai-input"]')).toBeNull();
    expect(container.querySelector('.teammate-tile-compose')).toBeNull();
    expect(container.querySelector('.teammate-tile-inactive')).toBeNull();
  });

  // Was 'shows no compose input for a completed teammate, since it has no
  // process left to receive one'. PRD 008 inverted the premise: a completed
  // teammate's SDK session is resumable, so the gate now turns on revival
  // eligibility rather than on terminal status. This row has no sessionId,
  // which is still unrevivable.
  it('shows no compose input for a completed teammate with no SDK session to resume', async () => {
    const { container } = await renderTile([teammate('agent-a', 'code-reviewer', 'completed')]);

    expect(container.querySelector('[data-testid="ai-input"]')).toBeNull();
    expect(container.querySelector('.teammate-tile-inactive')).not.toBeNull();
  });

  it('opens compose directly for an ended teammate the backend would revive silently', async () => {
    const { container } = await renderTile([revivable()]);

    expect(container.querySelector('.teammate-tile-revive')).toBeNull();
    await compose(container, 'pick this back up');

    expect(sendMessageToTeammate).toHaveBeenCalledWith('lead-1', 'agent-a', 'pick this back up', undefined);
  });

  it('refuses compose for an ended teammate past the revival window', async () => {
    const { container } = await renderTile([
      { ...revivable(), endedAt: Date.now() - 25 * 60 * 60 * 1000 },
    ]);

    expect(container.querySelector('[data-testid="ai-input"]')).toBeNull();
    expect(container.querySelector('.teammate-tile-revive')).toBeNull();
    expect(container.querySelector('.teammate-tile-inactive')).not.toBeNull();
  });

  it('makes a user-shutdown teammate confirm a revive before compose opens, and carries the flag', async () => {
    const { container } = await renderTile([revivable('user-shutdown')]);

    expect(container.querySelector('[data-testid="ai-input"]')).toBeNull();
    await act(async () => {
      fireEvent.click(container.querySelector('.teammate-tile-revive')!);
    });
    await act(async () => {
      fireEvent.click(container.querySelector('.confirm-dialog-button-confirm')!);
    });

    await compose(container, 'back to it');

    expect(sendMessageToTeammate).toHaveBeenCalledWith('lead-1', 'agent-a', 'back to it', true);
  });

  it('sends nothing and keeps compose shut when a user-shutdown revive is cancelled', async () => {
    const { container } = await renderTile([revivable('user-shutdown')]);

    await act(async () => {
      fireEvent.click(container.querySelector('.teammate-tile-revive')!);
    });
    await act(async () => {
      fireEvent.click(container.querySelector('.confirm-dialog-button-cancel')!);
    });

    expect(sendMessageToTeammate).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="ai-input"]')).toBeNull();
    expect(container.querySelector('.teammate-tile-revive')).not.toBeNull();
  });
});

// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeammateInfo } from '../TeammatePanel';
import { TeammateThreadPopover } from '../TeammateThreadPopover';

const testState = vi.hoisted(() => ({
  teammates: [] as TeammateInfo[],
}));

// Narrowest mocks: the two source atoms the popover reads, and the transcript
// renderer (mocking its deep path keeps the runtime barrel out of the graph).
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom } = await import('jotai');
  const teammatesAtom = atom(() => testState.teammates);
  const signalAtoms = new Map<string, PrimitiveAtom<number>>();
  return {
    sessionTeammatesAtom: () => teammatesAtom,
    teammateTranscriptSignalKey: (sessionId: string, agentId: string) => `${sessionId}:${agentId}`,
    teammateTranscriptSignalAtomFamily: (key: string) => {
      let existing = signalAtoms.get(key);
      if (!existing) {
        existing = atom(0);
        signalAtoms.set(key, existing);
      }
      return existing;
    },
  };
});

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({
    messages,
    agentName,
    agentModel,
  }: { messages: unknown[]; agentName?: string; agentModel?: string }) => (
    <div
      data-testid="rich-transcript"
      data-message-count={messages.length}
      data-agent-name={agentName}
      data-agent-model={agentModel}
    />
  ),
}));

import {
  teammateTranscriptSignalAtomFamily,
  teammateTranscriptSignalKey,
} from '../../../store/atoms/agentMode';

const getTeammateTranscript = vi.fn();
const sendMessageToTeammate = vi.fn();
const stopTeammate = vi.fn();

function teammate(status: TeammateInfo['status']): TeammateInfo {
  return {
    name: 'scout',
    agentId: 'agent-scout',
    teamName: 'squad',
    agentType: 'general',
    status,
    model: 'sonnet',
    startedAt: 1_700_000_000_000,
    toolCallCount: 3,
  };
}

function message(text: string) {
  return { type: 'assistant_message', content: text };
}

async function renderPopover() {
  const store = createStore();
  const anchorEl = document.createElement('button');
  document.body.appendChild(anchorEl);
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Provider store={store}>
        <TeammateThreadPopover
          sessionId="lead-1"
          agentId="agent-scout"
          teammateName="scout"
          workspacePath="/ws"
          anchorEl={anchorEl}
          onClose={() => {}}
        />
      </Provider>,
    );
  });
  return { ...result, store };
}

describe('TeammateThreadPopover', () => {
  beforeEach(() => {
    testState.teammates = [teammate('running')];
    getTeammateTranscript.mockReset().mockResolvedValue([message('hello')]);
    sendMessageToTeammate.mockReset().mockResolvedValue({ success: true });
    stopTeammate.mockReset().mockResolvedValue({ success: true });
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTeammateTranscript: getTeammateTranscript,
      aiSendMessageToTeammate: sendMessageToTeammate,
      aiStopTeammate: stopTeammate,
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('fetches the teammate transcript on open and renders it through RichTranscriptView', async () => {
    const { baseElement } = await renderPopover();

    expect(getTeammateTranscript).toHaveBeenCalledWith('lead-1', 'agent-scout', '/ws');
    expect(
      baseElement.querySelector('[data-testid="rich-transcript"]')?.getAttribute('data-message-count'),
    ).toBe('1');
  });

  it('passes the teammate name and model through to RichTranscriptView', async () => {
    const { baseElement } = await renderPopover();

    const transcript = baseElement.querySelector('[data-testid="rich-transcript"]');
    expect(transcript?.getAttribute('data-agent-name')).toBe('scout');
    expect(transcript?.getAttribute('data-agent-model')).toBe('sonnet');
  });

  it('refetches, debounced, when the teammate transcript signal bumps', async () => {
    vi.useFakeTimers();
    const { store } = await renderPopover();
    expect(getTeammateTranscript).toHaveBeenCalledTimes(1);

    const signalAtom = teammateTranscriptSignalAtomFamily(
      teammateTranscriptSignalKey('lead-1', 'agent-scout'),
    ) as PrimitiveAtom<number>;
    await act(async () => {
      store.set(signalAtom, 1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getTeammateTranscript).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(getTeammateTranscript).toHaveBeenCalledTimes(2);
  });

  it('shows an explicit empty state when the teammate has logged no chunks', async () => {
    getTeammateTranscript.mockResolvedValue([]);
    const { baseElement } = await renderPopover();

    expect(baseElement.querySelector('.teammate-thread-popover-empty')).not.toBeNull();
    expect(baseElement.querySelector('[data-testid="rich-transcript"]')).toBeNull();
  });

  it.each([
    ['running', true],
    ['blocked', true],
    ['idle', true],
    ['completed', false],
    ['errored', false],
  ] as [TeammateInfo['status'], boolean][])(
    'renders the transcript for a %s teammate and gates compose to active ones',
    async (status, composeAvailable) => {
      testState.teammates = [teammate(status)];
      const { baseElement } = await renderPopover();

      expect(baseElement.querySelector('[data-testid="rich-transcript"]')).not.toBeNull();
      expect(baseElement.querySelector('.teammate-thread-popover-input') !== null).toBe(composeAvailable);
      expect(baseElement.querySelector('.teammate-thread-popover-inactive') === null).toBe(composeAvailable);
    },
  );

  it('sends a message to a running teammate and reports delivery', async () => {
    const { baseElement } = await renderPopover();

    const input = baseElement.querySelector('.teammate-thread-popover-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'status?' } });
    await act(async () => {
      fireEvent.click(baseElement.querySelector('.teammate-thread-popover-send') as HTMLElement);
    });

    expect(sendMessageToTeammate).toHaveBeenCalledWith('lead-1', 'agent-scout', 'status?');
    expect(baseElement.querySelector('.teammate-thread-popover-status')?.textContent).toContain('Sent');
  });

  it('reports a failed delivery without clearing the draft', async () => {
    sendMessageToTeammate.mockResolvedValue({ success: false });
    const { baseElement } = await renderPopover();

    const input = baseElement.querySelector('.teammate-thread-popover-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'status?' } });
    await act(async () => {
      fireEvent.click(baseElement.querySelector('.teammate-thread-popover-send') as HTMLElement);
    });

    expect(input.value).toBe('status?');
    expect(baseElement.querySelector('.teammate-thread-popover-status')?.textContent).toContain('Failed');
  });

  it.each([
    ['running', true],
    ['blocked', true],
    ['idle', false],
    ['completed', false],
    ['errored', false],
  ] as [TeammateInfo['status'], boolean][])(
    'shows the Stop button only for a %s teammate',
    async (status, stopVisible) => {
      testState.teammates = [teammate(status)];
      const { baseElement } = await renderPopover();

      expect(baseElement.querySelector('.teammate-thread-popover-stop') !== null).toBe(stopVisible);
    },
  );

  it('stops the teammate and disables the button while the stop is in flight', async () => {
    let resolveStop!: (value: { success: boolean }) => void;
    stopTeammate.mockReturnValue(new Promise((resolve) => { resolveStop = resolve; }));
    const { baseElement } = await renderPopover();

    const stopButton = baseElement.querySelector('.teammate-thread-popover-stop') as HTMLButtonElement;
    await act(async () => {
      fireEvent.click(stopButton);
    });

    expect(stopTeammate).toHaveBeenCalledWith('lead-1', 'agent-scout', '/ws');
    expect(stopButton.disabled).toBe(true);

    await act(async () => {
      resolveStop({ success: true });
    });
    expect(stopButton.disabled).toBe(false);
  });
});

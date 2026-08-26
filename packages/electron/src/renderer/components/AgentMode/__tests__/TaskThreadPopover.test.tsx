// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore, type PrimitiveAtom } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskThreadPopover } from '../TaskThreadPopover';

// Narrowest mocks: the two atoms the popover reads, and the transcript renderer
// (mocking its deep path keeps the runtime barrel out of the graph).
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom } = await import('jotai');
  const signalAtoms = new Map<string, PrimitiveAtom<number>>();
  return {
    taskTranscriptSignalKey: (sessionId: string, taskId: string) => `${sessionId}:${taskId}`,
    taskTranscriptSignalAtomFamily: (key: string) => {
      let existing = signalAtoms.get(key);
      if (!existing) {
        existing = atom(0);
        signalAtoms.set(key, existing);
      }
      return existing;
    },
  };
});

vi.mock('../../../store/atoms/sessions', async () => {
  const { atom } = await import('jotai');
  return { sessionListWorkspaceAtom: atom('/ws') };
});

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({ messages }: { messages: unknown[] }) => (
    <div data-testid="rich-transcript" data-message-count={messages.length} />
  ),
}));

import {
  taskTranscriptSignalAtomFamily,
  taskTranscriptSignalKey,
} from '../../../store/atoms/agentMode';

const getTaskTranscript = vi.fn();

/** Past the hover-intent open delay; the popover mounts and fetches here. */
const OPEN_DELAY = 250;
/** Past the close delay applied on mouse-leave. */
const CLOSE_DELAY = 200;

function renderTrigger() {
  const store = createStore();
  const result = render(
    <Provider store={store}>
      <TaskThreadPopover
        sessionId="lead-1"
        taskId="task-7"
        label="db-migration"
        status="blocked"
        lastToolName="Bash"
      >
        <span className="chip">db-migration</span>
      </TaskThreadPopover>
    </Provider>,
  );
  return {
    ...result,
    store,
    trigger: result.container.querySelector('.task-thread-popover-trigger') as HTMLElement,
    popover: () => document.querySelector('.task-thread-popover'),
  };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('TaskThreadPopover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getTaskTranscript.mockReset().mockResolvedValue([{ type: 'assistant_message', content: 'hi' }]);
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTaskSubagentTranscript: getTaskTranscript,
    };
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('opens on hover with the task transcript, and carries the retired status popover fields', async () => {
    const { trigger, popover } = renderTrigger();
    expect(popover()).toBeNull();

    fireEvent.mouseEnter(trigger);
    await advance(OPEN_DELAY);

    expect(getTaskTranscript).toHaveBeenCalledWith('lead-1', { taskId: 'task-7' }, '/ws');
    const el = popover()!;
    expect(el.textContent).toContain('db-migration');
    expect(el.textContent).toContain('Blocked');
    expect(el.textContent).toContain('Bash');
    expect(el.querySelector('[data-testid="rich-transcript"]')?.getAttribute('data-message-count'))
      .toBe('1');
    // Read-only: no compose input, no stop control.
    expect(el.querySelector('textarea')).toBeNull();
    expect(el.querySelector('button')).toBeNull();
  });

  it('never opens or fetches for a pointer that passes over without pausing', async () => {
    const { trigger, popover } = renderTrigger();

    fireEvent.mouseEnter(trigger);
    await advance(80);
    fireEvent.mouseLeave(trigger);
    await advance(1_000);

    expect(popover()).toBeNull();
    expect(getTaskTranscript).not.toHaveBeenCalled();
  });

  it('dismisses on mouse-leave', async () => {
    const { trigger, popover } = renderTrigger();
    fireEvent.mouseEnter(trigger);
    await advance(OPEN_DELAY);
    expect(popover()).not.toBeNull();

    fireEvent.mouseLeave(trigger);
    await advance(CLOSE_DELAY);

    expect(popover()).toBeNull();
  });

  it('refetches, debounced, when the task transcript signal bumps', async () => {
    const { trigger, store } = renderTrigger();
    fireEvent.mouseEnter(trigger);
    await advance(OPEN_DELAY);
    expect(getTaskTranscript).toHaveBeenCalledTimes(1);

    const signalAtom = taskTranscriptSignalAtomFamily(
      taskTranscriptSignalKey('lead-1', 'task-7'),
    ) as PrimitiveAtom<number>;
    await act(async () => {
      store.set(signalAtom, 1);
    });
    await advance(1_000);
    expect(getTaskTranscript).toHaveBeenCalledTimes(1);

    await advance(1_000);
    expect(getTaskTranscript).toHaveBeenCalledTimes(2);
  });
});

// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore } from 'jotai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeammateInfo } from '../TeammatePanel';
import type { TaskInfo } from '../../../store/atoms/agentMode';
import { SubAgentChipRow, type SubAgentChipRowProps } from '../SubAgentChipRow';

const testState = vi.hoisted(() => ({
  teammates: [] as TeammateInfo[],
  tasks: [] as TaskInfo[],
  openTiles: [] as string[],
  openInline: new Set<string>(),
}));

// Narrowest possible mock: only the source atom families. The normalized
// status mapping under test (subAgentStatus.ts) stays real.
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom } = await import('jotai');
  const teammatesAtom = atom(() => testState.teammates);
  const tasksAtom = atom(() => testState.tasks);
  const signalAtom = atom(0);
  const openTilesAtom = atom(() => testState.openTiles);
  const openInlineAtom = atom(() => testState.openInline);
  return {
    sessionTeammatesAtom: () => teammatesAtom,
    sessionTasksAtom: () => tasksAtom,
    taskTranscriptSignalKey: (sessionId: string, taskId: string) => `${sessionId}:${taskId}`,
    taskTranscriptSignalAtomFamily: () => signalAtom,
    openTaskTilesAtomFamily: () => openTilesAtom,
    openTaskInlineExpandAtomFamily: () => openInlineAtom,
  };
});

vi.mock('../../../store/atoms/sessions', async () => {
  const { atom } = await import('jotai');
  return { sessionListWorkspaceAtom: atom('/ws') };
});

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: () => <div data-testid="rich-transcript" />,
}));

function teammate(name: string, status: TeammateInfo['status'], teamName = 'squad'): TeammateInfo {
  return { name, agentId: `agent-${name}`, teamName, agentType: 'general', status };
}

function task(description: string, status: TaskInfo['status'], lastToolName?: string, toolUseId?: string): TaskInfo {
  return {
    taskId: `task-${description}`,
    description,
    status,
    startedAt: 0,
    toolCount: 0,
    tokenCount: 0,
    durationMs: 0,
    lastToolName,
    toolUseId,
  };
}

function renderRow(props?: Partial<SubAgentChipRowProps>) {
  const result = render(
    <Provider store={createStore()}>
      <SubAgentChipRow sessionId="s1" {...props} />
    </Provider>
  );
  return {
    ...result,
    chips: () => Array.from(result.container.querySelectorAll<HTMLElement>('.sub-agent-chip')),
  };
}

describe('SubAgentChipRow', () => {
  beforeEach(() => {
    testState.teammates = [];
    testState.tasks = [];
    testState.openTiles = [];
    testState.openInline = new Set();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the session has no teammates or tasks', () => {
    const { container } = renderRow();
    expect(container.firstChild).toBeNull();
  });

  it('renders one chip per teammate and task, skipping legacy _background/_subagent entries', () => {
    testState.teammates = [
      teammate('code-reviewer', 'running'),
      teammate('legacy-bg', 'running', '_background'),
      teammate('legacy-sub', 'running', '_subagent'),
    ];
    testState.tasks = [task('db-migration', 'blocked')];

    const { chips } = renderRow();
    expect(chips().map(c => c.textContent)).toEqual(['code-reviewer', 'db-migration']);
    expect(chips().map(c => c.dataset.kind)).toEqual(['teammate', 'task']);
  });

  it('drives each chip from the normalized SubAgentStatus, not the raw status', () => {
    testState.teammates = [
      teammate('a', 'running'),
      teammate('b', 'idle'),
      teammate('c', 'blocked'),
      // Terminal states stay on screen; nothing dismisses them on a timer.
      teammate('d', 'completed'),
      teammate('e', 'errored'),
    ];
    // 'stopped' is an abnormal-termination path, so it normalizes to error too.
    testState.tasks = [task('t', 'stopped')];

    const { chips } = renderRow();
    expect(chips().map(c => c.dataset.status)).toEqual([
      'working', 'waiting', 'blocked', 'complete', 'error', 'error',
    ]);
    // Status is conveyed by an accessible label, not color alone.
    expect(chips()[2].getAttribute('aria-label')).toBe('c — blocked');
  });

  it('is inert until a click handler is supplied', () => {
    testState.teammates = [teammate('code-reviewer', 'running')];

    expect(renderRow().chips()[0].getAttribute('role')).toBe('listitem');
    cleanup();

    const onTeammateClick = vi.fn();
    const { chips } = renderRow({ onTeammateClick });
    chips()[0].click();
    expect(chips()[0].getAttribute('role')).toBe('button');
    expect(onTeammateClick).toHaveBeenCalledWith('agent-code-reviewer', chips()[0]);
  });

  describe('Task chips', () => {
    it('opens no popover on click - onTaskClick fires but stays unconsumed', async () => {
      testState.tasks = [task('db-migration', 'blocked', 'Bash')];

      const onTaskClick = vi.fn();
      const { chips } = renderRow({ onTeammateClick: vi.fn(), onTaskClick });
      await act(async () => { chips()[0].click(); });

      expect(onTaskClick).toHaveBeenCalledWith('task-db-migration');
      expect(document.querySelector('.sub-agent-task-status-popover')).toBeNull();
      expect(document.querySelector('.task-thread-popover')).toBeNull();
    });

    it('wraps each Task chip - and only Task chips - in a hover thread trigger', () => {
      testState.teammates = [teammate('code-reviewer', 'running')];
      testState.tasks = [task('db-migration', 'blocked')];

      const { container, chips } = renderRow({ onTeammateClick: vi.fn() });
      const triggers = container.querySelectorAll('.task-thread-popover-trigger');
      expect(triggers).toHaveLength(1);
      expect(triggers[0].contains(chips().find(c => c.dataset.kind === 'task')!)).toBe(true);
    });

    it('shows the open-indicator dot when the task is tiled', () => {
      testState.tasks = [task('db-migration', 'blocked')];
      testState.openTiles = ['task-db-migration'];

      const { chips } = renderRow();
      expect(chips()[0].dataset.open).toBe('true');
      expect(chips()[0].querySelector('.sub-agent-chip-open-dot')).not.toBeNull();
    });

    it('shows the open-indicator dot when the task is inline-expanded, joined via toolUseId', () => {
      testState.tasks = [task('db-migration', 'blocked', undefined, 'tool-abc')];
      testState.openInline = new Set(['tool-abc']);

      const { chips } = renderRow();
      expect(chips()[0].dataset.open).toBe('true');
    });

    it('shows no open-indicator when neither surface has the task open', () => {
      testState.tasks = [task('db-migration', 'blocked', undefined, 'tool-abc')];
      testState.openTiles = ['task-some-other-task'];
      testState.openInline = new Set(['tool-unrelated']);

      const { chips } = renderRow();
      expect(chips()[0].dataset.open).toBeUndefined();
      expect(chips()[0].querySelector('.sub-agent-chip-open-dot')).toBeNull();
    });

    it('never shows the open-indicator on a teammate chip', () => {
      testState.teammates = [teammate('code-reviewer', 'running')];
      testState.openTiles = ['agent-code-reviewer']; // wrong id space on purpose

      const { chips } = renderRow({ onTeammateClick: vi.fn() });
      expect(chips()[0].dataset.open).toBeUndefined();
    });
  });
});

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
}));

// Narrowest possible mock: only the two source atom families. The normalized
// status mapping under test (subAgentStatus.ts) stays real.
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom } = await import('jotai');
  const teammatesAtom = atom(() => testState.teammates);
  const tasksAtom = atom(() => testState.tasks);
  return {
    sessionTeammatesAtom: () => teammatesAtom,
    sessionTasksAtom: () => tasksAtom,
  };
});

function teammate(name: string, status: TeammateInfo['status'], teamName = 'squad'): TeammateInfo {
  return { name, agentId: `agent-${name}`, teamName, agentType: 'general', status };
}

function task(description: string, status: TaskInfo['status'], lastToolName?: string): TaskInfo {
  return {
    taskId: `task-${description}`,
    description,
    status,
    startedAt: 0,
    toolCount: 0,
    tokenCount: 0,
    durationMs: 0,
    lastToolName,
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

  describe('Task-chip read-only status popover', () => {
    it('opens on a Task chip click and shows status + active tool name', async () => {
      testState.teammates = [teammate('code-reviewer', 'running')];
      testState.tasks = [task('db-migration', 'blocked', 'Bash')];

      const onTeammateClick = vi.fn();
      const { chips } = renderRow({ onTeammateClick });
      const taskChip = chips().find(c => c.dataset.kind === 'task')!;
      await act(async () => { taskChip.click(); });

      const popover = document.querySelector('.sub-agent-task-status-popover');
      expect(popover).not.toBeNull();
      expect(popover!.textContent).toContain('db-migration');
      expect(popover!.textContent).toContain('Blocked');
      expect(popover!.textContent).toContain('Bash');
    });

    it('shows an explicit empty state when there is no active tool', async () => {
      testState.tasks = [task('docs-update', 'running')];

      const { chips } = renderRow({ onTeammateClick: vi.fn() });
      await act(async () => { chips()[0].click(); });

      expect(document.querySelector('.sub-agent-task-status-popover')!.textContent).toContain('—');
    });

    it('does not open for a Teammate chip click, and leaves onTeammateClick unaffected', async () => {
      testState.teammates = [teammate('code-reviewer', 'running')];
      testState.tasks = [task('db-migration', 'blocked')];

      const onTeammateClick = vi.fn();
      const { chips } = renderRow({ onTeammateClick });
      const teammateChip = chips().find(c => c.dataset.kind === 'teammate')!;
      await act(async () => { teammateChip.click(); });

      expect(onTeammateClick).toHaveBeenCalledWith('agent-code-reviewer', teammateChip);
      expect(document.querySelector('.sub-agent-task-status-popover')).toBeNull();
    });

    it('dismisses on outside click', async () => {
      testState.tasks = [task('db-migration', 'blocked')];
      const { chips } = renderRow({ onTeammateClick: vi.fn() });
      await act(async () => { chips()[0].click(); });
      expect(document.querySelector('.sub-agent-task-status-popover')).not.toBeNull();

      await act(async () => {
        fireEvent.pointerDown(document.body);
      });

      expect(document.querySelector('.sub-agent-task-status-popover')).toBeNull();
    });

    it('dismisses on Escape', async () => {
      testState.tasks = [task('db-migration', 'blocked')];
      const { chips } = renderRow({ onTeammateClick: vi.fn() });
      await act(async () => { chips()[0].click(); });
      expect(document.querySelector('.sub-agent-task-status-popover')).not.toBeNull();

      await act(async () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });

      expect(document.querySelector('.sub-agent-task-status-popover')).toBeNull();
    });
  });
});

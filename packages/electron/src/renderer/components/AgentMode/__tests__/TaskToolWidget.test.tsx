import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultStore } from 'jotai';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import { TaskToolWidget } from '../TaskToolWidget';
import { openTaskInlineExpandAtomFamily, type TaskInfo } from '../../../store/atoms/agentMode';
import { sessionStoreAtom } from '../../../store/atoms/sessions';

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({ messages }: { messages: TranscriptViewMessage[] }) => (
    <div data-testid="task-transcript">{messages.length} messages</div>
  ),
}));

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

const aiGetTaskSubagentTranscript = vi.fn();

function makeMessage(): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(1_784_648_445_000),
    type: 'subagent',
    subagentId: 'sub-1',
    subagent: { agentType: 'general-purpose' },
    toolCall: {
      toolName: 'Task',
      toolDisplayName: 'Task',
      status: 'completed',
      description: null,
      arguments: { description: 'Audit the config', subagent_type: 'general-purpose' },
      targetFilePath: null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId: 'toolu_task_1',
      progress: [],
      result: 'done',
    },
  } as unknown as TranscriptViewMessage;
}

function makeMessageWithoutResult(): TranscriptViewMessage {
  const message = makeMessage() as unknown as { toolCall: { result?: string } };
  delete message.toolCall.result;
  return message as unknown as TranscriptViewMessage;
}

function renderWidget(isExpanded: boolean, onToggle = () => {}, message = makeMessage()) {
  return render(
    <TaskToolWidget
      message={message}
      isExpanded={isExpanded}
      onToggle={onToggle}
      workspacePath="/workspace"
      sessionId="session-1"
    />,
  );
}

function seedTask(status: TaskInfo['status']) {
  getDefaultStore().set(sessionStoreAtom('session-1'), {
    metadata: {
      currentTasks: [
        {
          taskId: 't1',
          description: 'Audit the config',
          status,
          startedAt: 0,
          toolUseId: 'toolu_task_1',
          toolCount: 0,
          tokenCount: 0,
          durationMs: 0,
        } satisfies TaskInfo,
      ],
    },
  } as any);
}

describe('TaskToolWidget', () => {
  beforeEach(() => {
    aiGetTaskSubagentTranscript.mockReset();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTaskSubagentTranscript,
    };
  });

  afterEach(() => {
    getDefaultStore().set(sessionStoreAtom('session-1'), null);
  });

  it.each<[TaskInfo['status'], string]>([
    ['running', 'Running'],
    ['blocked', 'Blocked'],
    ['completed', 'Done'],
    ['failed', 'Errored'],
    ['stopped', 'Stopped'],
  ])('maps TaskInfo status %s to chip text %s', (status, chipText) => {
    seedTask(status);
    const { container } = renderWidget(false);
    expect(container.querySelector('.subagent-status-chip')?.textContent).toContain(chipText);
  });

  it('falls back to completed when there is no task record but the tool has a result, else running', () => {
    // No seedTask() call in either case: sessionTasksAtom resolves to [].
    const { container: withResult } = renderWidget(false);
    expect(withResult.querySelector('.subagent-status-chip')?.textContent).toContain('Done');

    const { container: withoutResult } = renderWidget(false, () => {}, makeMessageWithoutResult());
    expect(withoutResult.querySelector('.subagent-status-chip')?.textContent).toContain('Running');
  });

  it('does not fetch while collapsed and fetches by toolUseId once expanded', async () => {
    aiGetTaskSubagentTranscript.mockResolvedValue([{ id: 2 } as TranscriptViewMessage]);

    const { rerender } = renderWidget(false);
    expect(aiGetTaskSubagentTranscript).not.toHaveBeenCalled();

    rerender(
      <TaskToolWidget
        message={makeMessage()}
        isExpanded={true}
        onToggle={() => {}}
        workspacePath="/workspace"
        sessionId="session-1"
      />,
    );

    await waitFor(() => expect(screen.getByTestId('task-transcript')).toBeDefined());
    expect(aiGetTaskSubagentTranscript).toHaveBeenCalledWith(
      'session-1',
      { toolUseId: 'toolu_task_1' },
      '/workspace',
    );
  });

  it('calls onToggle when the header is clicked', () => {
    const onToggle = vi.fn();
    const { container } = renderWidget(false, onToggle);

    fireEvent.click(container.querySelector('.task-tool-widget-header')!);

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when the toolUseId resolves to no transcript', async () => {
    aiGetTaskSubagentTranscript.mockResolvedValue([]);

    renderWidget(true);

    await waitFor(() =>
      expect(screen.getByText('No activity yet from this sub-agent.')).toBeDefined(),
    );
  });

  it('syncs its expand state into openTaskInlineExpandAtomFamily, keyed by toolUseId, for the chip row to read', () => {
    const inlineExpandAtom = openTaskInlineExpandAtomFamily('session-1');
    const store = getDefaultStore();

    const { unmount, rerender } = renderWidget(false);
    expect(store.get(inlineExpandAtom).has('toolu_task_1')).toBe(false);

    rerender(
      <TaskToolWidget
        message={makeMessage()}
        isExpanded={true}
        onToggle={() => {}}
        workspacePath="/workspace"
        sessionId="session-1"
      />,
    );
    expect(store.get(inlineExpandAtom).has('toolu_task_1')).toBe(true);

    // Cleared on unmount too, so a message scrolled out of a virtualized list
    // doesn't leave a stale dot lit on the chip.
    unmount();
    expect(store.get(inlineExpandAtom).has('toolu_task_1')).toBe(false);
  });
});

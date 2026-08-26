import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptViewMessage } from '@nimbalyst/runtime/ai/server/types';
import { TaskToolWidget } from '../TaskToolWidget';

vi.mock('@nimbalyst/runtime/ui/AgentTranscript/components/RichTranscriptView', () => ({
  RichTranscriptView: ({ messages }: { messages: TranscriptViewMessage[] }) => (
    <div data-testid="task-transcript">{messages.length} messages</div>
  ),
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

function renderWidget(isExpanded: boolean, onToggle = () => {}) {
  return render(
    <TaskToolWidget
      message={makeMessage()}
      isExpanded={isExpanded}
      onToggle={onToggle}
      workspacePath="/workspace"
      sessionId="session-1"
    />,
  );
}

describe('TaskToolWidget', () => {
  beforeEach(() => {
    aiGetTaskSubagentTranscript.mockReset();
    (window as unknown as { electronAPI: unknown }).electronAPI = {
      aiGetTaskSubagentTranscript,
    };
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
});

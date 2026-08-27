import React from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TranscriptViewMessage } from '../../../../ai/server/transcript/TranscriptProjector';
import { setTranscriptToolWidgets } from '../../contributions';
import { RichTranscriptView } from '../RichTranscriptView';

vi.mock('virtua', async () => {
  const ReactModule = await import('react');
  return {
    VList: ReactModule.forwardRef(({ children }: { children: React.ReactNode }, ref) => {
      ReactModule.useImperativeHandle(ref, () => ({
        cache: undefined,
        scrollOffset: 0,
        scrollSize: 300,
        viewportSize: 100,
        findItemIndex: () => 0,
        scrollToIndex: vi.fn(),
      }));
      return <div data-testid="mock-vlist">{ReactModule.Children.toArray(children)}</div>;
    }),
  };
});

const SOURCE = 'task-widget-gate-test';

function StubWidget() {
  return <div data-testid="stub-task-widget" />;
}

function makeTaskMessage(
  subagent: TranscriptViewMessage['subagent'],
  toolName = 'Task',
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(1_784_648_445_000),
    type: 'subagent',
    subagentId: 'sub-1',
    subagent,
    toolCall: {
      toolName,
      toolDisplayName: toolName,
      status: 'completed',
      description: null,
      arguments: { description: 'Do the thing', prompt: 'Do the thing' },
      targetFilePath: null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId: 'toolu_task_1',
      progress: [],
      result: 'done',
    },
  } as TranscriptViewMessage;
}

function renderTranscript(message: TranscriptViewMessage) {
  return render(
    <RichTranscriptView
      sessionId="gate-1"
      sessionStatus="idle"
      messages={[message]}
      workspacePath="/workspace"
      persistScrollState={false}
    />,
  );
}

// A `Task`-keyed custom widget must take over plain sub-agent spawns WITHOUT
// swallowing teammate spawns: teammates go through the same `Task` tool and the
// same registry lookup, so an ungated lookup silently blanks their card.
describe('RichTranscriptView Task widget gate', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    setTranscriptToolWidgets(SOURCE, {
      Task: StubWidget,
      Agent: StubWidget,
      some_other_tool: StubWidget,
    });
  });

  afterEach(() => {
    setTranscriptToolWidgets(SOURCE, undefined);
  });

  it('routes a plain Task sub-agent spawn to the registered widget', () => {
    const { container } = renderTranscript(makeTaskMessage({ agentType: 'general-purpose' } as any));

    expect(container.querySelector('[data-testid="stub-task-widget"]')).not.toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card.sub-agent')).toBeNull();
  });

  it('leaves a teammate spawn on its existing teammate card', () => {
    const { container } = renderTranscript(
      makeTaskMessage({ teammateName: 'Ada', teamName: 'core', teammateMode: 'implementer' } as any),
    );

    expect(container.querySelector('[data-testid="stub-task-widget"]')).toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card.teammate')).not.toBeNull();
  });

  // Task 1a's synthetic tool-pair for a name-only spawn: tool_use name stays
  // 'Task', args carry `name` but no `team_name`. isTeammate must still key off
  // `teammateName` alone (RichTranscriptView.tsx:1756's `||`), so this must not
  // fall through to the registered Task widget.
  it('routes a name-only spawn (no team_name) to the teammate card, not the widget', () => {
    const { container } = renderTranscript(
      makeTaskMessage({ teammateName: 'Ada', teammateMode: 'implementer' } as any),
    );

    expect(container.querySelector('[data-testid="stub-task-widget"]')).toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card.teammate')).not.toBeNull();
  });

  // The live SDK calls the spawn tool `Agent`, not `Task` — this is the real
  // shape a name-less delegation arrives in, distinct from the synthetic
  // 'Task'-named teammate pair kept by task 1a.
  it('routes a plain Agent sub-agent spawn (no name arg) to the registered widget', () => {
    const { container } = renderTranscript(
      makeTaskMessage({ agentType: 'general-purpose' } as any, 'Agent'),
    );

    expect(container.querySelector('[data-testid="stub-task-widget"]')).not.toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card.sub-agent')).toBeNull();
  });

  it('leaves a name-carrying Agent spawn on its teammate card, not the widget', () => {
    const { container } = renderTranscript(
      makeTaskMessage(
        { teammateName: 'Ada', teamName: 'core', teammateMode: 'implementer' } as any,
        'Agent',
      ),
    );

    expect(container.querySelector('[data-testid="stub-task-widget"]')).toBeNull();
    expect(container.querySelector('.rich-transcript-tool-card.teammate')).not.toBeNull();
  });

  it('still resolves widgets for non-Task tools', () => {
    const { container } = renderTranscript({
      ...makeTaskMessage(undefined, 'some_other_tool'),
      type: 'tool_call',
      subagentId: null,
    } as TranscriptViewMessage);

    expect(container.querySelector('[data-testid="stub-task-widget"]')).not.toBeNull();
  });
});

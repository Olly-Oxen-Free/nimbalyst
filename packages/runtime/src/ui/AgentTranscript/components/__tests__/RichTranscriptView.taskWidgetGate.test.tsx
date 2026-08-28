import React from 'react';
import { fireEvent, render } from '@testing-library/react';
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

function StubWidget({
  isExpanded,
  onToggle,
}: {
  isExpanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      data-testid="stub-task-widget"
      data-expanded={isExpanded ? 'true' : 'false'}
      onClick={onToggle}
    />
  );
}

function makeTaskMessage(
  subagent: TranscriptViewMessage['subagent'],
  toolName = 'Task',
  subagentId = 'sub-1',
  providerToolCallId = 'toolu_task_1',
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(1_784_648_445_000),
    type: 'subagent',
    subagentId,
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
      providerToolCallId,
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

function makeAssistantMessage(): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(1_784_648_445_000),
    type: 'assistant_message',
    text: 'Hello there',
    subagentId: null,
  } as TranscriptViewMessage;
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

  // REVIEWER CORRECTION M4: subagentId must equal providerToolCallId, matching
  // real parser output (ClaudeCodeRawParser.ts:524/:572-573). A mismatched
  // fixture (e.g. subagentId 'sub-1' vs providerToolCallId 'toolu_task_1')
  // dodges the auto-expand bug because the effect keys expandedTools by
  // subagentId while the card looks up expandedTools by providerToolCallId.
  it('mounts a subagent spawn collapsed', () => {
    const message = makeTaskMessage(
      { agentType: 'general-purpose' } as any,
      'Task',
      'toolu_task_1',
      'toolu_task_1',
    );
    const { container } = renderTranscript(message);

    const widget = container.querySelector('[data-testid="stub-task-widget"]');
    expect(widget).not.toBeNull();
    expect(widget?.getAttribute('data-expanded')).toBe('false');
  });

  it('does not re-expand a collapsed subagent widget when a new message is appended', () => {
    const message = makeTaskMessage(
      { agentType: 'general-purpose' } as any,
      'Task',
      'toolu_task_1',
      'toolu_task_1',
    );
    const { container, rerender } = renderTranscript(message);

    const getWidget = () => container.querySelector('[data-testid="stub-task-widget"]');

    // Open, then close.
    fireEvent.click(getWidget()!);
    expect(getWidget()?.getAttribute('data-expanded')).toBe('true');
    fireEvent.click(getWidget()!);
    expect(getWidget()?.getAttribute('data-expanded')).toBe('false');

    // Appending a new message must not resurrect the collapsed state.
    const secondMessage: TranscriptViewMessage = {
      ...message,
      id: 2,
      sequence: 2,
    };
    rerender(
      <RichTranscriptView
        sessionId="gate-1"
        sessionStatus="idle"
        messages={[message, secondMessage]}
        workspacePath="/workspace"
        persistScrollState={false}
      />,
    );

    expect(getWidget()?.getAttribute('data-expanded')).toBe('false');
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

describe('RichTranscriptView assistant header identity override', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('renders agentName and agentModel in the assistant group header when provided', () => {
    const { container } = render(
      <RichTranscriptView
        sessionId="gate-1"
        sessionStatus="idle"
        messages={[makeAssistantMessage()]}
        workspacePath="/workspace"
        persistScrollState={false}
        settings={{ compactMode: true } as any}
        agentName="weatherman"
        agentModel="haiku"
      />,
    );

    const sender = container.querySelector('.rich-transcript-message-sender');
    expect(sender).not.toBeNull();
    expect(sender?.textContent).toContain('weatherman');

    const modelSpan = container.querySelector('.rich-transcript-message-sender-model');
    expect(modelSpan).not.toBeNull();
    expect(modelSpan?.textContent).toContain('haiku');
  });

  it('falls back to the provider display name when agentName is not provided', () => {
    const { container } = render(
      <RichTranscriptView
        sessionId="gate-1"
        sessionStatus="idle"
        messages={[makeAssistantMessage()]}
        workspacePath="/workspace"
        persistScrollState={false}
        settings={{ compactMode: true } as any}
      />,
    );

    const sender = container.querySelector('.rich-transcript-message-sender');
    expect(sender).not.toBeNull();
    expect(sender?.textContent).toContain('Agent');
    expect(container.querySelector('.rich-transcript-message-sender-model')).toBeNull();
  });
});

function makeUserMessage(
  teammateOrigin?: TranscriptViewMessage['teammateOrigin'],
): TranscriptViewMessage {
  return {
    id: 1,
    sequence: 1,
    createdAt: new Date(1_784_648_445_000),
    type: 'user_message',
    text: 'Hello there',
    subagentId: null,
    ...(teammateOrigin ? { teammateOrigin } : {}),
  } as TranscriptViewMessage;
}

// Bug A: a teammate-wake-injected turn is `user_message`-typed but is not
// real user input. It must never render under the "You" header.
describe('RichTranscriptView teammate wake header attribution', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  // Task 2b moved these turns onto the condensed teammate card, so the
  // attribution now lives on the card label rather than the sender header.
  // The invariant under test is unchanged: never "You".
  it('renders the teammate name, not "You", when teammateOrigin is present', () => {
    const { container } = renderTranscript(
      makeUserMessage([{ agentId: 'agent-1', teammateName: 'Ada', kind: 'wake-message' }]),
    );

    const card = container.querySelector('.rich-transcript-teammate-notification');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Ada');
    expect(container.textContent).not.toContain('You');
  });

  it('summarizes multiple queued deliveries in a batched wake', () => {
    const { container } = renderTranscript(
      makeUserMessage([
        { agentId: 'agent-1', teammateName: 'Ada', kind: 'wake-message' },
        { agentId: 'agent-2', teammateName: 'Grace', kind: 'wake-message' },
      ]),
    );

    const card = container.querySelector('.rich-transcript-teammate-notification');
    expect(card).not.toBeNull();
    expect(container.textContent).not.toContain('You');
    expect(card?.textContent).toContain('2 teammates');
  });

  it('still renders "You" for an ordinary real user message', () => {
    const { container } = renderTranscript(makeUserMessage());

    const sender = container.querySelector('.rich-transcript-message-sender');
    expect(sender).not.toBeNull();
    expect(sender?.textContent).toContain('You');
  });
});

function makeSendMessageTool(
  sequence: number,
  args: Record<string, unknown>,
  toolName = 'SendMessage',
): TranscriptViewMessage {
  return {
    id: sequence,
    sequence,
    createdAt: new Date(1_784_648_445_000),
    type: 'tool_call',
    subagentId: null,
    toolCall: {
      toolName,
      toolDisplayName: toolName,
      status: 'completed',
      description: null,
      arguments: args,
      targetFilePath: null,
      mcpServer: null,
      mcpTool: null,
      providerToolCallId: `toolu_send_${sequence}`,
      progress: [],
      result: 'delivered',
    },
  } as TranscriptViewMessage;
}

function makeWake(sequence: number, text: string, teammateName = 'Ada'): TranscriptViewMessage {
  return {
    id: sequence,
    sequence,
    createdAt: new Date(1_784_648_445_000),
    type: 'user_message',
    text,
    subagentId: null,
    teammateOrigin: [{ agentId: 'agent-1', teammateName, kind: 'wake-message' }],
  } as TranscriptViewMessage;
}

function renderMessages(messages: TranscriptViewMessage[]) {
  return render(
    <RichTranscriptView
      sessionId="gate-1"
      sessionStatus="idle"
      messages={messages}
      workspacePath="/workspace"
      persistScrollState={false}
      settings={{ showToolCalls: true } as any}
    />,
  );
}

// Bug B: the whole teammate exchange -- the wake message plus the adjacent
// SendMessage/shutdown handshake plumbing -- must condense into ONE collapsed
// card in the lead's mainline, not bleed across several turns.
describe('RichTranscriptView teammate exchange condensation', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', { highlights: { delete: vi.fn(), set: vi.fn() } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  it('collapses a lone wake message into a card that is closed on mount', () => {
    const { container } = renderMessages([
      makeWake(1, 'Finished the sweep.\nDetails follow in the log.'),
    ]);

    const cards = container.querySelectorAll('.rich-transcript-teammate-notification');
    expect(cards).toHaveLength(1);

    const details = cards[0].querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
  });

  it('swallows adjacent SendMessage handshake plumbing into the same single card', () => {
    const { container } = renderMessages([
      makeSendMessageTool(1, { recipient: 'cpu-scout', type: 'shutdown_request' }),
      makeWake(2, 'Approving shutdown.\nAll work is committed.'),
      makeSendMessageTool(3, { recipient: 'cpu-scout', type: 'shutdown_response', approve: true }),
    ]);

    // One card, not three turns.
    expect(container.querySelectorAll('.rich-transcript-teammate-notification')).toHaveLength(1);
    // No SendMessage plumbing left rendering as its own mainline tool card.
    expect(container.querySelectorAll('.rich-transcript-tool-container.orphan')).toHaveLength(0);

    // The swallowed calls are reachable inside the card, not lost.
    const body = container.querySelector('.rich-transcript-teammate-notification .teammate-content');
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('All work is committed.');
    expect(body?.querySelectorAll('.rich-transcript-tool-container').length).toBe(2);
  });

  it('leaves an adjacent real user turn rendering normally', () => {
    const { container } = renderMessages([
      makeWake(1, 'Finished the sweep.\nDetails follow.'),
      {
        id: 2,
        sequence: 2,
        createdAt: new Date(1_784_648_446_000),
        type: 'user_message',
        text: 'Thanks, now check the disk.',
        subagentId: null,
      } as TranscriptViewMessage,
    ]);

    expect(container.querySelectorAll('.rich-transcript-teammate-notification')).toHaveLength(1);
    const sender = container.querySelector('.rich-transcript-message-sender');
    expect(sender?.textContent).toContain('You');
    expect(container.textContent).toContain('Thanks, now check the disk.');
  });

  it('does not swallow a SendMessage call separated from the wake by a substantive turn', () => {
    const { container } = renderMessages([
      makeSendMessageTool(1, { recipient: 'cpu-scout', type: 'shutdown_request' }),
      {
        id: 2,
        sequence: 2,
        createdAt: new Date(1_784_648_446_000),
        type: 'assistant_message',
        text: 'Asked cpu-scout to wrap up.',
        subagentId: null,
      } as TranscriptViewMessage,
      makeWake(3, 'Approving shutdown.\nAll work is committed.'),
    ]);

    expect(container.querySelectorAll('.rich-transcript-teammate-notification')).toHaveLength(1);
    expect(container.textContent).toContain('Asked cpu-scout to wrap up.');
  });

  it('labels a revival-failure origin distinctly from a wake message', () => {
    const message = {
      ...makeWake(1, 'Could not restart cpu-scout.\nThe worktree is gone.'),
      teammateOrigin: [{ agentId: 'agent-1', teammateName: 'Ada', kind: 'revival-failed' }],
    } as TranscriptViewMessage;
    const { container } = renderMessages([message]);

    const card = container.querySelector('.rich-transcript-teammate-notification');
    expect(card?.textContent).toContain('Revival failed');
    expect(card?.textContent).toContain('Ada');
  });
});

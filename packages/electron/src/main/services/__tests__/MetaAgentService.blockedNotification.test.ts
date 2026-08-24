// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

// A Meta-Agent child that blocks on an interactive prompt used to surface only
// as a passive "Waiting for ..." label in the Meta-Agent dashboard -- a view the
// architect is usually not looking at. handleChildSessionEvent must fire the
// same OS notification a blocked top-level session gets, without disturbing the
// [Child Session Update] hand-off to the parent.
//
// Mock surface mirrors MetaAgentService.notificationPreview.test.ts (enough to
// import MetaAgentService without pulling electron-app / node-pty into the graph).
vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: { create: vi.fn(), updateMetadata: vi.fn(), get: vi.fn() },
}));
vi.mock('@nimbalyst/runtime/storage/repositories/AgentMessagesRepository', () => ({
  AgentMessagesRepository: { list: vi.fn() },
}));
vi.mock('@nimbalyst/runtime/storage/repositories/SessionFilesRepository', () => ({
  SessionFilesRepository: { getFilesBySession: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ClaudeCodeProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexProvider: { setMetaAgentServerPort: vi.fn() },
  OpenAICodexACPProvider: { setMetaAgentServerPort: vi.fn() },
  SessionManager: class { async initialize() {} },
}));
vi.mock('@nimbalyst/runtime/ai/server/types', () => ({
  ModelIdentifier: {
    parse: (id: string) => ({ provider: id.split(':')[0], model: id.split(':')[1], combined: id }),
    tryParse: (id: string) => {
      const i = typeof id === 'string' ? id.indexOf(':') : -1;
      return i > 0 ? { provider: id.slice(0, i), model: id.slice(i + 1) } : null;
    },
    getDefaultModelId: (provider: string) => `${provider}:default`,
  },
}));
vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: () => ({ subscribe: vi.fn() }),
}));
vi.mock('../ai/providerResolution', () => ({
  resolveExtensionAgentRef: () => null,
  isExtensionAgentProvider: () => false,
}));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../SyncManager', () => ({ getSyncProvider: () => ({ pushChange: vi.fn() }) }));
vi.mock('../../utils/ipcRegistry', () => ({ safeHandle: vi.fn() }));
vi.mock('../../utils/store', () => ({ getDefaultAIModel: () => null }));
vi.mock('../../utils/timestampUtils', () => ({ toMillis: (v: unknown) => v }));
vi.mock('../WorktreeStore', () => ({ createWorktreeStore: vi.fn() }));
vi.mock('../GitWorktreeService', () => ({ GitWorktreeService: class {} }));
vi.mock('../../database/PGLiteDatabaseWorker', () => ({
  database: { query: vi.fn().mockResolvedValue({ rows: [{ count: '0' }] }) },
}));
vi.mock('../../database/initialize', () => ({ getDatabase: () => null }));
vi.mock('../../file/GitRefWatcher', () => ({ gitRefWatcher: {} }));
vi.mock('./ai/AIService', () => ({ AIService: class {} }));
vi.mock('../../mcp/metaAgentServer', () => ({ setMetaAgentToolFns: vi.fn() }));
vi.mock('../metaAgentNotificationSignature', () => ({
  computeNotificationSignature: (eventType: string) => `sig:${eventType}`,
}));
vi.mock('../metaAgentMessageText', () => ({
  extractMessageText: (content: unknown) => (typeof content === 'string' ? content : ''),
  extractUserPrompts: () => ['original task'],
}));
vi.mock('../ai/claudeCliLauncherSingleton', () => ({
  ClaudeCliLauncherConfig: { setMetaAgentServerPort: vi.fn() },
}));

import { AISessionsRepository } from '@nimbalyst/runtime/storage/repositories/AISessionsRepository';
import { MetaAgentService } from '../MetaAgentService';

const CHILD_ID = 'child-1';
const PARENT_ID = 'meta-1';
const WORKSPACE = '/tmp/workspace';

function baseResult(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: CHILD_ID,
    title: 'Child: research',
    provider: 'claude-code',
    model: 'claude-code:sonnet',
    status: 'idle',
    lastActivity: 1,
    originalPrompt: null as string | null,
    userPrompts: [],
    lastResponse: null,
    fullResponse: null,
    recentMessages: [],
    editedFiles: [],
    pendingPrompt: null as Record<string, unknown> | null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 2,
    worktreeId: null,
    toolScope: null,
    ...overrides,
  };
}

/**
 * Drive handleChildSessionEvent with everything below it stubbed, and report
 * what the two downstream paths (OS notification, parent hand-off) received.
 */
async function runChildEvent(
  eventType: 'session:completed' | 'session:error' | 'session:waiting' | 'session:interrupted',
  result: ReturnType<typeof baseResult>,
) {
  const service = MetaAgentService.getInstance() as any;
  const showBlockedNotification = vi.fn().mockResolvedValue(undefined);
  const queuePromptForSession = vi.fn().mockResolvedValue(undefined);

  vi.mocked(AISessionsRepository.get).mockImplementation(async (id: string) =>
    (id === CHILD_ID
      ? { id: CHILD_ID, agentRole: 'child', createdBySessionId: PARENT_ID, workspacePath: WORKSPACE }
      : { id: PARENT_ID, agentRole: 'meta-agent', workspacePath: WORKSPACE }) as any,
  );

  service.notificationSignatures.clear();
  service.aiService = {
    queuePromptForSession,
    triggerQueuedPromptProcessingForSession: vi.fn().mockResolvedValue(undefined),
  };
  service.showBlockedNotification = showBlockedNotification;
  service.getSessionStatusRow = vi.fn().mockResolvedValue({ status: 'idle' });
  service.buildSessionResultData = vi.fn().mockResolvedValue(result);
  service.ensurePlanTrackerItem = vi.fn().mockResolvedValue(undefined);

  await service.handleChildSessionEvent(CHILD_ID, eventType);

  return { showBlockedNotification, queuePromptForSession };
}

describe('MetaAgentService blocked-child notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['permission_request', 'permission'],
    ['ask_user_question_request', 'question'],
    ['exit_plan_mode_request', 'plan_approval'],
  ])('notifies with blockingType %s -> %s when a child blocks', async (promptType, blockingType) => {
    const { showBlockedNotification } = await runChildEvent(
      'session:waiting',
      baseResult({ pendingPrompt: { promptId: 'p-1', promptType, content: {} } }),
    );

    expect(showBlockedNotification).toHaveBeenCalledWith(
      CHILD_ID,
      'Child: research',
      blockingType,
      WORKSPACE,
    );
  });

  it('falls back to question for an unrecognized promptType rather than staying silent', async () => {
    const { showBlockedNotification } = await runChildEvent(
      'session:waiting',
      baseResult({ pendingPrompt: { promptId: 'p-1', promptType: 'future_prompt_kind', content: {} } }),
    );

    expect(showBlockedNotification).toHaveBeenCalledWith(CHILD_ID, 'Child: research', 'question', WORKSPACE);
  });

  it('skips the notification when session:waiting arrives without a pendingPrompt', async () => {
    const { showBlockedNotification, queuePromptForSession } = await runChildEvent(
      'session:waiting',
      baseResult(),
    );

    expect(showBlockedNotification).not.toHaveBeenCalled();
    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
  });

  it('fires no notification on a normal completion with an empty queue', async () => {
    const { showBlockedNotification, queuePromptForSession } = await runChildEvent(
      'session:completed',
      baseResult({ status: 'completed', lastResponse: 'done' }),
    );

    expect(showBlockedNotification).not.toHaveBeenCalled();
    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
  });

  it('leaves the [Child Session Update] hand-off unchanged on both paths', async () => {
    const blocked = await runChildEvent(
      'session:waiting',
      baseResult({ pendingPrompt: { promptId: 'p-1', promptType: 'permission_request', content: {} } }),
    );
    const completed = await runChildEvent('session:completed', baseResult({ status: 'completed' }));

    for (const [{ queuePromptForSession }, eventType] of [
      [blocked, 'session:waiting'],
      [completed, 'session:completed'],
    ] as const) {
      const [targetSessionId, message, third, options] = queuePromptForSession.mock.calls[0];
      expect(targetSessionId).toBe(PARENT_ID);
      expect(message).toContain('[Child Session Update]');
      expect(message).toContain(`Event: ${eventType}`);
      expect(third).toBeUndefined();
      expect(options).toEqual({
        promptProvenance: { actor: 'agent', origin: 'child-session-update', originSessionId: CHILD_ID },
      });
    }
  });

  it('still hands off to the parent when the notification throws', async () => {
    const service = MetaAgentService.getInstance() as any;
    const { queuePromptForSession } = await runChildEvent(
      'session:waiting',
      baseResult({ pendingPrompt: { promptId: 'p-1', promptType: 'permission_request', content: {} } }),
    );
    expect(service.showBlockedNotification).toHaveBeenCalled();

    service.showBlockedNotification = vi.fn().mockRejectedValue(new Error('notification backend down'));
    service.notificationSignatures.clear();
    queuePromptForSession.mockClear();

    await service.handleChildSessionEvent(CHILD_ID, 'session:waiting');

    expect(queuePromptForSession).toHaveBeenCalledTimes(1);
  });
});

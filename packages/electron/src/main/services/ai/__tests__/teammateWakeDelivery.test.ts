// @vitest-environment node
/**
 * `onTeammateMessageWhileIdle` used to drop a teammate's wake message on the
 * floor -- no requeue, no notification -- whenever the workspace window was
 * gone, destroyed, or `sendMessageHandler` wasn't wired yet. The main session
 * never resumed and nothing told the user why. These pin all three drop cases
 * to a notification, and pin the working case to the unchanged delivery path.
 *
 * The `MessageStreamingHandler` describe blocks below cover PRD
 * teammate-resume-reliability, task 1c's "Door B" -- a resume-failure wake
 * reaching a lead whose session the state manager isn't tracking as active
 * (post-restart). Two caveats, stated honestly rather than overclaiming:
 *
 * - `onTeammateMessageWhileIdle`'s own `!isSessionActive` early-return
 *   (MessageStreamingHandler.ts ~L1103) was NOT changed by 1c -- a test that
 *   pins `isSessionActive` false for the whole handler call and expects
 *   delivery anyway would be asserting behavior 1c's diff does not produce.
 *   1c's actual Door B fix is `ai:sendMessageToTeammate` (AIService.ts
 *   ~L3234-3241) calling `stateManager.startSession()` *before* the resume
 *   that can raise this wake, so that by the time this handler's gate checks
 *   `isSessionActive`, it is already true. That AIService handler lives in a
 *   ~3200-line file with no existing handler-capture test harness; it is
 *   read-verified (cited lines above, and its own `!delivered && !wasActive`
 *   -> `endSession` undo at ~L3253-3257) rather than executed here.
 * - What IS executed and red-first verified here: (1) the "gate already open"
 *   case -- `isSessionActive` true (the state Door B's `startSession` call
 *   produces) delivers the wake, and (2) 1c's actual diff in this file, the
 *   drop-path fallback that releases the idle-wake latch and ends the
 *   deferred session when the wake could not be delivered at all (the
 *   negative-space gap 1c's own self-report flagged as untested).
 */

import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  announceTeammateWakeDelivery,
  classifyTeammateWakeDelivery,
  type TeammateWakeDeliveryOutcome,
} from '../teammateWakeDelivery';

const announce = async (outcome: TeammateWakeDeliveryOutcome) => {
  const deliver = vi.fn();
  const notifyUndelivered = vi.fn();
  const logDropped = vi.fn();
  await announceTeammateWakeDelivery(outcome, { deliver, notifyUndelivered, logDropped });
  return {
    delivered: deliver.mock.calls.length > 0,
    reason: notifyUndelivered.mock.calls.at(0)?.[0] as string | undefined,
    logSuffix: logDropped.mock.calls.at(0)?.[0] as string | undefined,
  };
};

describe('classifyTeammateWakeDelivery', () => {
  it('classifies a missing window as window_not_found', () => {
    expect(classifyTeammateWakeDelivery(null, true)).toBe('window_not_found');
  });

  it('classifies a destroyed window as window_destroyed', () => {
    const destroyedWindow = { isDestroyed: () => true };
    expect(classifyTeammateWakeDelivery(destroyedWindow, true)).toBe('window_destroyed');
  });

  it('classifies a live window with no sendMessageHandler as handler_absent', () => {
    const liveWindow = { isDestroyed: () => false };
    expect(classifyTeammateWakeDelivery(liveWindow, false)).toBe('handler_absent');
  });

  it('classifies a live window with a handler as delivered', () => {
    const liveWindow = { isDestroyed: () => false };
    expect(classifyTeammateWakeDelivery(liveWindow, true)).toBe('delivered');
  });
});

describe('announceTeammateWakeDelivery', () => {
  it('delivers and fires no notification when the window and handler are both available', async () => {
    const result = await announce('delivered');
    expect(result.delivered).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.logSuffix).toBeUndefined();
  });

  it('notifies instead of delivering when the workspace window was not found', async () => {
    const result = await announce('window_not_found');
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/not open/);
    expect(result.logSuffix).toMatch(/not found/);
  });

  it('notifies instead of delivering when the workspace window was destroyed', async () => {
    const result = await announce('window_destroyed');
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/closed/);
    expect(result.logSuffix).toMatch(/destroyed/);
  });

  it('notifies instead of delivering when sendMessageHandler is absent', async () => {
    const result = await announce('handler_absent');
    expect(result.delivered).toBe(false);
    expect(result.reason).toMatch(/handler/);
    expect(result.logSuffix).toMatch(/sendMessageHandler/);
  });

  it('gives each of the three drop cases a distinguishable reason and log suffix', async () => {
    const notFound = await announce('window_not_found');
    const destroyed = await announce('window_destroyed');
    const absent = await announce('handler_absent');

    const reasons = [notFound.reason, destroyed.reason, absent.reason];
    const logSuffixes = [notFound.logSuffix, destroyed.logSuffix, absent.logSuffix];
    expect(new Set(reasons).size).toBe(3);
    expect(new Set(logSuffixes).size).toBe(3);
  });
});

// ─── MessageStreamingHandler's onTeammateMessageWhileIdle (Door B) ─────────

const mocks = vi.hoisted(() => ({
  providerFactory: {
    getProvider: vi.fn(),
    createProvider: vi.fn(),
  },
  stateManager: {
    startSession: vi.fn(),
    updateActivity: vi.fn(),
    endSession: vi.fn(),
    isSessionActive: vi.fn(() => true),
  },
  findWindowByWorkspace: vi.fn((_workspacePath: string) => null as { isDestroyed(): boolean; webContents: unknown } | null),
}));

// MessageStreamingHandler pulls in most of the main process. Everything below
// exists only to let it import; nothing here is under test except the
// teammate:messageWhileIdle listener itself. Mirrors
// MessageStreamingHandler.opencodeModel.test.ts's scaffold.
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('@nimbalyst/runtime/ai/server', () => ({
  ProviderFactory: mocks.providerFactory,
  ModelRegistry: {
    getModelsForProvider: vi.fn(async () => []),
    getDefaultModel: vi.fn(),
  },
  OpenAICodexProvider: {
    normalizeModelSelection: vi.fn((model: string) => model),
  },
  isAgentProvider: vi.fn((provider: string) => provider === 'opencode'),
  onAgentMessageBatch: vi.fn(() => vi.fn()),
  buildMetaAgentSystemPrompt: vi.fn(),
  buildDevAgentSystemPrompt: vi.fn(),
}));

vi.mock('@nimbalyst/runtime/ai/server/SessionStateManager', () => ({
  getSessionStateManager: vi.fn(() => mocks.stateManager),
}));

vi.mock('@nimbalyst/runtime/ai/server/utils/errorDetection', () => ({
  isBedrockToolSearchError: vi.fn(() => false),
}));

vi.mock('@nimbalyst/runtime/ai/server/effortLevels', () => ({
  resolveEffortLevel: vi.fn(() => undefined),
  resolveThinkingMode: vi.fn(() => undefined),
}));

vi.mock('@nimbalyst/runtime/storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: { get: vi.fn() },
}));

vi.mock('@nimbalyst/runtime/ai/modelConstants', () => ({
  resolveClaudeCodeParentContextWindow: vi.fn(),
}));

vi.mock('@nimbalyst/runtime/types/MCPServerConfig', () => ({
  buildMcpSessionStatusSnapshot: vi.fn(() => ({})),
}));

vi.mock('../tools', () => ({
  toolRegistry: { getAll: vi.fn(() => []) },
}));

vi.mock('../providerResolution', () => ({
  resolveExtensionAgentRef: vi.fn(() => null),
}));

vi.mock('../../../extensions/AgentProviderRegistry', () => ({
  getAgentProviderRegistry: vi.fn(),
}));

vi.mock('../../SoundNotificationService', () => ({
  SoundNotificationService: {
    getInstance: vi.fn(() => ({ playCompletionSound: vi.fn() })),
  },
}));

vi.mock('../../NotificationService', () => ({
  notificationService: {
    showNotification: vi.fn(),
    showAgentFailureNotification: vi.fn(),
  },
}));

vi.mock('../../../../shared/notificationTitle', () => ({
  composeNotificationTitle: vi.fn(),
}));

vi.mock('../../../utils/logger', () => ({
  logger: {
    ai: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    main: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

vi.mock('../../../window/WindowManager', () => ({
  windowStates: new Map(),
  findWindowByWorkspace: (workspacePath: string) => mocks.findWindowByWorkspace(workspacePath),
}));

vi.mock('../../SessionFileTracker', () => ({
  sessionFileTracker: { trackUserMessage: vi.fn() },
}));

vi.mock('../../CodexEditWindowRegistry', () => ({
  codexEditWindowRegistry: { clearSession: vi.fn() },
  shouldOpenCodexEditWindow: vi.fn(() => false),
}));

vi.mock('../../ToolCallMatcher', () => ({
  toolCallMatcher: { matchSession: vi.fn() },
  unwrapShellCommand: vi.fn(),
}));

vi.mock('../../FeatureUsageService.ts', () => ({
  FeatureUsageService: {
    getInstance: vi.fn(() => ({ recordUsage: vi.fn() })),
  },
  FEATURES: {
    AI_PROMPT_SUBMITTED: 'ai_prompt_submitted',
  },
}));

vi.mock('../../ToolUsageService', () => ({
  ToolUsageService: { getInstance: vi.fn() },
}));

vi.mock('../../../HistoryManager', () => ({
  historyManager: {},
}));

vi.mock('../../../file/WorkspaceEventBus', () => ({
  addGitignoreBypass: vi.fn(),
}));

vi.mock('../../SyncManager', () => ({
  getSyncProvider: vi.fn(() => null),
  isDesktopTrulyAway: vi.fn(() => false),
}));

vi.mock('../mobilePushRequest', () => ({
  requestMobilePush: vi.fn(),
}));

vi.mock('../pendingPromptPersistence', () => ({
  setSessionPendingPrompt: vi.fn(),
}));

vi.mock('../../AgentWorkflowService', () => ({
  getAgentWorkflowService: vi.fn(),
}));

vi.mock('../../../mcp/metaAgentServer', () => ({
  getMetaAgentOpenAITools: vi.fn(),
}));

vi.mock('../../../mcp/devAgentTools', () => ({
  getDevAgentOpenAITools: vi.fn(),
  resolveDevToolScope: vi.fn(),
}));

vi.mock('../../MetaAgentService', () => ({
  MetaAgentService: { getInstance: vi.fn() },
}));

vi.mock('../../../utils/store', () => ({
  getDefaultEffortLevel: vi.fn(() => undefined),
  getDefaultThinkingMode: vi.fn(() => undefined),
  getAppSetting: vi.fn(() => undefined),
  shouldShowCommunityPopup: vi.fn(() => false),
  markCommunityPopupShown: vi.fn(),
  wasCommunityPopupShownThisLaunch: vi.fn(() => false),
  incrementCompletedSessionsWithTools: vi.fn(),
}));

vi.mock('../childSessionTakeover', () => ({
  disableParentNotificationsAfterDirectTakeover: vi.fn(),
}));

vi.mock('../sessionSettlePolicy', () => ({
  shouldSettleUnterminatedTurn: vi.fn(() => false),
}));

vi.mock('../../tutorial/tutorialAnalytics', () => ({
  captureTutorialMilestone: vi.fn(),
}));

const { MessageStreamingHandler } = await import('../MessageStreamingHandler');

/** A provider that streams no chunks -- just enough to let handle() install its listeners. */
class RecordingProvider extends EventEmitter {
  config: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>) {
    this.config = config;
  }

  registerToolHandler() {}

  getCapabilities() {
    return { supportsFileTools: true };
  }

  async *sendMessage() {
    // no chunks
  }
}

function teammateSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lead-session',
    provider: 'opencode',
    model: 'opencode:anthropic/claude-sonnet-4',
    providerConfig: {},
    messages: [{ role: 'assistant', content: 'Existing turn', timestamp: 1 }],
    workspacePath: '/workspace',
    ...overrides,
  };
}

/** Runs one turn (installing listeners on `provider`) with a minimal AIService stub. */
async function installListenersOn(provider: RecordingProvider, session = teammateSession()) {
  mocks.providerFactory.createProvider.mockReturnValue(provider);
  mocks.providerFactory.getProvider.mockReturnValue(null);

  const service = {
    sessionManager: {
      loadSession: vi.fn(async () => session),
      addMessage: vi.fn(),
    },
    analytics: { sendEvent: vi.fn() },
    sendMessageHandler: null as unknown,
    processingQueuedPromptIds: new Set(),
    matchDebounceTimers: new Map(),
    sessionsProcessingQueue: new Set(),
    documentContextService: {
      prepareContext: vi.fn(() => ({ documentContext: {}, userMessageAdditions: {} })),
    },
    hooklessWatcher: {
      ensureForSession: vi.fn(),
      stopForSession: vi.fn(),
      scheduleStop: vi.fn(),
    },
    getSettingsStore: vi.fn(),
    getApiKeyForProvider: vi.fn(() => undefined),
    buildClaudeCodeRuntimeConfig: vi.fn(),
    tryDispatchNextQueuedPrompt: vi.fn(async () => false),
    requestQueueDrive: vi.fn(),
    createToolHandler: vi.fn(() => vi.fn()),
  };

  await new MessageStreamingHandler(service as never).handle(
    { sender: { id: 7, isDestroyed: vi.fn(() => false), send: vi.fn() } } as never,
    'Prompt',
    undefined,
    session.id as string,
    session.workspacePath as string,
  );

  return service;
}

describe('MessageStreamingHandler onTeammateMessageWhileIdle: gate already open (Door B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateManager.isSessionActive.mockReturnValue(true);
    mocks.findWindowByWorkspace.mockReturnValue(null);
  });

  it('delivers the wake once isSessionActive is true -- the state ai:sendMessageToTeammate\'s startSession call (AIService.ts ~L3234-3241) produces before this fires', async () => {
    const provider = new RecordingProvider();
    const liveWindow = { isDestroyed: () => false, webContents: {} };
    mocks.findWindowByWorkspace.mockReturnValue(liveWindow);
    const service = await installListenersOn(provider);
    service.sendMessageHandler = vi.fn();

    provider.emit('teammate:messageWhileIdle', { sessionId: 'lead-session', message: 'wake up' });

    await vi.waitFor(() => expect(service.sendMessageHandler).toHaveBeenCalled());
    expect(mocks.stateManager.endSession).not.toHaveBeenCalled();
  });

  it('still bails without delivering when isSessionActive is false (unchanged by 1c -- proves Door B is AIService\'s startSession call, not this gate)', async () => {
    const provider = new RecordingProvider();
    const liveWindow = { isDestroyed: () => false, webContents: {} };
    mocks.findWindowByWorkspace.mockReturnValue(liveWindow);
    mocks.stateManager.isSessionActive.mockReturnValue(false);
    const service = await installListenersOn(provider);
    service.sendMessageHandler = vi.fn();
    // installListenersOn's own turn setup calls startSession for unrelated
    // bookkeeping; clear it so the assertion below is scoped to the emitted event.
    mocks.stateManager.startSession.mockClear();

    provider.emit('teammate:messageWhileIdle', { sessionId: 'lead-session', message: 'wake up' });

    // Give the fire-and-forget handler a chance to run before asserting the negative.
    await new Promise(resolve => setImmediate(resolve));
    expect(service.sendMessageHandler).not.toHaveBeenCalled();
    expect(mocks.stateManager.startSession).not.toHaveBeenCalled();
  });
});

describe('MessageStreamingHandler onTeammateMessageWhileIdle: drop-path fallback (task 1c)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stateManager.isSessionActive.mockReturnValue(true);
    mocks.findWindowByWorkspace.mockReturnValue(null);
  });

  it('releases the idle-wake latch and ends the deferred session when the wake cannot be delivered at all', async () => {
    // No window found -> classifyTeammateWakeDelivery returns 'window_not_found',
    // so the wake is never delivered. Before 1c, teammateIdleMessagePending would
    // stay latched forever and the session would sit spinning.
    const provider = new RecordingProvider() as RecordingProvider & { releaseIdleWakeLatch: ReturnType<typeof vi.fn> };
    provider.releaseIdleWakeLatch = vi.fn(() => true);
    const service = await installListenersOn(provider);

    provider.emit('teammate:messageWhileIdle', { sessionId: 'lead-session', message: 'resume failed' });

    await vi.waitFor(() => expect(mocks.stateManager.endSession).toHaveBeenCalledWith('lead-session'));
    expect(provider.releaseIdleWakeLatch).toHaveBeenCalled();
    expect(service.hooklessWatcher.stopForSession).toHaveBeenCalledWith('lead-session');
  });

  it('does not end the session when releaseIdleWakeLatch reports a teammate is still active', async () => {
    const provider = new RecordingProvider() as RecordingProvider & { releaseIdleWakeLatch: ReturnType<typeof vi.fn> };
    provider.releaseIdleWakeLatch = vi.fn(() => false);
    const service = await installListenersOn(provider);

    provider.emit('teammate:messageWhileIdle', { sessionId: 'lead-session', message: 'resume failed' });

    await vi.waitFor(() => expect(provider.releaseIdleWakeLatch).toHaveBeenCalled());
    expect(mocks.stateManager.endSession).not.toHaveBeenCalled();
    expect(service.hooklessWatcher.stopForSession).not.toHaveBeenCalled();
  });
});

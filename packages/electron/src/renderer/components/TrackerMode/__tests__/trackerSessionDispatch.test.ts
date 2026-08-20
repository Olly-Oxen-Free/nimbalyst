// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackerRecord } from '@nimbalyst/runtime/core/TrackerRecord';

import type { SessionMeta } from '../../../store/atoms/sessions';
import { launchTrackerSession, resumeTrackerSession } from '../trackerSessionDispatch';

const trackerItem: TrackerRecord = {
  id: 'feature_1624',
  primaryType: 'feature',
  typeTags: ['feature'],
  issueKey: 'NIM-1624',
  source: 'native',
  archived: false,
  syncStatus: 'local',
  fields: { title: 'Dispatch from a card', status: 'to-do' },
  system: {
    workspace: '/repo',
    createdAt: '2026-08-19T12:00:00.000Z',
    updatedAt: '2026-08-19T12:00:00.000Z',
  },
};

function makeLinkedSession(provider: string): SessionMeta {
  return {
    id: 'session-1',
    title: 'Linked',
    provider,
    model: 'claude-code-cli:sonnet',
    sessionType: 'session',
    workspaceId: '/repo',
    worktreeId: null,
    parentSessionId: null,
    childCount: 0,
    uncommittedCount: 0,
    createdAt: 0,
    updatedAt: 0,
    messageCount: 0,
    isArchived: false,
    isPinned: false,
  };
}

let invoke: ReturnType<typeof vi.fn>;
let ensureClaudeCliSession: ReturnType<typeof vi.fn>;
let providerSessionId: string | undefined;

beforeEach(() => {
  providerSessionId = 'cli-abc';
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'sessions:get') return { success: true, session: { providerSessionId } };
    if (channel === 'sessions:create') return { success: true, id: 'new-session' };
    return { success: true };
  });
  ensureClaudeCliSession = vi.fn().mockResolvedValue({ success: true });
  (globalThis as any).window = { electronAPI: { invoke, terminal: { ensureClaudeCliSession } } };
});

const options = {
  trackerItemId: 'feature_1624',
  trackerItem,
  workspacePath: '/repo',
  defaultModel: 'claude-code-cli:sonnet',
};

describe('resumeTrackerSession', () => {
  it('resumes the linked claude-cli session with its providerSessionId', async () => {
    const sessionId = await resumeTrackerSession({
      ...options,
      linkedSession: makeLinkedSession('claude-code-cli'),
    });

    expect(sessionId).toBe('session-1');
    expect(ensureClaudeCliSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
      workspacePath: '/repo',
      model: 'claude-code-cli:sonnet',
      resumeSessionId: 'cli-abc',
    });
    expect(invoke).not.toHaveBeenCalledWith('sessions:create', expect.anything());
  });

  it('launches a fresh session when the claude-cli session has no providerSessionId', async () => {
    providerSessionId = undefined;

    const sessionId = await resumeTrackerSession({
      ...options,
      linkedSession: makeLinkedSession('claude-code-cli'),
    });

    expect(sessionId).toBe('new-session');
    expect(ensureClaudeCliSession).not.toHaveBeenCalled();
    // The dispatched draft keeps trackerSessionLaunch's self-report instruction.
    expect(invoke).toHaveBeenCalledWith(
      'ai:saveDraftInput',
      'new-session',
      expect.stringContaining('tracker_update with id "NIM-1624"'),
      '/repo',
    );
  });

  it('never attempts resume for a non-claude-cli provider', async () => {
    const sessionId = await resumeTrackerSession({
      ...options,
      linkedSession: makeLinkedSession('openai-codex'),
    });

    expect(sessionId).toBe('new-session');
    expect(ensureClaudeCliSession).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalledWith('sessions:get', expect.anything());
    expect(invoke).toHaveBeenCalledWith('tracker:link-session', {
      trackerId: 'feature_1624',
      sessionId: 'new-session',
    });
  });
});

describe('launchTrackerSession', () => {
  it('uses the project override template when one is configured for the workspace', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'sessions:create') return { success: true, id: 'new-session' };
      if (channel === 'ai:getProjectTrackerLaunchPromptTemplate') {
        return { success: true, override: 'This project uses the KARIMO/beads workflow. Item: {itemId}' };
      }
      return { success: true };
    });
    (globalThis as any).window = { electronAPI: { invoke, terminal: { ensureClaudeCliSession } } };

    await launchTrackerSession(options);

    expect(invoke).toHaveBeenCalledWith(
      'ai:saveDraftInput',
      'new-session',
      'This project uses the KARIMO/beads workflow. Item: NIM-1624',
      '/repo',
    );
  });

  it('falls back to the global template when no project override is configured', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'sessions:create') return { success: true, id: 'new-session' };
      if (channel === 'ai:getProjectTrackerLaunchPromptTemplate') return { success: true, override: null };
      return { success: true };
    });
    (globalThis as any).window = { electronAPI: { invoke, terminal: { ensureClaudeCliSession } } };

    await launchTrackerSession(options);

    expect(invoke).toHaveBeenCalledWith(
      'ai:saveDraftInput',
      'new-session',
      expect.stringContaining('tracker_update with id "NIM-1624"'),
      '/repo',
    );
  });
});

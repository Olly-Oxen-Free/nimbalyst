// @vitest-environment node
//
// nby-73f.3: verifies the two EXISTING mechanisms that move a session-linked
// tracker item toward done actually compose correctly for a session linked
// via the standard `createBidirectionalLink` helper (the same helper any
// future dispatch entry point uses to link a session to a tracker item):
//
//   1. createBidirectionalLink (trackerToolHandlers.ts) writes the tracker
//      item id into `ai_sessions.metadata.linkedTrackerItemIds`.
//   2. CommitTrackerLinker.linkBySession reads that same field and, only once
//      the user's approved commit message names the item with a closing
//      keyword, promotes it to its type's own terminal status.
//
// This is deliberately an integration test over a shared fake DB rather than
// two isolated unit tests, so a shape mismatch between the writer and the
// reader (e.g. a future rename of `linkedTrackerItemIds`) fails here instead
// of silently no-op'ing in production.
//
// The real tracker schema registry is used (via loadBuiltinTrackers), unlike
// trackerToolHandlers.test.ts's mocked globalRegistry -- CommitTrackerLinker's
// terminal-status resolution depends on real per-type status categories.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

// createBidirectionalLink resolves its db via a dynamic import of this module.
vi.mock('../../database/initialize', () => ({
  getDatabase: () => ({ query: mockQuery }),
}));

// CommitTrackerLinker constructs a real electron-store Store for its own
// settings lookup; keep that off the filesystem, same as CommitTrackerLinker.test.ts.
vi.mock('electron-store', () => ({
  default: class MockStore {
    get(_key: string, fallback: unknown) {
      return fallback;
    }
  },
}));

// Everything below mirrors the mock set trackerToolHandlers.test.ts uses to
// load trackerToolHandlers.ts safely, MINUS the TrackerDataModel mock -- this
// suite needs the real global tracker registry.
vi.mock('../../services/TrackerIdentityService', () => ({
  getCurrentIdentity: vi.fn(() => ({ displayName: 'Test User' })),
}));

vi.mock('../../services/TrackerPolicyService', () => ({
  getEffectiveTrackerSharingPolicy: vi.fn(() => ({ sharing: 'personal', draftByDefault: false })),
  getInitialTrackerSyncStatus: vi.fn(() => 'local'),
  shouldSyncTrackerItem: vi.fn(() => false),
}));

vi.mock('../../services/TrackerSyncManager', () => ({
  isTrackerSyncActive: vi.fn(() => false),
  syncTrackerItem: vi.fn(),
  onTrackerItemApplied: vi.fn(() => () => {}),
}));

vi.mock('../../services/tracker/awaitServerIssueKey', () => ({
  awaitServerIssueKey: vi.fn(async () => null),
  SERVER_ISSUE_KEY_TIMEOUT_MS: 2000,
}));

vi.mock('../../services/TrackerSchemaService', () => ({
  getTrackerRoleField: vi.fn(() => null),
  ensureWorkspaceTrackerSchemasLoaded: vi.fn(),
}));

vi.mock('../../utils/store', () => ({
  getWorkspaceState: vi.fn(() => ({ issueKeyPrefix: 'NIM' })),
  isAnalyticsEnabled: vi.fn(() => true),
  getEffectiveTrackerAutomation: (settings: unknown) => settings,
}));

vi.mock('../../window/WindowManager', () => ({
  findWindowByWorkspace: vi.fn(() => null),
  documentServices: new Map(),
}));

vi.mock('../../services/MainBodyDocService', () => ({
  applyHeadlessBodyMarkdown: vi.fn(async () => true),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp'),
    isPackaged: false,
    getName: vi.fn(() => 'Nimbalyst'),
  },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { CommitTrackerLinker } from '../CommitTrackerLinker';
import { createBidirectionalLink } from '../../mcp/tools/trackerToolHandlers';
import { loadBuiltinTrackers } from '@nimbalyst/runtime/plugins/TrackerPlugin/models/ModelLoader';

/** Minimal in-memory stand-in for the two tables both mechanisms touch. */
function createFakeDb() {
  const trackerItems = new Map<string, {
    id: string;
    workspace: string;
    type: string;
    sync_status: string;
    issue_key: string;
    data: Record<string, any>;
  }>();
  const aiSessions = new Map<string, { metadata: Record<string, any> }>();

  const query = vi.fn(async (sql: string, params: any[] = []) => {
    if (sql.includes('workspace, type, sync_status, data FROM tracker_items')) {
      const row = trackerItems.get(params[0]);
      return { rows: row ? [{ ...row, data: JSON.stringify(row.data) }] : [] };
    }
    if (sql.includes('SELECT type, data FROM tracker_items')) {
      const row = trackerItems.get(params[0]);
      return { rows: row ? [{ type: row.type, data: JSON.stringify(row.data) }] : [] };
    }
    if (sql.includes('SELECT data FROM tracker_items')) {
      const row = trackerItems.get(params[0]);
      return { rows: row ? [{ data: JSON.stringify(row.data) }] : [] };
    }
    if (sql.includes('SELECT id, issue_key FROM tracker_items')) {
      const [workspace, ...ids] = params;
      const rows = ids
        .map((id: string) => trackerItems.get(id))
        .filter((row): row is NonNullable<typeof row> => !!row && row.workspace === workspace)
        .map((row) => ({ id: row.id, issue_key: row.issue_key }));
      return { rows };
    }
    if (sql.includes('UPDATE tracker_items SET data')) {
      const [dataJson, id] = params;
      const row = trackerItems.get(id);
      if (row) row.data = JSON.parse(dataJson);
      return { rows: [] };
    }
    if (sql.includes('SELECT metadata FROM ai_sessions')) {
      const row = aiSessions.get(params[0]);
      return { rows: row ? [{ metadata: JSON.stringify(row.metadata) }] : [] };
    }
    if (sql.includes('UPDATE ai_sessions SET metadata')) {
      const [metadataJson, id] = params;
      const patch = JSON.parse(metadataJson);
      const existing = aiSessions.get(id)?.metadata ?? {};
      aiSessions.set(id, { metadata: { ...existing, ...patch } });
      return { rows: [] };
    }
    throw new Error(`Unhandled query in fake db: ${sql}`);
  });

  return { query, trackerItems, aiSessions };
}

describe('session linked via createBidirectionalLink -> CommitTrackerLinker.linkBySession', () => {
  beforeAll(() => {
    loadBuiltinTrackers();
  });

  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('auto-closes the item to its type-specific terminal status once the linked session commit references it', async () => {
    const db = createFakeDb();
    mockQuery.mockImplementation(db.query);
    db.trackerItems.set('bug-1', {
      id: 'bug-1',
      workspace: '/workspace',
      type: 'bug',
      sync_status: 'local',
      issue_key: 'NIM-42',
      data: { status: 'in-review' }, // set by the agent's tracker_update self-report
    });
    db.aiSessions.set('session-1', { metadata: {} });

    const linked = await createBidirectionalLink('bug-1', 'session-1');
    expect(linked).toBe(true);
    expect(db.aiSessions.get('session-1')?.metadata.linkedTrackerItemIds).toEqual(['bug-1']);

    const linker = new CommitTrackerLinker();
    linker.initialize({ getDatabase: () => ({ query: mockQuery }) });

    const result = await linker.linkBySession(
      'abcdef0',
      'fix: stop the thing crashing\n\nFixes NIM-42',
      'session-1',
      '/workspace',
    );

    expect(result.closedItemIds).toEqual(['bug-1']);
    // `bug` closes on `done` -- confirms the type-specific lookup, not a
    // hardcoded literal, drove the write.
    expect(db.trackerItems.get('bug-1')?.data.status).toBe('done');
  });

  it('leaves the item at its self-reported status when the linked session has not committed yet', async () => {
    const db = createFakeDb();
    mockQuery.mockImplementation(db.query);
    db.trackerItems.set('bug-2', {
      id: 'bug-2',
      workspace: '/workspace',
      type: 'bug',
      sync_status: 'local',
      issue_key: 'NIM-43',
      data: { status: 'in-review' },
    });
    db.aiSessions.set('session-2', { metadata: {} });

    await createBidirectionalLink('bug-2', 'session-2');

    const linker = new CommitTrackerLinker();
    linker.initialize({ getDatabase: () => ({ query: mockQuery }) });

    // A commit that only mentions the item, with no closing keyword, is not
    // the user's sign-off -- the commit-is-approval rule holds.
    const result = await linker.linkBySession(
      'def5678',
      'wip: still chasing NIM-43',
      'session-2',
      '/workspace',
    );

    expect(result.closedItemIds).toEqual([]);
    expect(db.trackerItems.get('bug-2')?.data.status).toBe('in-review');
  });
});

// @vitest-environment node
import { createStore } from 'jotai';
import { describe, expect, it } from 'vitest';
import type { SessionData } from '@nimbalyst/runtime/ai/server/types';
import { sessionStoreAtom } from '../sessions';
import type { TeammateInfo } from '../../../components/AgentMode/TeammatePanel';
import type { TaskInfo } from '../agentMode';
import {
  mapTeammateStatus,
  mapTaskStatus,
  sessionSubAgentStatusesAtom,
} from '../subAgentStatus';

describe('mapTeammateStatus', () => {
  it.each([
    ['running', 'working'],
    ['idle', 'waiting'],
    ['blocked', 'blocked'],
    ['completed', 'complete'],
    ['errored', 'error'],
  ] as const)('maps teammate status %s to %s', (source, expected) => {
    expect(mapTeammateStatus(source)).toBe(expected);
  });
});

describe('mapTaskStatus', () => {
  it.each([
    ['running', 'working'],
    ['stopped', 'error'],
    ['blocked', 'blocked'],
    ['completed', 'complete'],
    ['failed', 'error'],
  ] as const)('maps task status %s to %s', (source, expected) => {
    expect(mapTaskStatus(source)).toBe(expected);
  });
});

function teammate(overrides: Partial<TeammateInfo> = {}): TeammateInfo {
  return {
    name: 'Alex',
    agentId: 'teammate-1',
    teamName: 'Team A',
    agentType: 'engineer',
    status: 'running',
    ...overrides,
  };
}

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
  return {
    taskId: 'task-1',
    description: 'Do a thing',
    status: 'running',
    startedAt: 1,
    toolCount: 0,
    tokenCount: 0,
    durationMs: 0,
    ...overrides,
  };
}

function sessionData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    id: 'session-1',
    provider: 'claude-code',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('sessionSubAgentStatusesAtom', () => {
  it('normalizes teammates and tasks from session metadata into one list', () => {
    const store = createStore();
    store.set(
      sessionStoreAtom('session-1'),
      sessionData({
        metadata: {
          currentTeammates: [teammate({ agentId: 'teammate-1', status: 'blocked' })],
          currentTasks: [task({ taskId: 'task-1', status: 'failed' })],
        },
      }),
    );

    const result = store.get(sessionSubAgentStatusesAtom('session-1'));

    expect(result).toEqual([
      { id: 'teammate-1', kind: 'teammate', status: 'blocked' },
      { id: 'task-1', kind: 'task', status: 'error' },
    ]);
  });

  it('returns an empty list when the session has no active sub-agents', () => {
    const store = createStore();
    store.set(sessionStoreAtom('session-2'), sessionData({ id: 'session-2' }));

    expect(store.get(sessionSubAgentStatusesAtom('session-2'))).toEqual([]);
  });
});

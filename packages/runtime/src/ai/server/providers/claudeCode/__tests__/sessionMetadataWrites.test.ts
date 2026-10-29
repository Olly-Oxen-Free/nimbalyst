// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateMetadata = vi.fn(async (_id: string, _payload: any) => {});
const get = vi.fn(async (_id: string): Promise<any> => null);
vi.mock('../../../../../storage/repositories/AISessionsRepository', () => ({
  AISessionsRepository: { updateMetadata, get },
}));

import { persistCurrentTasks, stopStaleRunningTasks } from '../sessionMetadataWrites';
import { applySystemTaskChunk, FINISHED_TASK_RETENTION, type TrackedSystemTask } from '../systemTaskChunks';

function runBashTask(tasks: Map<string, TrackedSystemTask>, id: string) {
  const base = { tasks, draining: false, graceExpired: false, notifications: [] };
  applySystemTaskChunk({ ...base, subtype: 'task_started', chunk: { task_id: id, task_type: 'local_bash', description: `cmd ${id}` } });
  applySystemTaskChunk({ ...base, subtype: 'task_notification', chunk: { task_id: id, status: 'completed', summary: `cmd ${id}`, output_file: `/tmp/${id}` } });
}

describe('persistCurrentTasks', () => {
  beforeEach(() => {
    updateMetadata.mockClear();
    get.mockClear();
  });

  it('keeps the persisted task list bounded across many task events and writes only currentTasks', async () => {
    const tasks = new Map<string, TrackedSystemTask>();
    const base = { tasks, draining: false, graceExpired: false, notifications: [] };
    applySystemTaskChunk({ ...base, subtype: 'task_started', chunk: { task_id: 'long-running', task_type: 'local_agent', description: 'agent' } });
    for (let i = 0; i < 1000; i++) {
      runBashTask(tasks, `t${i}`);
      await persistCurrentTasks('s1', tasks, () => {});
    }

    const payload = updateMetadata.mock.calls.at(-1)![1];
    expect(Object.keys(payload.metadata)).toEqual(['currentTasks']);
    const persisted = payload.metadata.currentTasks as TrackedSystemTask[];
    expect(persisted).toHaveLength(FINISHED_TASK_RETENTION + 1);
    expect(persisted.map(t => t.taskId)).toContain('long-running');
    expect(persisted.map(t => t.taskId)).toContain('t999');
    expect(persisted.map(t => t.taskId)).not.toContain('t979');
    expect(persisted.some(t => 'pendingTerminalNotification' in t)).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
});

describe('stopStaleRunningTasks', () => {
  beforeEach(() => {
    updateMetadata.mockClear();
    get.mockClear();
  });

  it('stops tasks a crashed process left running or blocked, and leaves finished ones alone', async () => {
    get.mockResolvedValueOnce({
      metadata: {
        currentTasks: [
          { taskId: 'run', status: 'running' },
          { taskId: 'blk', status: 'blocked' },
          { taskId: 'done', status: 'completed' },
        ],
      },
    });

    await stopStaleRunningTasks('s1', () => {});

    const persisted = updateMetadata.mock.calls.at(-1)![1].metadata.currentTasks as TrackedSystemTask[];
    expect(Object.fromEntries(persisted.map(t => [t.taskId, t.status]))).toEqual({
      run: 'stopped',
      blk: 'stopped',
      done: 'completed',
    });
  });
});

// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  findTaskOwningSubagentChunk,
  isTaskSubagentRawChunk,
} from '../subagentTaskCorrelation';
import {
  isTransientClaudeCodeChunk,
  slimClaudeCodeChunkForStorage,
} from '../toolChunkUtils';
import { capClaudeCodeChunkForStorage } from '../../../../../storage/toolOutputBudget';

const subagentChunk = (parentToolUseId: string, text: string) => ({
  type: 'assistant',
  session_id: 'subagent-sdk-session',
  parent_tool_use_id: parentToolUseId,
  message: { id: 'msg-1', role: 'assistant', content: [{ type: 'text', text }] },
});

describe('findTaskOwningSubagentChunk', () => {
  // Nesting is handled by construction: every depth gets its own activeTasks
  // entry with its own toolUseId, so a direct match cannot climb to an
  // ancestor. This is the case an earlier design got wrong by resolving
  // through subagentToolCallOwners, whose keys are INNER tool_use ids.
  const depth1 = { taskId: 'task-1', toolUseId: 'tool-outer' };
  const depth2 = { taskId: 'task-2', toolUseId: 'tool-inner' };
  const tasks = [depth1, depth2];

  it('matches a depth-1 sub-agent chunk to its own task', () => {
    expect(findTaskOwningSubagentChunk(tasks, 'tool-outer')).toBe(depth1);
  });

  it('matches a depth-2 sub-agent chunk to its OWN task, not its ancestor', () => {
    expect(findTaskOwningSubagentChunk(tasks, 'tool-inner')).toBe(depth2);
  });

  it('returns undefined for an unmatched parent id and for no parent id', () => {
    // A teammate's chunk (separate SDK query, different id space) and a chunk
    // racing ahead of task_started both land here. Neither may be force-fit.
    expect(findTaskOwningSubagentChunk(tasks, 'tool-from-a-teammate')).toBeUndefined();
    expect(findTaskOwningSubagentChunk(tasks, undefined)).toBeUndefined();
  });

  it('still matches a task that has already finished', () => {
    // activeTasks entries are status-transitioned, never deleted -- which is
    // what keeps a completed sub-agent's transcript readable.
    const completed = [{ taskId: 'task-3', toolUseId: 'tool-done', status: 'completed' }];
    expect(findTaskOwningSubagentChunk(completed, 'tool-done')).toBe(completed[0]);
  });
});

describe('isTaskSubagentRawChunk', () => {
  it('accepts a forwarded chunk whose parent_tool_use_id matches', () => {
    const content = JSON.stringify(subagentChunk('tool-outer', 'sub-agent speaking'));
    expect(isTaskSubagentRawChunk(content, 'tool-outer')).toBe(true);
    expect(isTaskSubagentRawChunk(content, 'tool-other')).toBe(false);
  });

  it("rejects the lead's own Task tool_use block even though it carries the id", () => {
    // The cheap substring reject cannot distinguish these; the parse-confirm must.
    const leadTaskCall = JSON.stringify({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [{ type: 'tool_use', id: 'tool-outer', name: 'Task', input: {} }],
      },
    });
    expect(isTaskSubagentRawChunk(leadTaskCall, 'tool-outer')).toBe(false);
  });

  it('rejects a teammate-tagged chunk', () => {
    // Teammates are also Task dispatch and their own nested sub-agents produce
    // rows with a parent_tool_use_id; those belong to the teammate thread view.
    const teammate = JSON.stringify({
      ...subagentChunk('tool-outer', 'teammate speaking'),
      _isTeammateOutput: true,
      _teammateAgentId: 'reviewer@core',
    });
    expect(isTaskSubagentRawChunk(teammate, 'tool-outer')).toBe(false);
  });

  it('rejects non-JSON and non-string content', () => {
    expect(isTaskSubagentRawChunk('tool-outer but not json', 'tool-outer')).toBe(false);
    expect(isTaskSubagentRawChunk(null, 'tool-outer')).toBe(false);
  });
});

describe('forwarded sub-agent chunks survive the storage path', () => {
  // Option B rests on this: no new write is needed because the provider's
  // existing persistence already stores the forwarded chunk with its
  // parent_tool_use_id intact. If either transform starts dropping the field,
  // sub-agent transcripts silently become unreadable.
  it('is not filtered as transient and keeps parent_tool_use_id through slim + cap', () => {
    const chunk = subagentChunk('tool-outer', 'sub-agent speaking');
    expect(isTransientClaudeCodeChunk(chunk)).toBe(false);

    const stored = capClaudeCodeChunkForStorage(slimClaudeCodeChunkForStorage(chunk)) as {
      parent_tool_use_id?: string;
    };
    expect(stored.parent_tool_use_id).toBe('tool-outer');
  });
});

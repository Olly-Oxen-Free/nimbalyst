/**
 * projectRawMessages -- client-side transcript projection for mobile clients.
 *
 * Mobile clients (iOS/Android WKWebView bundles) receive raw ai_agent_messages
 * via sync but do not have the canonical ai_transcript_events table that
 * desktop builds via TranscriptTransformer. This module runs the same parser
 * pipeline in memory so the mobile transcript renderer produces identical
 * output to desktop.
 *
 * Pipeline: raw messages -> per-provider parser -> descriptors ->
 * processDescriptor -> in-memory event store -> TranscriptProjector ->
 * TranscriptViewMessage[].
 */

import { TranscriptWriter } from './TranscriptWriter';
import { TranscriptProjector, type TranscriptViewMessage } from './TranscriptProjector';
import { InMemoryTranscriptEventStore } from './InMemoryTranscriptEventStore';
import { ClaudeCodeRawParser } from './parsers/ClaudeCodeRawParser';
import { CodexRawParserDispatcher } from './parsers/CodexRawParserDispatcher';
import { CodexACPRawParser } from './parsers/CodexACPRawParser';
import { CopilotRawParser } from './parsers/CopilotRawParser';
import { OpenCodeRawParser } from './parsers/OpenCodeRawParser';
import { VoiceRawParser } from './parsers/VoiceRawParser';
import type { IRawMessageParser, ParseContext } from './parsers/IRawMessageParser';
import { HeadlessAgentRawParser } from './parsers/HeadlessAgentRawParser';
import { GeminiAntigravityRawParser } from './parsers/GeminiAntigravityRawParser';
import type { RawMessage } from './TranscriptTransformer';
import type { TranscriptEvent } from './types';
import { processDescriptor, selectRawParser, findTeammateSpawnToolUseId, stampPromptSource } from './processDescriptor';
import { isTaskSubagentRawChunk } from '../providers/claudeCode/subagentTaskCorrelation';

export interface RawProjectionOptions {
  /**
   * Parse `_isTeammateOutput`-tagged chunks for a teammate's own thread view
   * (see ClaudeCodeRawParser.setTeammateProjectionMode). Never set this when
   * projecting a lead session's transcript.
   */
  teammateProjection?: boolean;
  /**
   * Parse `parent_tool_use_id`-carrying chunks as ordinary assistant output,
   * for one Task sub-agent's own transcript (see
   * ClaudeCodeRawParser.setSubagentProjectionMode). Never set this when
   * projecting a lead session's transcript.
   */
  subagentProjection?: boolean;
}

function createParser(provider: string, options?: RawProjectionOptions): IRawMessageParser {
  const kind = selectRawParser(provider);
  // Codex has two transports (SDK / app-server) with different output shapes;
  // route per-message via the same dispatcher the server-side transformer uses,
  // otherwise app-server sessions parse with the SDK parser and silently drop
  // every assistant/tool event (the catch in rawMessagesToCanonicalEvents
  // swallows the resulting parse errors, leaving only user prompts visible).
  if (kind === 'codex') return new CodexRawParserDispatcher();
  if (kind === 'codex-acp') return new CodexACPRawParser();
  if (kind === 'copilot') return new CopilotRawParser();
  if (kind === 'opencode') return new OpenCodeRawParser();
  if (kind === 'grok-build' || kind === 'cursor-agent') return new HeadlessAgentRawParser(kind);
  if (kind === 'gemini-antigravity') return new GeminiAntigravityRawParser();
  if (kind === 'voice') return new VoiceRawParser();
  const claudeParser = new ClaudeCodeRawParser();
  if (options?.teammateProjection) claudeParser.setTeammateProjectionMode(true);
  if (options?.subagentProjection) claudeParser.setSubagentProjectionMode(true);
  return claudeParser;
}

/**
 * Parse raw messages into canonical TranscriptEvents in memory.
 * Pure function: no DB, no side effects.
 */
export async function rawMessagesToCanonicalEvents(
  rawMessages: RawMessage[],
  provider: string,
  options?: RawProjectionOptions,
): Promise<TranscriptEvent[]> {
  if (rawMessages.length === 0) return [];

  const sessionId = rawMessages[0].sessionId;
  const store = new InMemoryTranscriptEventStore();
  const writer = new TranscriptWriter(store, provider);
  const parser = createParser(provider, options);

  writer.seedSequence(1);
  const toolEventIds = new Map<string, number>();
  const subagentEventIds = new Map<string, number>();

  const context: ParseContext = {
    sessionId,
    hasToolCall: (id: string) => toolEventIds.has(id),
    hasSubagent: (id: string) => subagentEventIds.has(id),
    findByProviderToolCallId: (id: string) =>
      store.findByProviderToolCallId(id, sessionId),
    findActiveToolCallByRawProviderId: (rawId: string) =>
      store.findActiveToolCallByRawProviderId(rawId, sessionId),
    findTeammateSpawnToolUseId: (agentId: string) =>
      findTeammateSpawnToolUseId(store, sessionId, agentId),
  };

  for (const msg of rawMessages) {
    try {
      const descriptors = await parser.parseMessage(msg, context);
      for (const desc of descriptors) {
        await processDescriptor(
          writer,
          store,
          msg.sessionId,
          stampPromptSource(desc, msg),
          toolEventIds,
          subagentEventIds,
        );
      }
    } catch {
      // Skip unparseable messages -- matches server-side transformer behavior
    }
  }

  return store.getAllEvents();
}

/**
 * Parse raw messages and project them to the view model the transcript
 * renderer consumes. Client-side equivalent of desktop's
 * TranscriptProjector.project(events) pipeline.
 */
export async function projectRawMessagesToViewMessages(
  rawMessages: RawMessage[],
  provider: string,
  options?: RawProjectionOptions,
): Promise<TranscriptViewMessage[]> {
  const events = await rawMessagesToCanonicalEvents(rawMessages, provider, options);
  return TranscriptProjector.project(events).messages;
}

/**
 * Project one managed teammate's thread out of the LEAD session's raw log.
 *
 * Teammate chunks are stored as the whole raw SDK message with
 * `_isTeammateOutput`/`_teammateAgentId` spread in (TeammateManager
 * streamTeammateOutput / deliverMessageToLead), interleaved with the lead's
 * own messages in `ai_agent_messages`. Filter to the requested teammate, then
 * run the same parser pipeline the rest of the app uses.
 *
 * @param leadRawMessages Every raw message of the lead session, in id order.
 * @param agentId The teammate's agent id.
 */
export async function projectTeammateRawMessages(
  leadRawMessages: RawMessage[],
  agentId: string,
): Promise<TranscriptViewMessage[]> {
  const teammateMessages = leadRawMessages.filter((msg) => {
    // Cheap reject first: lead sessions carry thousands of rows and only
    // teammate chunks ever contain the tag.
    if (typeof msg.content !== 'string' || !msg.content.includes('_teammateAgentId')) {
      return false;
    }
    try {
      return JSON.parse(msg.content)._teammateAgentId === agentId;
    } catch {
      return false;
    }
  });

  return projectRawMessagesToViewMessages(teammateMessages, 'claude-code', {
    teammateProjection: true,
  });
}

/**
 * Project one Task sub-agent's thread out of the LEAD session's raw log.
 *
 * `forwardSubagentText` relays a sub-agent's chunks through the lead's own
 * iterator, and the provider persists them like any other chunk with
 * `parent_tool_use_id` intact — so no separate write exists, and the rows are
 * already durable. Filter the lead's log to one sub-agent, then run the same
 * parser pipeline the rest of the app uses.
 *
 * @param leadRawMessages Every raw message of the lead session, in id order.
 * @param toolUseId The tool_use id of the `Task` call that spawned the
 *   sub-agent. Resolve it from a taskId via
 *   `ClaudeCodeProvider.getTaskToolUseId` when only the taskId is known.
 */
export async function projectTaskSubagentRawMessages(
  leadRawMessages: RawMessage[],
  toolUseId: string,
): Promise<TranscriptViewMessage[]> {
  const subagentMessages = leadRawMessages.filter((msg) =>
    isTaskSubagentRawChunk(msg.content, toolUseId),
  );

  return projectRawMessagesToViewMessages(subagentMessages, 'claude-code', {
    subagentProjection: true,
  });
}

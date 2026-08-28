// @vitest-environment node
/**
 * Wiring test for `syncAgentTeamsFlag`.
 *
 * The flag itself was already computed inline in `sendMessage` before this
 * method was extracted -- and never assigned to `teammateManager
 * .enableAgentTeams`, the only place that reads it. TeammateManager's own
 * spawn-gate fix (adapting to SDK 0.3.221's implicit-team protocol) was
 * consequently inert: `enableAgentTeams` stayed `undefined` on every real
 * session, so a name-only spawn never reached the gate's interception branch.
 * This is exactly the class of bug unit tests on TeammateManager in isolation
 * can't catch -- they set the flag directly on the instance under test, which
 * proves the gate is correct but not that anything ever sets it for real.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

vi.mock('../claudeCode/cliPathResolver', () => ({
  resolveClaudeAgentCliPath: async () => '/fake/claude',
}));

vi.mock('../../../../electron/claudeCodeEnvironment', () => ({
  setupClaudeCodeEnvironment: () => ({}),
  resolveNativeBinaryPath: () => undefined,
}));

import { ClaudeCodeProvider } from '../ClaudeCodeProvider';

type ProviderInternals = {
  teammateManager: { enableAgentTeams?: boolean; shutdownGraceMs: number };
  syncAgentTeamsFlag: (settingsEnv: Record<string, string>) => boolean;
  setTeammateShutdownGraceSeconds: (seconds: number) => void;
};

describe('ClaudeCodeProvider.syncAgentTeamsFlag', () => {
  it('reaches TeammateManager.enableAgentTeams when the settings flag is on', () => {
    const provider = new ClaudeCodeProvider() as unknown as ProviderInternals;

    const result = provider.syncAgentTeamsFlag({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' });

    expect(result).toBe(true);
    expect(provider.teammateManager.enableAgentTeams).toBe(true);
  });

  it('leaves it false when the settings flag is off or absent', () => {
    const provider = new ClaudeCodeProvider() as unknown as ProviderInternals;

    expect(provider.syncAgentTeamsFlag({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' })).toBe(false);
    expect(provider.teammateManager.enableAgentTeams).toBe(false);

    expect(provider.syncAgentTeamsFlag({})).toBe(false);
    expect(provider.teammateManager.enableAgentTeams).toBe(false);
  });

  it('re-syncs on every call, so a mid-session settings change takes effect on the next turn', () => {
    const provider = new ClaudeCodeProvider() as unknown as ProviderInternals;

    provider.syncAgentTeamsFlag({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' });
    expect(provider.teammateManager.enableAgentTeams).toBe(true);

    provider.syncAgentTeamsFlag({ CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '0' });
    expect(provider.teammateManager.enableAgentTeams).toBe(false);
  });
});

/**
 * The same wiring hazard for the shutdown grace period: the setting is stored in
 * seconds by electron's workspace-settings store, and TeammateManager only ever
 * reads milliseconds. TeammateManager's own grace-period tests set
 * `shutdownGraceMs` directly, so nothing else proves the conversion happens.
 */
describe('ClaudeCodeProvider.setTeammateShutdownGraceSeconds', () => {
  it('converts the stored seconds into the milliseconds TeammateManager reads', () => {
    const provider = new ClaudeCodeProvider() as unknown as ProviderInternals;

    provider.setTeammateShutdownGraceSeconds(5);

    expect(provider.teammateManager.shutdownGraceMs).toBe(5000);
  });

  it.each([0, -1, Number.NaN])('clamps %p to no grace period at all', seconds => {
    const provider = new ClaudeCodeProvider() as unknown as ProviderInternals;
    provider.setTeammateShutdownGraceSeconds(5);

    provider.setTeammateShutdownGraceSeconds(seconds);

    expect(provider.teammateManager.shutdownGraceMs).toBe(0);
  });
});

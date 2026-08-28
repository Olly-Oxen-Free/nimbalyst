// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Provider, createStore, atom } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeammateInfo } from '../TeammatePanel';

const testState = vi.hoisted(() => ({ teammates: [] as TeammateInfo[] }));

// Narrowest mocks: the atoms the panel reads plus the icon module (its deep
// path keeps the runtime barrel out of the graph).
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom: makeAtom } = await import('jotai');
  const teammates = makeAtom(() => testState.teammates);
  const tasks = makeAtom(() => [] as unknown[]);
  const collapsed = makeAtom(false);
  const noop = makeAtom(null, () => {});
  return {
    sessionTeammatesAtom: () => teammates,
    sessionTasksAtom: () => tasks,
    teammatePanelCollapsedAtom: collapsed,
    agentPanelCollapsedAtom: collapsed,
    toggleTeammatePanelCollapsedAtom: noop,
    toggleAgentPanelCollapsedAtom: noop,
    scrollToTeammateAtom: noop,
    toggleTaskTileAtom: noop,
  };
});

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: () => null,
}));

import { TeammatePanel } from '../TeammatePanel';

function row(name: string, status: TeammateInfo['status'], endedAt?: number): TeammateInfo {
  return { name, agentId: name, teamName: 'squad', agentType: 'general', status, endedAt };
}

function renderPanel() {
  const result = render(
    <Provider store={createStore()}>
      <TeammatePanel sessionId="lead-1" />
    </Provider>,
  );
  return Array.from(result.container.querySelectorAll('.teammate-item-name'))
    .map(el => el.textContent);
}

describe('TeammatePanel teammate ordering', () => {
  afterEach(cleanup);

  it('sinks ended teammates below the live ones and sorts them most-recently-ended first', () => {
    testState.teammates = [
      row('old-done', 'completed', 1_000),
      row('runner', 'running'),
      row('fresh-done', 'errored', 9_000),
      row('waiter', 'idle'),
    ];

    expect(renderPanel()).toEqual(['runner', 'waiter', 'fresh-done', 'old-done']);
  });

  it('sorts a row with no endedAt last, since it predates the field and is not recent', () => {
    testState.teammates = [
      row('undated', 'completed'),
      row('dated', 'completed', 5_000),
    ];

    expect(renderPanel()).toEqual(['dated', 'undated']);
  });
});

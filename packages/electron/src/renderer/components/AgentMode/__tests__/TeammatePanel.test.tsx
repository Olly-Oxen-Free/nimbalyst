// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Provider, createStore, atom } from 'jotai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TeammateInfo } from '../TeammatePanel';

const testState = vi.hoisted(() => ({ teammates: [] as TeammateInfo[] }));
const spies = vi.hoisted(() => ({
  setScrollTarget: vi.fn(),
  toggleTeammateTile: vi.fn(),
}));

// Narrowest mocks: the atoms the panel reads plus the icon module (its deep
// path keeps the runtime barrel out of the graph).
vi.mock('../../../store/atoms/agentMode', async () => {
  const { atom: makeAtom } = await import('jotai');
  const teammates = makeAtom(() => testState.teammates);
  const tasks = makeAtom(() => [] as unknown[]);
  const collapsed = makeAtom(false);
  const noop = makeAtom(null, () => {});
  const scrollToTeammateAtom = makeAtom(null, (_get, _set, arg: unknown) => {
    spies.setScrollTarget(arg);
  });
  const toggleTeammateTileAtom = makeAtom(null, (_get, _set, arg: unknown) => {
    spies.toggleTeammateTile(arg);
  });
  return {
    sessionTeammatesAtom: () => teammates,
    sessionTasksAtom: () => tasks,
    teammatePanelCollapsedAtom: collapsed,
    agentPanelCollapsedAtom: collapsed,
    toggleTeammatePanelCollapsedAtom: noop,
    toggleAgentPanelCollapsedAtom: noop,
    scrollToTeammateAtom,
    toggleTeammateTileAtom,
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

describe('TeammatePanel teammate click', () => {
  afterEach(cleanup);

  it('scrolls to the spawn point and toggles the tile when a teammate row is clicked', () => {
    testState.teammates = [row('runner', 'running')];
    spies.setScrollTarget.mockClear();
    spies.toggleTeammateTile.mockClear();

    const result = render(
      <Provider store={createStore()}>
        <TeammatePanel sessionId="lead-1" />
      </Provider>,
    );
    const item = result.container.querySelector('.teammate-item');
    fireEvent.click(item as Element);

    expect(spies.setScrollTarget).toHaveBeenCalledWith({ sessionId: 'lead-1', agentId: 'runner' });
    expect(spies.toggleTeammateTile).toHaveBeenCalledWith({ sessionId: 'lead-1', agentId: 'runner' });
  });
});

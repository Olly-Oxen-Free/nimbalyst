// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';

vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon }: { icon: string }) => <span data-icon={icon} />,
}));

import { AdvancedPanel } from '../AdvancedPanel';
import {
  multiProjectModeAtom,
  projectRailPositionAtom,
} from '../../../../store/atoms/openProjects';

afterEach(() => {
  cleanup();
  getDefaultStore().set(multiProjectModeAtom, false);
  getDefaultStore().set(projectRailPositionAtom, 'left');
  delete (window as any).electronAPI;
});

// 2a: dependent-visibility coverage for the project-bar position and
// display-mode controls. AdvancedPanel has no IPC calls gating its own
// mount, so no electronAPI stub is required for these two controls
// specifically — set only via `window.electronAPI` if a future test
// needs it.
describe('AdvancedPanel project-bar layout controls', () => {
  it('hides the position control when multi-project mode is off', () => {
    getDefaultStore().set(multiProjectModeAtom, false);
    render(<AdvancedPanel />);

    expect(screen.queryByText('Project Bar Position')).toBeNull();
  });

  it('shows the position control when multi-project mode is on', () => {
    getDefaultStore().set(multiProjectModeAtom, true);
    render(<AdvancedPanel />);

    expect(screen.queryByText('Project Bar Position')).not.toBeNull();
  });

  it('hides the display-mode control when position is not top', () => {
    getDefaultStore().set(multiProjectModeAtom, true);
    getDefaultStore().set(projectRailPositionAtom, 'left');
    render(<AdvancedPanel />);

    expect(screen.queryByText('Non-Selected Project Display')).toBeNull();
  });

  it('shows the display-mode control when position is top', () => {
    getDefaultStore().set(multiProjectModeAtom, true);
    getDefaultStore().set(projectRailPositionAtom, 'top');
    render(<AdvancedPanel />);

    expect(screen.queryByText('Non-Selected Project Display')).not.toBeNull();
  });
});

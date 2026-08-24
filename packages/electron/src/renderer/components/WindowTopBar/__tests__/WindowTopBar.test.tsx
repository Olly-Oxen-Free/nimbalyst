// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultStore } from 'jotai';
import { WindowTopBar, clampGitFeedbackMessage } from '../WindowTopBar';
import { windowFullScreenAtom } from '../../../store/atoms/windowFullScreen';
import { NO_DRAG_REGION } from '../dragRegion';
import {
  openProjectsAtom,
  activeWorkspacePathAtom,
  multiProjectModeAtom,
  projectRailPositionAtom,
  type OpenProject,
} from '../../../store/atoms/openProjects';

// Only the icon needs stubbing (jsdom has no font ligatures). The rest of the
// barrel is kept real: the bar's imports reach other runtime exports
// transitively, and listing each one by hand goes stale on every new import.
vi.mock('@nimbalyst/runtime/ui/icons/MaterialSymbol', () => ({
  MaterialSymbol: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-icon={icon} className={className} aria-hidden="true">{icon}</span>
  ),
}));

afterEach(() => {
  cleanup();
  getDefaultStore().set(windowFullScreenAtom, false);
  getDefaultStore().set(multiProjectModeAtom, false);
  getDefaultStore().set(projectRailPositionAtom, 'left');
  getDefaultStore().set(openProjectsAtom, []);
  getDefaultStore().set(activeWorkspacePathAtom, null);
});

describe('WindowTopBar', () => {
  it('renders stable markers, workspace identity, and active mode', () => {
    render(
      <WindowTopBar
        workspaceName="Timely Nebula"
        activeModeLabel="Shared Docs"
        gitStatus={null}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
      />,
    );

    const root = screen.getByTestId('window-top-bar');
    expect(root.classList.contains('window-top-bar')).toBe(true);
    expect(root.getAttribute('data-component')).toBe('WindowTopBar');
    expect(root.getAttribute('style')).toContain('height: 38px');
    expect(screen.getByTestId('window-top-bar-workspace-name').textContent).toBe('Timely Nebula');
    expect(screen.getByTestId('window-top-bar-mode-label').textContent).toBe('Shared Docs');
    expect(screen.queryByTestId('window-top-bar-git-status')).toBeNull();
    expect(screen.queryByTestId('window-top-bar-git-slot')).toBeNull();
  });

  it('renders branch, dirty, ahead, and behind state from explicit props', () => {
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={{
          branch: 'feature/custom-title-bar',
          hasUncommitted: true,
          ahead: 2,
          behind: 3,
        }}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
      />,
    );

    const git = screen.getByTestId('window-top-bar-git-status');
    expect(git.textContent).toContain('feature/custom-title-bar');
    expect(git.textContent).toContain('Modified');
    expect(git.textContent).toContain('2');
    expect(git.textContent).toContain('3');
    expect(git.querySelector('[data-icon="arrow_upward"]')).not.toBeNull();
    expect(git.querySelector('[data-icon="arrow_downward"]')).not.toBeNull();
    expect(git.getAttribute('title')).toContain('feature/custom-title-bar');
  });

  it('places git between the project identity and the far-right actions', () => {
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={{ branch: 'main', hasUncommitted: false, ahead: 1, behind: 0 }}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
        newSessionControl={{ label: 'New AI session', onCreate: () => {} }}
        panelControls={{
          right: { label: 'AI chat', collapsed: true, onToggle: () => {} },
        }}
      />,
    );

    const gitSlot = screen.getByTestId('window-top-bar-git-slot');
    const rightActions = screen.getByTestId('window-top-bar-right-actions');
    expect(screen.getByTestId('window-top-bar-git-status').parentElement).toBe(gitSlot);
    expect(screen.getByTestId('window-top-bar-new-session').parentElement).toBe(rightActions);
    expect(screen.getByTestId('window-top-bar-right-pane').parentElement).toBe(rightActions);
    expect(
      gitSlot.compareDocumentPosition(rightActions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('omits pane buttons when the active mode exposes no capabilities', () => {
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Tracker"
        gitStatus={null}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
      />,
    );

    expect(screen.queryByTestId('window-top-bar-left-pane')).toBeNull();
    expect(screen.queryByTestId('window-top-bar-right-pane')).toBeNull();
  });

  it('calls supplied pane actions once and marks every interactive target no-drag', () => {
    const onToggleLeft = vi.fn();
    const onToggleRight = vi.fn();
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={{ branch: 'main', hasUncommitted: false, ahead: 0, behind: 0 }}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
        panelControls={{
          left: { label: 'Files sidebar', collapsed: false, onToggle: onToggleLeft },
          right: { label: 'AI chat', collapsed: true, onToggle: onToggleRight },
        }}
      />,
    );

    const git = screen.getByTestId('window-top-bar-git-status');
    const left = screen.getByTestId('window-top-bar-left-pane');
    const right = screen.getByTestId('window-top-bar-right-pane');
    for (const target of [git, left, right]) {
      expect(target.classList.contains(NO_DRAG_REGION)).toBe(true);
    }

    fireEvent.click(left);
    fireEvent.click(right);

    expect(onToggleLeft).toHaveBeenCalledTimes(1);
    expect(onToggleRight).toHaveBeenCalledTimes(1);
    expect(left.getAttribute('aria-label')).toBe('Hide Files sidebar');
    expect(right.getAttribute('aria-label')).toBe('Show AI chat');
  });

  it('opens git actions from the intermediate status control', () => {
    const onPull = vi.fn();
    const onPush = vi.fn();
    const onOpenLog = vi.fn();
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={{ branch: 'main', hasUncommitted: false, ahead: 1, behind: 2 }}
        gitActions={{ onPull, onPush, onOpenLog }}
      />,
    );

    fireEvent.click(screen.getByTestId('window-top-bar-git-status'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pull' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Push' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open Git Log' }));

    expect(onPull).toHaveBeenCalledTimes(1);
    expect(onPush).toHaveBeenCalledTimes(1);
    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  it('links to extension settings when Git Log is unavailable', () => {
    const onOpenLog = vi.fn();
    const onOpenExtensionSettings = vi.fn();
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={{ branch: 'main', hasUncommitted: false, ahead: 0, behind: 0 }}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog,
          onOpenExtensionSettings,
          gitLogAvailable: false,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('window-top-bar-git-status'));
    expect(
      (screen.getByRole('menuitem', { name: 'Open Git Log' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enable Git Extension…' }));

    expect(onOpenLog).not.toHaveBeenCalled();
    expect(onOpenExtensionSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('window-top-bar-git-menu')).toBeNull();
  });

  it('moves the chat new-session action into the title bar', () => {
    const onCreate = vi.fn();
    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={null}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
        newSessionControl={{ label: 'New AI session', onCreate }}
      />,
    );

    fireEvent.click(screen.getByTestId('window-top-bar-new-session'));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  function renderAgentPanelControl({
    collapsed = false,
    onToggle = () => {},
    onChat = () => {},
    selectedId = 'edited-files',
  }: {
    collapsed?: boolean;
    onToggle?: () => void;
    onChat?: () => void;
    selectedId?: string;
  } = {}) {
    return render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Agent"
        gitStatus={null}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
        panelControls={{
          right: {
            label: 'Agent right panel',
            collapsed,
            onToggle,
            options: [
              {
                id: 'edited-files',
                label: 'Edited Files',
                icon: 'description',
                selected: selectedId === 'edited-files',
                onSelect: () => {},
              },
              {
                id: 'review',
                label: 'Review',
                icon: 'rate_review',
                selected: selectedId === 'review',
                onSelect: () => {},
              },
              {
                id: 'session-chat',
                label: 'Chat with Session',
                icon: 'forum',
                selected: selectedId === 'session-chat',
                onSelect: onChat,
              },
            ],
          },
        }}
      />,
    );
  }

  it('selects an Agent right-panel mode from the window top-bar dropdown', () => {
    const onChat = vi.fn();
    const onToggle = vi.fn();
    renderAgentPanelControl({ onChat, onToggle });

    fireEvent.click(screen.getByTestId('window-top-bar-right-pane-menu-button'));
    screen.getByRole('menuitem', { name: 'Edited Files' });
    screen.getByRole('menuitem', { name: 'Review' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Chat with Session' }));
    expect(onChat).toHaveBeenCalledTimes(1);
    // Opening or choosing from the menu must never toggle visibility.
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('toggles the Agent right panel from the split button without opening the menu', () => {
    const onToggle = vi.fn();
    renderAgentPanelControl({ onToggle });

    const toggle = screen.getByTestId('window-top-bar-right-pane');
    expect(toggle.getAttribute('aria-label')).toBe('Hide Agent right panel: Edited Files');
    fireEvent.click(toggle);

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('window-top-bar-right-pane-menu')).toBeNull();
  });

  it('keeps the selected mode marked while the Agent right panel is hidden', () => {
    renderAgentPanelControl({ collapsed: true, selectedId: 'review' });

    const toggle = screen.getByTestId('window-top-bar-right-pane');
    expect(toggle.getAttribute('data-collapsed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Show Agent right panel: Review');
    // The badge tells you which pane the toggle will bring back.
    expect(toggle.querySelector('.window-top-bar__panel-mode-badge')?.textContent).toBe(
      'rate_review',
    );

    fireEvent.click(screen.getByTestId('window-top-bar-right-pane-menu-button'));
    expect(
      screen.getByRole('menuitem', { name: 'Review' }).getAttribute('data-selected'),
    ).toBe('true');
    expect(screen.queryByRole('menuitem', { name: 'Hidden' })).toBeNull();
  });

  it('clamps a long git failure message instead of rendering the whole log', () => {
    const hookLog = Array.from({ length: 400 }, (_, i) => `log line ${i} ${'x'.repeat(80)}`).join('\n');

    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={{ branch: 'main', hasUncommitted: true, ahead: 1, behind: 0 }}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
          feedback: { kind: 'error', message: hookLog },
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('window-top-bar-git-status'));
    const feedback = screen.getByTestId('window-top-bar-git-feedback');
    expect(feedback.textContent!.length).toBeLessThanOrEqual(301);
    expect(feedback.textContent!.endsWith('…')).toBe(true);
    expect(feedback.textContent).toContain('log line 0');
    expect(feedback.getAttribute('title')!.length).toBeLessThanOrEqual(2001);
  });

  // Fullscreen takes the OS window controls away, so the bar has to carry the
  // only visible way back out.
  it('exposes an exit control only while the window is fullscreen', () => {
    const exitWindowFullScreen = vi.fn();
    (window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
      exitWindowFullScreen,
    };

    render(
      <WindowTopBar
        workspaceName="Repo"
        activeModeLabel="Files"
        gitStatus={null}
        gitActions={{
          onPull: () => {},
          onPush: () => {},
          onOpenLog: () => {},
        }}
      />,
    );

    expect(screen.queryByTestId('window-top-bar-exit-full-screen')).toBeNull();

    act(() => {
      getDefaultStore().set(windowFullScreenAtom, true);
    });

    fireEvent.click(screen.getByTestId('window-top-bar-exit-full-screen'));
    expect(exitWindowFullScreen).toHaveBeenCalledTimes(1);
  });

  it('leaves short git feedback untouched', () => {
    expect(clampGitFeedbackMessage('Push completed')).toBe('Push completed');
    expect(clampGitFeedbackMessage('line 1\nline 2')).toBe('line 1\nline 2');
    expect(clampGitFeedbackMessage('a\nb\nc\nd\ne\nf\ng')).toBe('a\nb\nc\nd\ne\nf…');
  });

  // Task 3a/4a: top-docked project bar merge (R4/R5).
  describe('project-bar top placement', () => {
    function seedTopDocked() {
      const active: OpenProject = { path: '/ws/nebula', name: 'Nebula', openedAt: 0 };
      const other: OpenProject = { path: '/ws/aurora', name: 'Aurora', openedAt: 1 };
      getDefaultStore().set(openProjectsAtom, [active, other]);
      getDefaultStore().set(activeWorkspacePathAtom, active.path);
      getDefaultStore().set(multiProjectModeAtom, true);
      getDefaultStore().set(projectRailPositionAtom, 'top');
      return { active, other };
    }

    it('renders the active project full name from activeOpenProjectAtom when position is top', () => {
      const { active, other } = seedTopDocked();

      render(
        <WindowTopBar
          workspaceName="Fallback Workspace Name"
          activeModeLabel="Files"
          gitStatus={null}
          gitActions={{ onPull: () => {}, onPush: () => {}, onOpenLog: () => {} }}
        />,
      );

      expect(screen.getByTestId('window-top-bar-workspace-name').textContent).toBe(active.name);
      // The static mode-label span only exists in the fallback (left-docked)
      // branch — its absence here confirms the top-docked branch is a
      // structurally separate render path, not a conditional patch of the
      // same JSX.
      expect(screen.queryByTestId('window-top-bar-mode-label')).toBeNull();
      // The non-active project renders as a circle via the shared
      // ProjectRailIcon (1b), clickable to switch (R6).
      expect(screen.getByLabelText(`Switch to project ${other.name}`)).toBeTruthy();
    });

    it('switches the active project when a non-selected circle is clicked', () => {
      const { other } = seedTopDocked();

      render(
        <WindowTopBar
          workspaceName="Fallback Workspace Name"
          activeModeLabel="Files"
          gitStatus={null}
          gitActions={{ onPull: () => {}, onPush: () => {}, onOpenLog: () => {} }}
        />,
      );

      fireEvent.click(screen.getByLabelText(`Switch to project ${other.name}`));

      expect(getDefaultStore().get(activeWorkspacePathAtom)).toBe(other.path);
    });

    it("renders today's static workspace-name behavior unchanged when position is left", () => {
      // Explicit position='left' (also the atom default) confirms R4's
      // zero-regression requirement: the existing suite's other cases
      // already exercise this branch implicitly, this one pins it down
      // alongside the new top-docked coverage.
      getDefaultStore().set(projectRailPositionAtom, 'left');
      getDefaultStore().set(multiProjectModeAtom, false);

      render(
        <WindowTopBar
          workspaceName="Static Name"
          activeModeLabel="Files"
          gitStatus={null}
          gitActions={{ onPull: () => {}, onPush: () => {}, onOpenLog: () => {} }}
        />,
      );

      expect(screen.getByTestId('window-top-bar-workspace-name').textContent).toBe('Static Name');
      expect(screen.getByTestId('window-top-bar-mode-label').textContent).toBe('Files');
    });

    it('falls back to the static identity when multi-project mode is off even if position is top', () => {
      // R4/3a success criterion: position='top' with multi-project mode off
      // must show no rail remnant.
      getDefaultStore().set(projectRailPositionAtom, 'top');
      getDefaultStore().set(multiProjectModeAtom, false);

      render(
        <WindowTopBar
          workspaceName="Static Name"
          activeModeLabel="Files"
          gitStatus={null}
          gitActions={{ onPull: () => {}, onPush: () => {}, onOpenLog: () => {} }}
        />,
      );

      expect(screen.getByTestId('window-top-bar-workspace-name').textContent).toBe('Static Name');
      expect(screen.getByTestId('window-top-bar-mode-label').textContent).toBe('Files');
    });

    it('gives every interactive top-docked element explicit no-drag', () => {
      const { active, other } = seedTopDocked();

      render(
        <WindowTopBar
          workspaceName="Fallback Workspace Name"
          activeModeLabel="Files"
          gitStatus={null}
          gitActions={{ onPull: () => {}, onPush: () => {}, onOpenLog: () => {} }}
        />,
      );

      const closeActive = screen.getByLabelText(`Close ${active.name}`);
      const switchOther = screen.getByLabelText(`Switch to project ${other.name}`);
      const addButton = screen.getByTestId('window-top-bar-add-project');

      expect(addButton.classList.contains(NO_DRAG_REGION)).toBe(true);
      // Every project icon (active project's pill included — it renders
      // through the same shared ProjectRailIcon as every other project,
      // in its natural position, not a separately-classed element) opts
      // out via the wrapping `window-top-bar__identity-icons` group
      // rather than per-button, mirroring ProjectRail.tsx's own icon.
      expect(closeActive.closest('.window-top-bar__identity-icons')?.classList.contains(NO_DRAG_REGION)).toBe(true);
      expect(switchOther.closest('.window-top-bar__identity-icons')?.classList.contains(NO_DRAG_REGION)).toBe(true);
    });
  });
});

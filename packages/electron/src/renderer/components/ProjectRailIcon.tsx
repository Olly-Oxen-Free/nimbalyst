/**
 * ProjectRailIcon + useProjectRailController
 *
 * Shared project-bar building blocks extracted from `ProjectRail.tsx` so
 * both the left-docked rail and the top-docked `WindowTopBar` merge can
 * render the same icons and reuse the same add/close/capacity business
 * logic without duplicating it.
 *
 * `ProjectRailIcon` owns per-icon rendering (active state, hover tooltip,
 * close button) and takes a required `orientation` prop that drives its
 * tooltip placement and root class modifier. The add-menu, add-tooltip,
 * and context-menu `useFloating()` instances stay per-consumer (in
 * `ProjectRail.tsx` and, later, `WindowTopBar.tsx`) since their placement
 * differs by rendering context (vertical rail vs. horizontal top bar).
 *
 * `useProjectRailController()` owns the container-level business logic
 * (add-project flow, close handler, capacity check, activity-atom
 * wiring) so consumers don't re-implement it.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { getShowInFileBrowserLabel } from '@nimbalyst/runtime';
import {
  useFloating,
  FloatingPortal,
  useHover,
  useInteractions,
  offset,
  flip,
  shift,
} from '@floating-ui/react';
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import {
  openProjectsAtom,
  activeWorkspacePathAtom,
  isOpenProjectsAtCapAtom,
  addOpenProjectAtom,
  closeOpenProjectAtom,
  type OpenProject,
} from '../store/atoms/openProjects';
import {
  globalSessionActivityAtom,
  projectActivitySummaryAtom,
} from '../store/atoms/sessionActivity';
import { generateWorkspaceAccentColor } from './WorkspaceSummaryHeader';

export const REVEAL_LABEL = getShowInFileBrowserLabel();

export function projectInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '??';
  const words = trimmed.split(/[-_\s]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/** 'vertical' is the left-docked rail's own layout; 'horizontal' is the top-docked bar's. */
export type ProjectRailOrientation = 'vertical' | 'horizontal';

export interface ProjectRailIconProps {
  project: OpenProject;
  isActive: boolean;
  processingCount: number;
  unreadCount: number;
  orientation: ProjectRailOrientation;
  onActivate: (path: string) => void;
  onClose: (project: OpenProject) => void;
  onContextMenu: (project: OpenProject, x: number, y: number) => void;
}

export function ProjectRailIcon({
  project,
  isActive,
  processingCount,
  unreadCount,
  orientation,
  onActivate,
  onClose,
  onContextMenu,
}: ProjectRailIconProps) {
  // Hover tooltip via floating-ui. Renders through FloatingPortal so the
  // tooltip escapes the rail container's `overflow: hidden` clip — the
  // earlier CSS-only `:hover > .project-rail-tooltip` approach was clipped
  // and never visible. Matches CLAUDE.md's floating-ui rule.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const { refs: tooltipRefs, floatingStyles: tooltipFloatingStyles, context: tooltipContext } = useFloating({
    open: tooltipOpen,
    onOpenChange: setTooltipOpen,
    // R7: horizontal (top-docked) tooltips open below, not beside.
    placement: orientation === 'horizontal' ? 'bottom' : 'right',
    middleware: [offset(12), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });
  const tooltipHover = useHover(tooltipContext, { delay: { open: 200, close: 0 }, move: false });
  const { getReferenceProps: getTooltipRefProps, getFloatingProps: getTooltipFloatingProps } =
    useInteractions([tooltipHover]);

  const handleClick = useCallback(() => {
    onActivate(project.path);
  }, [onActivate, project.path]);

  const handleClose = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClose(project);
    },
    [onClose, project]
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      onContextMenu(project, event.clientX, event.clientY);
    },
    [onContextMenu, project]
  );

  const orientationClass = orientation === 'horizontal' ? ' is-horizontal' : '';
  const className = `project-rail-item${isActive ? ' is-active' : ''}${orientationClass}`;

  // Per-project accent color, derived deterministically from the workspace
  // path so the rail icon matches the colored bar shown in the workspace
  // summary header (and in SessionHistory entries) for the same project.
  const accentColor = useMemo(() => generateWorkspaceAccentColor(project.path), [project.path]);

  // Inactive projects show a badge when something needs attention. Active
  // projects already have the user's eyes on them so we suppress the
  // badge to keep the rail quiet.
  const showBadge = !isActive && (processingCount > 0 || unreadCount > 0);
  const badgeLabel = processingCount > 0 ? `${processingCount}` : unreadCount > 0 ? `${unreadCount}` : '';

  // Wrapper is a non-interactive container so the activate button and the
  // close button can sit as siblings. Nesting a button inside a button is
  // invalid HTML and confuses screen readers / keyboard navigation.
  return (
    <div
      ref={tooltipRefs.setReference}
      className={className}
      onContextMenu={handleContextMenu}
      data-testid="project-rail-item"
      data-project-path={project.path}
      style={{ ['--rail-item-accent' as any]: accentColor }}
      {...getTooltipRefProps()}
    >
      <button
        type="button"
        className="project-rail-item-main"
        onClick={handleClick}
        aria-label={`Switch to project ${project.name}`}
        aria-current={isActive ? 'true' : undefined}
      >
        {projectInitials(project.name)}
        {showBadge && (
          <span
            className="project-rail-item-badge"
            aria-label={processingCount > 0 ? `${processingCount} streaming session(s)` : `${unreadCount} unread`}
          >
            {badgeLabel}
          </span>
        )}
      </button>
      <button
        type="button"
        className="project-rail-item-close"
        onClick={handleClose}
        aria-label={`Close ${project.name}`}
      >
        ×
      </button>
      {tooltipOpen && (
        <FloatingPortal>
          <div
            ref={tooltipRefs.setFloating}
            className="project-rail-tooltip"
            style={tooltipFloatingStyles}
            {...getTooltipFloatingProps()}
          >
            <span className="project-rail-tooltip-name">{project.name}</span>
            <span className="project-rail-tooltip-path">{project.path}</span>
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}

export interface ProjectRailController {
  // --- Data (read-only) ---
  openProjects: OpenProject[];
  activePath: string | null;
  atCap: boolean;

  // --- Per-icon activity lookup ---
  getActivity: (path: string) => { processingCount: number; unreadCount: number };

  // --- Project switching ---
  activate: (path: string) => void;

  // --- Close (async: confirms streaming sessions, unregisters, may close window) ---
  close: (project: OpenProject) => Promise<void>;

  // --- Add-project flow ---
  addMenuOpen: boolean;
  openAddMenu: () => void;
  closeAddMenu: () => void;
  recentProjects: Array<{ path: string; name: string; timestamp?: number }>;
  filteredRecents: Array<{ path: string; name: string; timestamp?: number }>;
  pickFolder: () => Promise<void>;
  addProjectByPath: (workspacePath: string) => Promise<void>;

  // --- Context menu (business-logic half only — x/y positioning state
  //     stays with the consumer, which owns its own floating-ui instance) ---
  contextMenuProject: OpenProject | null;
  openContextMenu: (project: OpenProject) => void;
  closeContextMenu: () => void;
  openInNewWindow: (project: OpenProject) => Promise<void>;
  revealInFinder: (project: OpenProject) => Promise<void>;
}

export function useProjectRailController(): ProjectRailController {
  const openProjects = useAtomValue(openProjectsAtom);
  const [activePath, setActivePath] = useAtom(activeWorkspacePathAtom);
  const atCap = useAtomValue(isOpenProjectsAtCapAtom);
  const addProject = useSetAtom(addOpenProjectAtom);
  const closeProject = useSetAtom(closeOpenProjectAtom);
  const activity = useAtomValue(globalSessionActivityAtom);
  const activitySummary = useAtomValue(projectActivitySummaryAtom);

  const getActivity = useCallback(
    (path: string) => {
      const a = activitySummary.get(path);
      return { processingCount: a?.processing ?? 0, unreadCount: a?.unread ?? 0 };
    },
    [activitySummary]
  );

  const activate = useCallback(
    (path: string) => {
      if (path === activePath) return;
      // The atom subscriber in initOpenProjects() forwards the change to
      // the main process via `workspace:set-active`, so there is no direct
      // IPC call here.
      setActivePath(path);
    },
    [activePath, setActivePath]
  );

  const addProjectByPath = useCallback(
    async (workspacePath: string) => {
      if (!window.electronAPI?.invoke) return;
      try {
        const reg = await window.electronAPI.invoke('workspace:register-additional', { workspacePath });
        if (!reg?.success) {
          console.error('[ProjectRailIcon] register-additional failed:', reg?.error);
          return;
        }

        const project: OpenProject = {
          path: workspacePath,
          name: workspacePath.split(/[\\/]/).filter(Boolean).pop() || workspacePath,
          openedAt: Date.now(),
        };
        // `addOpenProjectAtom` flips `activeWorkspacePathAtom` to this path;
        // the atom subscriber dispatches `workspace:set-active` to main.
        addProject(project);
      } catch (err) {
        console.error('[ProjectRailIcon] addProjectByPath failed:', err);
      }
    },
    [addProject]
  );

  const pickFolder = useCallback(async () => {
    if (!window.electronAPI?.invoke) return;
    try {
      const result = await window.electronAPI.invoke('dialog-show-open-dialog', {
        properties: ['openDirectory'],
        title: 'Open Project',
      });
      if (result?.canceled) return;
      const picked: string | undefined = result?.filePaths?.[0];
      if (!picked) return;
      await addProjectByPath(picked);
    } catch (err) {
      console.error('[ProjectRailIcon] pickFolder failed:', err);
    }
  }, [addProjectByPath]);

  const [recentProjects, setRecentProjects] = useState<Array<{ path: string; name: string; timestamp?: number }>>([]);

  const refreshRecents = useCallback(async () => {
    if (!window.electronAPI?.invoke) return;
    try {
      const items = (await window.electronAPI.invoke('settings:get-recent-projects')) as Array<{
        path: string;
        name: string;
        timestamp?: number;
      }>;
      setRecentProjects(Array.isArray(items) ? items : []);
    } catch (err) {
      console.error('[ProjectRailIcon] failed to load recents:', err);
    }
  }, []);

  const [addMenuOpen, setAddMenuOpen] = useState(false);

  const openAddMenu = useCallback(() => {
    if (atCap) {
      window.alert('You can have at most 8 projects open in the rail. Close one first or open in a new window.');
      return;
    }
    refreshRecents();
    setAddMenuOpen(true);
  }, [atCap, refreshRecents]);

  const closeAddMenu = useCallback(() => setAddMenuOpen(false), []);

  const openProjectPaths = useMemo(() => new Set(openProjects.map((p) => p.path)), [openProjects]);
  const filteredRecents = useMemo(
    () => recentProjects.filter((r) => !openProjectPaths.has(r.path)).slice(0, 8),
    [recentProjects, openProjectPaths]
  );

  const close = useCallback(
    async (project: OpenProject) => {
      // Warn if there are streaming sessions for this project. Read from the
      // cross-workspace activity tracker (kept in sync by sessionStateListeners
      // for every warm rail project) instead of `sessionRegistryAtom`, which
      // only carries the active project's sessions and would silently skip
      // the prompt when closing an inactive rail project.
      const streaming = activity.get(project.path)?.streaming.size ?? 0;
      if (streaming > 0) {
        const proceed = window.confirm(
          `${project.name} has ${streaming} streaming session${streaming === 1 ? '' : 's'}. Close anyway? Sessions will be paused.`
        );
        if (!proceed) return;
      }

      const wasLast = openProjects.length <= 1;

      closeProject(project.path);

      try {
        await window.electronAPI?.invoke?.('workspace:unregister-additional', { workspacePath: project.path });
      } catch (err) {
        console.error('[ProjectRailIcon] unregister-additional failed:', err);
      }

      // Closing the last project leaves nothing to render in this window.
      // Ask the host to close the window so the app can fall back to its
      // initial project-selection flow.
      if (wasLast) {
        try {
          await window.electronAPI?.invoke?.('workspace:close-rail-window');
        } catch (err) {
          console.error('[ProjectRailIcon] close-rail-window failed:', err);
        }
      }
    },
    [closeProject, activity, openProjects.length]
  );

  const [contextMenuProject, setContextMenuProject] = useState<OpenProject | null>(null);
  const openContextMenu = useCallback((project: OpenProject) => setContextMenuProject(project), []);
  const closeContextMenu = useCallback(() => setContextMenuProject(null), []);

  const openInNewWindow = useCallback(
    async (project: OpenProject) => {
      closeContextMenu();
      try {
        await window.electronAPI?.invoke?.('workspace-manager:open-workspace', project.path);
      } catch (err) {
        console.error('[ProjectRailIcon] open-workspace failed:', err);
      }
    },
    [closeContextMenu]
  );

  const revealInFinder = useCallback(
    async (project: OpenProject) => {
      closeContextMenu();
      try {
        await window.electronAPI?.invoke?.('show-in-finder', project.path);
      } catch (err) {
        console.error('[ProjectRailIcon] show-in-finder failed:', err);
      }
    },
    [closeContextMenu]
  );

  return {
    openProjects,
    activePath,
    atCap,
    getActivity,
    activate,
    close,
    addMenuOpen,
    openAddMenu,
    closeAddMenu,
    recentProjects,
    filteredRecents,
    pickFolder,
    addProjectByPath,
    contextMenuProject,
    openContextMenu,
    closeContextMenu,
    openInNewWindow,
    revealInFinder,
  };
}

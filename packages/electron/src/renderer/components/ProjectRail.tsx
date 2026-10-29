/**
 * ProjectRail
 *
 * Discord-style vertical rail of warm projects. Click an icon to switch
 * the visible project; the inactive projects' state is kept warm via
 * per-workspace atom families and main-process service refcounting.
 *
 * Hidden when multi-project mode is off (the legacy single-window flow
 * stays as a fallback).
 *
 * Per-icon rendering and add/close/capacity business logic live in
 * `ProjectRailIcon.tsx` (`ProjectRailIcon`, `useProjectRailController()`),
 * shared with the top-docked `WindowTopBar` merge. This file keeps the
 * `<nav>` shell and every floating-ui instance whose placement is specific
 * to the vertical layout (add menu, add-button tooltip, context menu).
 */

import React, { useCallback, useState } from 'react';
import {
  useFloating,
  autoUpdate,
  FloatingPortal,
  FloatingFocusManager,
  useDismiss,
  useHover,
  useInteractions,
  useRole,
  offset,
  flip,
  shift,
  size,
  type VirtualElement,
} from '@floating-ui/react';
import { clearWindowControls, getWindowControlsZones, windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { useAtomValue, useSetAtom } from 'jotai';
import { OrgSwitcher } from './OrgSwitcher';
import {
  multiProjectModeAtom,
  moveOpenProjectAtom,
  sortOpenProjectsAtom,
  type OpenProject,
} from '../store/atoms/openProjects';
import { openSettingsCommandAtom } from '../store/atoms/settingsNavigation';
import { useProjectRailDrag } from './hooks/useProjectRailDrag';
import { ProjectRailIcon, useProjectRailController, REVEAL_LABEL } from './ProjectRailIcon';
import './ProjectRail.css';

export function ProjectRail() {
  const openSettings = useSetAtom(openSettingsCommandAtom);
  const isMultiProjectMode = useAtomValue(multiProjectModeAtom);
  const controller = useProjectRailController();
  const { openProjects, activePath } = controller;
  const moveProject = useSetAtom(moveOpenProjectAtom);
  const sortProjects = useSetAtom(sortOpenProjectsAtom);
  const projectListRef = React.useRef<HTMLDivElement | null>(null);
  const drag = useProjectRailDrag(projectListRef, moveProject);

  React.useLayoutEffect(() => {
    const list = projectListRef.current;
    if (!isMultiProjectMode || !list) return;

    const revealActiveProject = () => {
      const active = list.querySelector<HTMLElement>('.project-rail-item.is-active');
      if (!active) return;
      const viewport = list.getBoundingClientRect();
      const item = active.getBoundingClientRect();
      // Include the close button's overhang. Scroll only the project list,
      // leaving the rest of the window and keyboard focus untouched.
      const above = item.top - viewport.top - 4;
      const below = item.bottom - viewport.bottom + 4;
      if (above < 0) list.scrollTop += above;
      else if (below > 0) list.scrollTop += below;
    };

    revealActiveProject();
    const observer = new ResizeObserver(revealActiveProject);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activePath, openProjects.length, isMultiProjectMode]);

  // Right-click context menu state. Anchored to a virtual reference at the
  // cursor position so it works for any rail icon without per-icon refs.
  // The `{x, y}` positioning half stays local to this consumer; the
  // "which project" half lives in the shared controller.
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const { closeContextMenu } = controller;
  const closeMenu = useCallback(() => {
    closeContextMenu();
    setMenuPosition(null);
  }, [closeContextMenu]);
  const menuIndex = openProjects.findIndex(project => project.path === controller.contextMenuProject?.path);
  const moveMenuProject = (direction: -1 | 1) => {
    if (menuIndex < 0) return;
    const beforePath = direction === -1 ? openProjects[menuIndex - 1]?.path : openProjects[menuIndex + 2]?.path;
    moveProject({ path: openProjects[menuIndex].path, beforePath: beforePath ?? null });
    closeMenu();
  };

  // "Add project" dropdown — opens recents + folder picker action when the
  // user clicks the `+` button.
  const addButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const {
    refs: addRefs,
    floatingStyles: addFloatingStyles,
    context: addContext,
  } = useFloating({
    open: controller.addMenuOpen,
    onOpenChange: (open) => (open ? controller.openAddMenu() : controller.closeAddMenu()),
    // The Add button stays at the bottom of the rail. Align the menu's
    // bottom with it, and track size changes as recent folders load.
    placement: 'right-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
      size({
        padding: 8,
        apply({ availableHeight, elements, x, rects }) {
          // Reserve the controls band from the viewport's padded top, not
          // from the menu's current y: bottom alignment makes y depend on
          // height, so subtracting the last push can cause a resize loop.
          const reserved = clearWindowControls(x, 8, rects.floating.width, getWindowControlsZones()) - 8;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight - reserved)}px`;
          elements.floating.style.overflowY = 'auto';
        },
      }),
    ],
  });
  const addDismiss = useDismiss(addContext);
  const addRole = useRole(addContext, { role: 'menu' });
  const { getFloatingProps: getAddFloatingProps } = useInteractions([addDismiss, addRole]);

  // Hover tooltip for the add button. Separate floating-ui instance from
  // the click-driven add menu above; both share `addButtonRef` as the
  // anchor element.
  const [addTooltipOpen, setAddTooltipOpen] = useState(false);
  const {
    refs: addTooltipRefs,
    floatingStyles: addTooltipFloatingStyles,
    context: addTooltipContext,
  } = useFloating({
    open: addTooltipOpen,
    onOpenChange: setAddTooltipOpen,
    placement: 'right',
    middleware: [offset(12), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });
  const addTooltipHover = useHover(addTooltipContext, { delay: { open: 200, close: 0 }, move: false });
  const { getReferenceProps: getAddTooltipRefProps, getFloatingProps: getAddTooltipFloatingProps } =
    useInteractions([addTooltipHover]);

  React.useEffect(() => {
    if (addButtonRef.current) {
      addRefs.setReference(addButtonRef.current);
      addTooltipRefs.setReference(addButtonRef.current);
    }
  }, [addRefs, addTooltipRefs]);

  const { refs, floatingStyles, context } = useFloating({
    open: controller.contextMenuProject !== null,
    onOpenChange: (open) => {
      if (!open) {
        controller.closeContextMenu();
        setMenuPosition(null);
      }
    },
    placement: 'right-start',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), windowControlsClearance()],
  });

  // Use a virtual reference at the cursor position. setPositionReference
  // accepts a VirtualElement which is the documented escape hatch.
  React.useEffect(() => {
    if (!menuPosition) {
      refs.setPositionReference(null);
      return;
    }
    const virtual: VirtualElement = {
      getBoundingClientRect: () => DOMRect.fromRect({ x: menuPosition.x, y: menuPosition.y, width: 0, height: 0 }),
    };
    refs.setPositionReference(virtual);
  }, [menuPosition, refs]);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'menu' });
  const { getFloatingProps } = useInteractions([dismiss, role]);

  const handleContextMenu = useCallback(
    (project: OpenProject, x: number, y: number) => {
      setMenuPosition({ x, y });
      controller.openContextMenu(project);
    },
    [controller]
  );

  if (!isMultiProjectMode) return null;

  const contextMenuProject = controller.contextMenuProject;

  return (
    <nav className="project-rail" data-testid="project-rail" aria-label="Open projects">
      {/* Epic H1: org switcher sits above the project switcher. */}
      <OrgSwitcher />
      <div ref={projectListRef} className="project-rail-projects" data-testid="project-rail-projects" {...drag.listProps}>
        {openProjects.map((project) => {
          const activity = controller.getActivity(project.path);
          return (
            <ProjectRailIcon
              key={project.path}
              project={project}
              isActive={project.path === activePath}
              processingCount={activity.processingCount}
              unreadCount={activity.unreadCount}
              orientation="vertical"
              onActivate={controller.activate}
              onClose={controller.close}
              onContextMenu={handleContextMenu}
              isDragging={drag.draggedPath === project.path}
              menuOpen={controller.contextMenuProject !== null}
              dropPosition={drag.beforePath === project.path ? 'before' : drag.beforePath === null && project === openProjects.at(-1) ? 'after' : undefined}
              onDragStart={(event, path) => { closeMenu(); drag.onDragStart(event, path); }}
              onDragEnd={drag.onDragEnd}
            />
          );
        })}
      </div>
      {openProjects.length > 0 && <div className="project-rail-divider" aria-hidden="true" />}
      <button
        ref={addButtonRef}
        type="button"
        className="project-rail-add"
        onClick={controller.openAddMenu}
        disabled={controller.atCap}
        data-testid="project-rail-add"
        aria-label="Add project to rail"
        {...getAddTooltipRefProps()}
      >
        +
      </button>
      {addTooltipOpen && (
        <FloatingPortal>
          <div
            ref={addTooltipRefs.setFloating}
            className="project-rail-tooltip"
            style={addTooltipFloatingStyles}
            {...getAddTooltipFloatingProps()}
          >
            {controller.atCap ? 'Eight-project limit reached. Enable Allow unlimited projects in Settings > Advanced.' : 'Add project'}
          </div>
        </FloatingPortal>
      )}

      {controller.addMenuOpen && (
        <FloatingPortal>
          <div
            ref={addRefs.setFloating}
            className="project-rail-context-menu project-rail-add-menu"
            style={addFloatingStyles}
            data-testid="project-rail-add-menu"
            {...getAddFloatingProps()}
          >
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => {
                controller.closeAddMenu();
                controller.pickFolder();
              }}
            >
              Open folder…
            </button>
            {controller.filteredRecents.length > 0 && (
              <>
                <div className="project-rail-context-menu-divider" />
                <div className="project-rail-context-menu-heading">Recent projects</div>
                {controller.filteredRecents.map((recent) => (
                  <button
                    key={recent.path}
                    type="button"
                    className="project-rail-context-menu-item project-rail-context-menu-item-recent"
                    onClick={() => {
                      controller.closeAddMenu();
                      controller.addProjectByPath(recent.path);
                    }}
                    title={recent.path}
                  >
                    <span className="project-rail-context-menu-item-name">{recent.name || recent.path}</span>
                    <span className="project-rail-context-menu-item-path">{recent.path}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </FloatingPortal>
      )}

      {contextMenuProject && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
          <div
            ref={refs.setFloating}
            className="project-rail-context-menu"
            style={floatingStyles}
            data-testid="project-rail-context-menu"
            {...getFloatingProps({
              onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                event.stopPropagation();
                const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
                const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
                  : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
              },
            })}
          >
            <button type="button" role="menuitem" className="project-rail-context-menu-item"
              disabled={menuIndex <= 0} onClick={() => moveMenuProject(-1)}>
              Move up
            </button>
            <button type="button" role="menuitem" className="project-rail-context-menu-item"
              disabled={menuIndex < 0 || menuIndex === openProjects.length - 1} onClick={() => moveMenuProject(1)}>
              Move down
            </button>
            <button type="button" role="menuitem" className="project-rail-context-menu-item"
              disabled={openProjects.length < 2} onClick={() => { sortProjects(); closeMenu(); }}>
              Sort by name
            </button>
            <div className="project-rail-context-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="project-rail-context-menu-item"
              onClick={() => {
                openSettings({ category: 'project-appearance', scope: 'project', timestamp: Date.now(),
                  destination: { scope: 'project', category: 'project-appearance', target: { kind: 'workspace', workspacePath: contextMenuProject.path } } });
                closeMenu();
              }}
            >
              Customize appearance…
            </button>
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => controller.openInNewWindow(contextMenuProject)}
            >
              Open in new window
            </button>
            <button
              type="button"
              role="menuitem"
              className="project-rail-context-menu-item"
              onClick={() => controller.revealInFinder(contextMenuProject)}
            >
              {REVEAL_LABEL}
            </button>
            <div className="project-rail-context-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="project-rail-context-menu-item"
              onClick={() => {
                controller.closeContextMenu();
                setMenuPosition(null);
                controller.close(contextMenuProject);
              }}
            >
              Close project
            </button>
          </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </nav>
  );
}

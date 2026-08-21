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
  FloatingPortal,
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
import { windowControlsClearance } from '@nimbalyst/runtime/ui/floating/windowControlsClearance';
import { useAtomValue } from 'jotai';
import { OrgSwitcher } from './OrgSwitcher';
import { multiProjectModeAtom, type OpenProject } from '../store/atoms/openProjects';
import { ProjectRailIcon, useProjectRailController, REVEAL_LABEL } from './ProjectRailIcon';
import './ProjectRail.css';

export function ProjectRail() {
  const isMultiProjectMode = useAtomValue(multiProjectModeAtom);
  const controller = useProjectRailController();

  // Right-click context menu state. Anchored to a virtual reference at the
  // cursor position so it works for any rail icon without per-icon refs.
  // The `{x, y}` positioning half stays local to this consumer; the
  // "which project" half lives in the shared controller.
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);

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
    // `right-start` grows the menu downward from the top of the `+` button.
    // The old `right-end` grew it upward, so with two or more recents it was
    // taller than the space above the button and `shift()` clamped it to the
    // top of the window — beside the traffic lights and ~140px away from the
    // button that opened it, which read as "the + did nothing" (GitHub #1096).
    placement: 'right-start',
    middleware: [
      offset(8),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      windowControlsClearance(),
      size({
        padding: 8,
        apply({ availableHeight, elements, middlewareData }) {
          const pushed = middlewareData.windowControlsClearance?.pushed ?? 0;
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight - pushed)}px`;
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
      {controller.openProjects.map((project) => {
        const activity = controller.getActivity(project.path);
        return (
          <ProjectRailIcon
            key={project.path}
            project={project}
            isActive={project.path === controller.activePath}
            processingCount={activity.processingCount}
            unreadCount={activity.unreadCount}
            orientation="vertical"
            onActivate={controller.activate}
            onClose={controller.close}
            onContextMenu={handleContextMenu}
          />
        );
      })}
      {controller.openProjects.length > 0 && <div className="project-rail-divider" aria-hidden="true" />}
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
            {controller.atCap ? 'Rail full (8 projects max)' : 'Add project'}
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
          <div
            ref={refs.setFloating}
            className="project-rail-context-menu"
            style={floatingStyles}
            data-testid="project-rail-context-menu"
            {...getFloatingProps()}
          >
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => controller.openInNewWindow(contextMenuProject)}
            >
              Open in new window
            </button>
            <button
              type="button"
              className="project-rail-context-menu-item"
              onClick={() => controller.revealInFinder(contextMenuProject)}
            >
              {REVEAL_LABEL}
            </button>
            <div className="project-rail-context-menu-divider" />
            <button
              type="button"
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
        </FloatingPortal>
      )}
    </nav>
  );
}

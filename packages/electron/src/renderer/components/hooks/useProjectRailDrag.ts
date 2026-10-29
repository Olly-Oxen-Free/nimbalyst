import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from 'react';

const PROJECT_DRAG_TYPE = 'application/x-nimbalyst-rail-project';

/**
 * Native drag with an insertion marker and frame-based scrolling at list edges.
 * `axis` is the list's main axis: 'y' for the left rail, 'x' for the top bar.
 */
export function useProjectRailDrag(
  listRef: RefObject<HTMLDivElement | null>,
  move: (input: { path: string; beforePath: string | null }) => void,
  axis: 'x' | 'y' = 'y',
) {
  const start = axis === 'x' ? 'left' : 'top';
  const end = axis === 'x' ? 'right' : 'bottom';
  const extent = axis === 'x' ? 'width' : 'height';
  const pointer = (event: DragEvent) => (axis === 'x' ? event.clientX : event.clientY);
  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const [beforePath, setBeforePath] = useState<string | null | undefined>();
  const drag = useRef<{ path: string; pos: number; inside: boolean } | null>(null);
  const frame = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    drag.current = null;
    setDraggedPath(null);
    setBeforePath(undefined);
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
  }, []);

  const targetAt = useCallback((pos: number) => {
    const items = listRef.current?.querySelectorAll<HTMLElement>('.project-rail-item');
    for (const item of items ?? []) {
      if (item.dataset.projectPath === drag.current?.path) continue;
      const rect = item.getBoundingClientRect();
      if (pos < rect[start] + rect[extent] / 2) return item.dataset.projectPath!;
    }
    return null;
  }, [listRef, start, extent]);

  const tick = useCallback(() => {
    const list = listRef.current;
    const current = drag.current;
    if (!list || !current?.inside) { frame.current = null; return; }
    const rect = list.getBoundingClientRect();
    const edge = Math.min(32, rect[extent] / 4);
    const speed = current.pos < rect[start] + edge
      ? -Math.min(10, (rect[start] + edge - current.pos) / 3)
      : current.pos > rect[end] - edge
        ? Math.min(10, (current.pos - rect[end] + edge) / 3)
        : 0;
    if (speed) {
      if (axis === 'x') list.scrollLeft += speed;
      else list.scrollTop += speed;
      setBeforePath(targetAt(current.pos));
    }
    frame.current = requestAnimationFrame(tick);
  }, [listRef, targetAt, axis, start, end, extent]);

  const onDragStart = useCallback((event: DragEvent, path: string) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PROJECT_DRAG_TYPE, path);
    drag.current = { path, pos: pointer(event), inside: false };
    setDraggedPath(path);
  }, [axis]);

  const onDragOver = useCallback((event: DragEvent) => {
    if (!drag.current) return; // Files and drags from other windows are not rail moves.
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    drag.current.pos = pointer(event);
    drag.current.inside = true;
    setBeforePath(targetAt(pointer(event)));
    if (frame.current === null) frame.current = requestAnimationFrame(tick);
  }, [targetAt, tick, axis]);

  const onDragLeave = useCallback((event: DragEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    // Native drags can report a null relatedTarget between children.
    if (event.clientX >= bounds.left && event.clientX < bounds.right
      && event.clientY >= bounds.top && event.clientY < bounds.bottom) return;
    if (drag.current) drag.current.inside = false;
    setBeforePath(undefined);
  }, []);

  const onDrop = useCallback((event: DragEvent) => {
    if (!drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    move({ path: drag.current.path, beforePath: targetAt(pointer(event)) });
    clear();
  }, [move, targetAt, clear, axis]);

  return { draggedPath, beforePath, onDragStart, onDragEnd: clear, listProps: { onDragOver, onDragLeave, onDrop } };
}

import { backend } from '../../ipc/client';
import type { ResizeDirection } from '../../ipc/types';
import { useIsMaximized } from './useWindowState';

const EDGES: { dir: ResizeDirection; className: string }[] = [
  { dir: 'North', className: 'n' },
  { dir: 'South', className: 's' },
  { dir: 'East', className: 'e' },
  { dir: 'West', className: 'w' },
  { dir: 'NorthEast', className: 'ne' },
  { dir: 'NorthWest', className: 'nw' },
  { dir: 'SouthEast', className: 'se' },
  { dir: 'SouthWest', className: 'sw' },
];

/**
 * Invisible edges for resizing an undecorated window. Windows hit-tests these natively; Linux
 * window managers do not, so the handles start a resize drag explicitly.
 */
export function ResizeHandles() {
  const maximized = useIsMaximized();
  if (maximized) return null;
  return (
    <div className="resize-handles" aria-hidden>
      {EDGES.map(({ dir, className }) => (
        <div
          key={dir}
          className={`resize-handle resize-${className}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            void backend.window.startResizeDragging(dir);
          }}
        />
      ))}
    </div>
  );
}

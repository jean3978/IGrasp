import { clsx } from 'clsx';
import { Check, Copy, Expand, Maximize, Minimize2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import type { ReactZoomPanPinchRef } from 'react-zoom-pan-pinch';
import { IconButton } from '../../components/ui/IconButton';

interface MermaidViewerProps {
  svg: string;
  source: string;
  fullscreen: boolean;
  /** Opens (inline) or closes (full screen) the full-screen view. */
  onToggleFullscreen: () => void;
  rootRef?: Ref<HTMLDivElement>;
}

const ZOOM_STEP = 0.3;
const PADDING = 16;
const MAX_INLINE_HEIGHT = 640;

export function MermaidViewer({
  svg,
  source,
  fullscreen,
  onToggleFullscreen,
  rootRef,
}: MermaidViewerProps) {
  const ref = useRef<ReactZoomPanPinchRef>(null);
  const svgHost = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [inlineHeight, setInlineHeight] = useState<number | null>(null);

  // Mermaid sizes its SVG as width="100%", which collapses inside the zoomable content. Give it
  // its natural size, then (inline) fit it to the column width without enlarging it.
  useLayoutEffect(() => {
    const el = svgHost.current?.querySelector('svg');
    const box = el?.viewBox.baseVal;
    if (!el || !box || box.width === 0) return;
    el.style.width = `${String(box.width)}px`;
    el.style.height = `${String(box.height)}px`;
    if (fullscreen) return;
    const available =
      (svgHost.current?.closest('.mermaid-viewer')?.clientWidth ?? box.width) - 2 * PADDING;
    const scale = Math.min(1, available / box.width);
    const height = Math.min(MAX_INLINE_HEIGHT, box.height * scale + 2 * PADDING);
    setInlineHeight(height);
    const x = (available - box.width * scale) / 2;
    void ref.current?.setTransform(x, 0, scale, 0);
  }, [svg, fullscreen]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(t);
    };
  }, [copied]);

  const zoomIn = () => void ref.current?.zoomIn(ZOOM_STEP);
  const zoomOut = () => void ref.current?.zoomOut(ZOOM_STEP);
  const reset = () => void ref.current?.resetTransform();
  const fit = () => void ref.current?.fitToView({ mode: 'contain', maxScale: fullscreen ? 4 : 1 });
  const copy = () => {
    navigator.clipboard
      .writeText(source)
      .then(() => {
        setCopied(true);
      })
      .catch((err: unknown) => {
        console.error('Cannot copy the diagram source', err);
      });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target !== e.currentTarget) return;
    const handlers: Record<string, () => void> = {
      '+': zoomIn,
      '=': zoomIn,
      '-': zoomOut,
      '0': reset,
      f: fit,
      F: fit,
      Enter: onToggleFullscreen,
    };
    const handler = handlers[e.key];
    if (handler) {
      e.preventDefault();
      handler();
    }
  };

  return (
    <div
      ref={rootRef}
      className={clsx('mermaid-viewer', { 'mermaid-viewer-fullscreen': fullscreen })}
      style={inlineHeight === null ? undefined : { height: inlineHeight }}
      role="figure"
      aria-label="Mermaid diagram. Plus and minus zoom, 0 resets, F fits, Enter toggles full screen."
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="mermaid-toolbar" role="toolbar" aria-label="Diagram tools">
        <IconButton label="Zoom in" shortcut="+" onClick={zoomIn}>
          <ZoomIn aria-hidden />
        </IconButton>
        <IconButton label="Zoom out" shortcut="-" onClick={zoomOut}>
          <ZoomOut aria-hidden />
        </IconButton>
        <IconButton label="Fit to view" shortcut="F" onClick={fit}>
          <Maximize aria-hidden />
        </IconButton>
        <IconButton label="Reset view" shortcut="0" onClick={reset}>
          <RotateCcw aria-hidden />
        </IconButton>
        <IconButton label={copied ? 'Copied' : 'Copy source'} onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </IconButton>
        <IconButton
          label={fullscreen ? 'Exit full screen' : 'Full screen'}
          shortcut={fullscreen ? 'Esc' : 'Enter'}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 aria-hidden /> : <Expand aria-hidden />}
        </IconButton>
      </div>
      <TransformWrapper
        ref={ref}
        minScale={0.1}
        maxScale={8}
        limitToBounds={false}
        {...(fullscreen ? { fitOnInit: 'contain' as const, centerOnInit: true } : {})}
        // Inline, the wheel scrolls the document; Ctrl+wheel zooms the diagram.
        wheel={{ step: 0.1, ...(fullscreen ? {} : { activationKeys: ['Control'] }) }}
        doubleClick={{ disabled: true }}
      >
        <TransformComponent wrapperClass="mermaid-canvas" contentClass="mermaid-content">
          <div ref={svgHost} className="mermaid-svg" dangerouslySetInnerHTML={{ __html: svg }} />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

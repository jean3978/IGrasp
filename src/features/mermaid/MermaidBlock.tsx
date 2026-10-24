import { Dialog } from 'radix-ui';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { selectEffectiveTheme, useSettings } from '../../stores/settings';
import type { EffectiveTheme } from '../../stores/settings';
import { cachedMermaid, renderMermaid } from './mermaidRuntime';
import type { MermaidResult } from './mermaidRuntime';
import { MermaidViewer } from './MermaidViewer';
import './mermaid.css';

function useMermaid(source: string, theme: EffectiveTheme): MermaidResult | undefined {
  const [state, setState] = useState<{ key: string; result: MermaidResult } | null>(null);
  const key = `${theme}:${source}`;
  const cached = cachedMermaid(source, theme);

  useEffect(() => {
    if (cachedMermaid(source, theme)) return;
    let cancelled = false;
    void renderMermaid(source, theme).then((result) => {
      if (!cancelled) setState({ key: `${theme}:${source}`, result });
    });
    return () => {
      cancelled = true;
    };
  }, [source, theme]);

  return cached ?? (state?.key === key ? state.result : undefined);
}

/** A ```mermaid block: rendered diagram with zoom, pan, fit and full screen. */
export function MermaidBlock({ source }: { source: string }) {
  const theme = useSettings(selectEffectiveTheme);
  const result = useMermaid(source, theme);
  const [fullscreen, setFullscreen] = useState(false);
  const inlineRef = useRef<HTMLDivElement>(null);

  if (!result) {
    return (
      <div className="mermaid-loading" role="status">
        Rendering diagram…
      </div>
    );
  }
  if (result.kind === 'error') {
    return (
      <div className="mermaid-error" role="group" aria-label="Mermaid diagram error">
        <p className="mermaid-error-title">
          <TriangleAlert aria-hidden />
          This Mermaid diagram has an error
        </p>
        <pre className="mermaid-error-message">{result.message}</pre>
        <details>
          <summary>Diagram source</summary>
          <pre>{source}</pre>
        </details>
      </div>
    );
  }

  return (
    <>
      <MermaidViewer
        svg={result.svg}
        source={source}
        fullscreen={false}
        rootRef={inlineRef}
        onToggleFullscreen={() => {
          setFullscreen(true);
        }}
      />
      <Dialog.Root open={fullscreen} onOpenChange={setFullscreen}>
        <Dialog.Portal>
          <Dialog.Overlay className="mermaid-fullscreen-overlay" />
          <Dialog.Content
            className="mermaid-fullscreen"
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => {
              // Opened from the keyboard or a toolbar button, not a Dialog.Trigger: return
              // focus to the inline diagram explicitly.
              e.preventDefault();
              inlineRef.current?.focus();
            }}
          >
            <Dialog.Title className="visually-hidden">Mermaid diagram</Dialog.Title>
            <MermaidViewer
              svg={result.svg}
              source={source}
              fullscreen
              onToggleFullscreen={() => {
                setFullscreen(false);
              }}
            />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

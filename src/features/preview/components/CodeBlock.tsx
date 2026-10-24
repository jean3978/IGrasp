import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';
import { MermaidBlock } from '../../mermaid/MermaidBlock';

type PreProps = ComponentProps<'pre'> & { 'data-language'?: string; 'data-mermaid'?: string };

/** A code block with a language badge and a copy button; Mermaid blocks become diagrams. */
export function CodeBlock({ 'data-mermaid': mermaid, ...props }: PreProps) {
  if (mermaid !== undefined) return <MermaidBlock source={mermaid} />;
  return <HighlightedCode {...props} />;
}

function HighlightedCode({ 'data-language': language, children, ...rest }: PreProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => {
      window.clearTimeout(t);
    };
  }, [copied]);

  const copy = () => {
    const text = preRef.current?.textContent ?? '';
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
      })
      .catch((err: unknown) => {
        console.error('Cannot copy the code', err);
      });
  };

  return (
    <div className="code-block">
      <div className="code-block-tools">
        {language && <span className="code-block-lang">{language}</span>}
        <button
          type="button"
          className="code-block-copy"
          aria-label={copied ? 'Copied' : 'Copy code'}
          title={copied ? 'Copied' : 'Copy code'}
          onClick={copy}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </button>
      </div>
      <pre ref={preRef} tabIndex={0} data-language={language} {...rest}>
        {children}
      </pre>
    </div>
  );
}

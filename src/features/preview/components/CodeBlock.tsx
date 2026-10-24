import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ComponentProps } from 'react';

type PreProps = ComponentProps<'pre'> & { 'data-language'?: string };

/** A code block with a language badge and a copy button. */
export function CodeBlock({ 'data-language': language, children, ...rest }: PreProps) {
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

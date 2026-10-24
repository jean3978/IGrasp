import type { ComponentProps, MouseEvent } from 'react';
import { backend } from '../../../ipc/client';
import { classifyLink, openDocumentLink, scrollToAnchor } from '../links';
import { usePreview } from '../previewContext';

/**
 * Every link click is handled here, so the webview itself never navigates: anchors scroll the
 * preview, web links open in the system browser, links to markdown files open in a tab.
 */
export function PreviewLink({ href, children, title, ...rest }: ComponentProps<'a'>) {
  const ctx = usePreview();
  const target = classifyLink(ctx.relPath, href);
  const hint =
    target.kind === 'unsupported' ? 'Opening this kind of link is not available yet' : title;

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    switch (target.kind) {
      case 'anchor':
        scrollToAnchor(ctx, target.id);
        break;
      case 'external':
        backend.openUrl(target.url).catch((err: unknown) => {
          console.error('Cannot open the link', err);
        });
        break;
      case 'document':
        void openDocumentLink(target.relPath).then((opened) => {
          if (!opened) console.warn(`Linked file not found: ${target.relPath}`);
        });
        break;
      case 'unsupported':
        break;
    }
  };

  return (
    <a
      {...rest}
      href={href}
      title={hint}
      data-link={target.kind}
      onClick={onClick}
      onAuxClick={(e) => {
        // A middle click would otherwise try to open a new webview window.
        e.preventDefault();
      }}
    >
      {children}
    </a>
  );
}

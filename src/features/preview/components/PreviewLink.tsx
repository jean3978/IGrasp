import type { ComponentProps, MouseEvent } from 'react';
import { useGraph } from '../../../stores/graph';
import { useUi } from '../../../stores/ui';
import { followLink, hoverText, linkProblem, resolveLink, statusFlag } from '../links';
import { usePreview } from '../previewContext';

/**
 * Every link click is handled here, so the webview itself never navigates. The link's status
 * comes from the document graph through the store (not the rendered tree), so a status change
 * re-renders only the links, never the markdown pipeline.
 */
export function PreviewLink({ href, children, title, ...rest }: ComponentProps<'a'>) {
  const ctx = usePreview();
  const info = useGraph((s) =>
    href === undefined ? undefined : s.linksByDoc[ctx.relPath]?.[href],
  );
  const resolved = resolveLink(ctx.relPath, href, info);
  const problem = linkProblem(resolved);
  const hint =
    problem ?? (resolved.target.kind === 'unsupported' ? 'This kind of link is not opened' : title);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    followLink(ctx, resolved, { pin: e.ctrlKey || e.metaKey });
  };

  return (
    <a
      {...rest}
      href={href}
      title={hint}
      data-link={resolved.target.kind}
      data-status={statusFlag(resolved.status)}
      onClick={onClick}
      onAuxClick={(e) => {
        // A middle click would otherwise try to open a new webview window: open pinned instead.
        e.preventDefault();
        if (e.button === 1) followLink(ctx, resolved, { pin: true });
      }}
      onMouseEnter={() => {
        useUi.getState().setHoveredLink(hoverText(ctx.relPath, href, resolved));
      }}
      onMouseLeave={() => {
        useUi.getState().setHoveredLink(null);
      }}
    >
      {children}
    </a>
  );
}

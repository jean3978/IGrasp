import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { memo, useMemo } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { previewComponents } from './previewComponents';
import { PreviewContext } from './previewContext';
import type { PreviewContextValue } from './previewContext';
import { FrontMatterCard } from './components/FrontMatterCard';
import type { RenderedMarkdown } from './pipeline/processor';
import './markdown.css';

const noContainer = () => null;

interface MarkdownPreviewProps {
  rendered: RenderedMarkdown;
  /** Root-relative path of the document, to resolve relative links and media. */
  relPath?: string;
  /** Absolute path of the open folder. */
  rootPath?: string;
  getScrollContainer?: () => HTMLElement | null;
}

/** Renders the processed document. Memoized: only a new render result re-creates the tree. */
export const MarkdownPreview = memo(function MarkdownPreview({
  rendered,
  relPath = '',
  rootPath = '',
  getScrollContainer = noContainer,
}: MarkdownPreviewProps) {
  const element = useMemo(
    () => toJsxRuntime(rendered.hast, { Fragment, jsx, jsxs, components: previewComponents }),
    [rendered],
  );
  const context = useMemo<PreviewContextValue>(
    () => ({ relPath, rootPath, getScrollContainer }),
    [relPath, rootPath, getScrollContainer],
  );
  return (
    <PreviewContext.Provider value={context}>
      <article className="markdown-body">
        {rendered.frontMatter && <FrontMatterCard frontMatter={rendered.frontMatter} />}
        {element}
      </article>
    </PreviewContext.Provider>
  );
});

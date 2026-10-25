import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { memo, useMemo } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { previewComponents } from './previewComponents';
import { PreviewContext } from './previewContext';
import type { PreviewContextValue } from './previewContext';
import { FrontMatterCard } from './components/FrontMatterCard';
import { QuizFileBanner } from './components/QuizFileBanner';
import type { QuizFileFacts } from './components/QuizFileBanner';
import { countQuizBlocks } from './pipeline/quizBlocks';
import type { RenderedMarkdown } from './pipeline/processor';
import './markdown.css';

const noContainer = () => null;

const text = (v: unknown) => (typeof v === 'string' ? v : null);

/** A quiz file (ADR 0024) is recognised by its front matter. */
function quizFacts(rendered: RenderedMarkdown): QuizFileFacts | null {
  const data = rendered.frontMatter?.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const fields = data as Record<string, unknown>;
  if (fields.igrasp !== 'quiz') return null;
  return {
    title: text(fields.title),
    subject: text(fields.subject),
    questions: countQuizBlocks(rendered.hast),
  };
}

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
  const quiz = useMemo(() => quizFacts(rendered), [rendered]);
  return (
    <PreviewContext.Provider value={context}>
      <article className="markdown-body">
        {quiz ? (
          <QuizFileBanner relPath={relPath} facts={quiz} />
        ) : (
          rendered.frontMatter && <FrontMatterCard frontMatter={rendered.frontMatter} />
        )}
        {element}
      </article>
    </PreviewContext.Provider>
  );
});

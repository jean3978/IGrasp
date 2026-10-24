import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Components } from 'hast-util-to-jsx-runtime';
import { memo, useMemo } from 'react';
import type { ComponentProps } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { Alert } from './components/Alert';
import { AssetImage } from './components/AssetImage';
import { AssetSource, AssetVideo } from './components/AssetVideo';
import { CodeBlock } from './components/CodeBlock';
import { PreviewLink } from './components/PreviewLink';
import { PreviewContext } from './previewContext';
import type { PreviewContextValue } from './previewContext';
import { FrontMatterCard } from './components/FrontMatterCard';
import { ALERT_TYPES } from './pipeline/alerts';
import type { AlertType } from './pipeline/alerts';
import type { RenderedMarkdown } from './pipeline/processor';
import './markdown.css';

const isAlertType = (v: unknown): v is AlertType => ALERT_TYPES.includes(v as AlertType);

function Div(props: ComponentProps<'div'> & { 'data-alert'?: string }) {
  const { 'data-alert': type, children, ...rest } = props;
  if (isAlertType(type)) return <Alert type={type}>{children}</Alert>;
  return <div {...rest}>{children}</div>;
}

function TaskCheckbox(props: ComponentProps<'input'>) {
  if (props.type !== 'checkbox') return <input {...props} />;
  return (
    <input
      type="checkbox"
      checked={Boolean(props.checked)}
      readOnly
      disabled
      aria-label={props.checked ? 'Done' : 'Not done'}
      className="task-checkbox"
    />
  );
}

const components: Partial<Components> = {
  a: PreviewLink,
  div: Div,
  img: AssetImage,
  input: TaskCheckbox,
  pre: CodeBlock,
  source: AssetSource,
  video: AssetVideo,
};

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
    () => toJsxRuntime(rendered.hast, { Fragment, jsx, jsxs, components }),
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

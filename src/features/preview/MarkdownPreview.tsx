import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Components } from 'hast-util-to-jsx-runtime';
import { memo, useMemo } from 'react';
import type { ComponentProps } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { Alert } from './components/Alert';
import { CodeBlock } from './components/CodeBlock';
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
  div: Div,
  input: TaskCheckbox,
  pre: CodeBlock,
};

interface MarkdownPreviewProps {
  rendered: RenderedMarkdown;
}

/** Renders the processed document. Memoized: only a new render result re-creates the tree. */
export const MarkdownPreview = memo(function MarkdownPreview({ rendered }: MarkdownPreviewProps) {
  const element = useMemo(
    () => toJsxRuntime(rendered.hast, { Fragment, jsx, jsxs, components }),
    [rendered],
  );
  return (
    <article className="markdown-body">
      {rendered.frontMatter && <FrontMatterCard frontMatter={rendered.frontMatter} />}
      {element}
    </article>
  );
});

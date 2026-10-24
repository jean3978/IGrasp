/* eslint-disable react-refresh/only-export-components --
   this module exports a component map, not components: nothing here hot-reloads on its own. */
import type { Components } from 'hast-util-to-jsx-runtime';
import type { ComponentProps } from 'react';
import { Alert } from './components/Alert';
import { AssetImage } from './components/AssetImage';
import { AssetSource, AssetVideo } from './components/AssetVideo';
import { CodeBlock } from './components/CodeBlock';
import { PreviewLink } from './components/PreviewLink';
import { ALERT_TYPES } from './pipeline/alerts';
import type { AlertType } from './pipeline/alerts';

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

/** The React components of the preview, shared with the rendered diff. */
export const previewComponents: Partial<Components> = {
  a: PreviewLink,
  div: Div,
  img: AssetImage,
  input: TaskCheckbox,
  pre: CodeBlock,
  source: AssetSource,
  video: AssetVideo,
};

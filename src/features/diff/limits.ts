import { MAX_RENDERED_CHARS } from '../preview/useMarkdown';

/** False for documents the pipeline refuses to render: use a line diff instead. */
export const canRenderDiff = (oldText: string, newText: string): boolean =>
  oldText.length <= MAX_RENDERED_CHARS && newText.length <= MAX_RENDERED_CHARS;

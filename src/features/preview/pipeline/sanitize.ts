// HTML sanitization schema: GitHub's defaults plus what IGrasp renders itself. It runs BEFORE
// the trusted generators (KaTeX, Shiki), so their inline styles are never stripped while user
// HTML can never smuggle a `style` attribute or a script.

import { defaultSchema } from 'rehype-sanitize';
import type { Options as Schema } from 'rehype-sanitize';
import { ALERT_TYPES } from './alerts';

const attrs = defaultSchema.attributes ?? {};

export const sanitizeSchema: Schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'video'],
  attributes: {
    ...attrs,
    a: [...(attrs.a ?? []), 'href', 'title'],
    code: [['className', /^language-./, 'math-inline', 'math-display']],
    div: [
      ...(attrs.div ?? []),
      ['className', 'markdown-alert', ...ALERT_TYPES.map((t) => `markdown-alert-${t}`)],
      ['dataAlert', ...ALERT_TYPES],
    ],
    p: [['className', 'markdown-alert-title']],
    img: [...(attrs.img ?? []), 'src', 'alt', 'title', 'width', 'height', 'loading', 'dataBlocked'],
    video: [
      'src',
      'controls',
      'poster',
      'width',
      'height',
      'muted',
      'loop',
      'preload',
      'dataBlocked',
    ],
    source: [...(attrs.source ?? []), 'src', 'type', 'dataBlocked'],
    td: [...(attrs.td ?? []), 'align'],
    th: [...(attrs.th ?? []), 'align'],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    // Remote media must be https (privacy, mixed content); relative paths have no protocol.
    src: ['https'],
    poster: ['https'],
  },
};

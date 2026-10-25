// The markdown pipeline (unified): markdown → mdast → hast, sanitized, with ids for anchors.

import type { Root as HastRoot } from 'hast';
import type { Root as MdastRoot } from 'mdast';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import { rehypeGithubAlerts } from 'rehype-github-alerts';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { VFile } from 'vfile';
import { alertOptions } from './alerts';
import { remarkGithubDollarMath } from './dollarMath';
import { remarkExtractFrontMatter } from './frontmatter';
import { highlightCode } from './highlight';
import { ID_PREFIX } from './ids';
import { rehypeMarkInsecureMedia } from './insecureMedia';
import { renderMath } from './math';
import { markMermaidBlocks } from './mermaid';
import { markQuizBlocks } from './quizBlocks';
import { rehypeQuoteLines, rehypeSourceLines } from './lines';
import type { FrontMatter } from './frontmatter';
import { sanitizeSchema } from './sanitize';

export { ID_PREFIX };

export interface RenderedMarkdown {
  hast: HastRoot;
  frontMatter: FrontMatter | null;
}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ['yaml'])
  .use(remarkExtractFrontMatter)
  .use(remarkMath)
  .use(remarkGithubDollarMath);

const transformer = unified()
  // Ids are left unprefixed here; the sanitizer adds ID_PREFIX once.
  .use(remarkRehype, { allowDangerousHtml: true, footnoteLabel: 'Footnotes', clobberPrefix: '' })
  .use(rehypeRaw)
  .use(rehypeQuoteLines)
  .use(rehypeGithubAlerts, alertOptions)
  .use(rehypeMarkInsecureMedia)
  .use(rehypeSourceLines)
  .use(rehypeSanitize, sanitizeSchema)
  .use(rehypeSlug, { prefix: ID_PREFIX });

export async function renderMarkdown(content: string): Promise<RenderedMarkdown> {
  const file = new VFile({ value: content });
  const mdast = parser.parse(file);
  const transformedMdast = (await parser.run(mdast, file)) as MdastRoot;
  const hast = await transformer.run(transformedMdast, file);
  // Trusted generators run after sanitization, so their markup is never stripped.
  await renderMath(hast, file);
  await highlightCode(hast);
  markMermaidBlocks(hast);
  markQuizBlocks(hast);
  return { hast, frontMatter: file.data.frontMatter ?? null };
}

// A rendered markdown diff: both versions go through the preview pipeline (sanitized, same slugs,
// same components), the rendered trees are cut at the top-level block boundaries (`data-line`)
// and recomposed along the block diff: common blocks once (from the new document), a changed
// group as its removed blocks followed by its added blocks. The diff only adds wrapper elements
// around sanitized content, never raw HTML (ADR 0003).
//
// A caller draws its own controls per change group through `renderToolbar` (the inline review
// puts Accept / Reject there) and reflects decisions through `states`.

import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import type { Element, ElementContent, Root } from 'hast';
import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { visit } from 'unist-util-visit';
import { FrontMatterCard } from '../preview/components/FrontMatterCard';
import { previewComponents } from '../preview/previewComponents';
import { PreviewContext } from '../preview/previewContext';
import type { PreviewContextValue } from '../preview/previewContext';
import type { RenderedMarkdown } from '../preview/pipeline/processor';
import '../preview/markdown.css';
import { blockDiff } from './blockDiff';
import { canRenderDiff } from './limits';
import type { BlockDiff, DiffGroup } from './blockDiff';
import type { Block } from './blocks';
import './diff.css';

export type ChangeState = 'pending' | 'accepted' | 'rejected';

/** What a caller gets for each change group. */
export interface ChangeSlot {
  /** Index among the change groups (`BlockDiff.changes`). */
  index: number;
  count: number;
  group: DiffGroup;
  state: ChangeState;
}

export interface RenderedDiffProps {
  oldText: string;
  newText: string;
  /**
   * The block diff of the two texts, when the caller already has it (the review computes its
   * change units from it, so both must agree). Ignored when it does not match the texts.
   */
  diff?: BlockDiff;
  /** Decision per change-group index; missing means pending. */
  states?: readonly (ChangeState | undefined)[];
  /** Replaces the default `aria-label` detail ("replaced paragraph") per change-group index. */
  labels?: readonly (string | undefined)[];
  /**
   * Replaces the whole `aria-label` of a change group (the review numbers its change units, which
   * may span several groups).
   */
  ariaLabel?: (slot: ChangeSlot) => string | undefined;
  /** Controls drawn at the top right of each change group (sticky while the group is visible). */
  renderToolbar?: (slot: ChangeSlot) => ReactNode;
  /** Key presses inside a change group (A / R shortcuts of the review). */
  onGroupKeyDown?: (event: KeyboardEvent<HTMLElement>, slot: ChangeSlot) => void;
  /** Change group to flash briefly (after a decision); disabled by `prefers-reduced-motion`. */
  flashIndex?: number | null;
  relPath?: string;
  rootPath?: string;
  getScrollContainer?: () => HTMLElement | null;
}

interface Side {
  rendered: RenderedMarkdown;
  /** Rendered elements by block index. */
  elements: Map<number, ElementContent[]>;
}

interface Ready {
  oldText: string;
  newText: string;
  diff: BlockDiff;
  old: Side;
  new: Side;
}

const noContainer = () => null;

const lineOf = (el: Element): number | undefined => {
  const value = el.properties['dataLine'] ?? el.position?.start.line;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

/** Distributes the top-level elements of a rendered document to the blocks that start them. */
function sliceBlocks(rendered: RenderedMarkdown, blocks: Block[], dropIds: boolean): Side {
  const hast = dropIds ? structuredClone(rendered.hast) : rendered.hast;
  if (dropIds) {
    // The removed version is shown next to the new one: its anchors must not collide.
    visit(hast, 'element', (node) => {
      delete node.properties['id'];
    });
  }
  const byLine = new Map(blocks.map((b) => [b.startLine, b.index]));
  const elements = new Map<number, ElementContent[]>();
  let current = blocks.find((b) => b.kind !== 'yaml')?.index ?? -1;
  // The footnotes section is generated at the end: it belongs to the first footnote definition.
  const footnotes = blocks.find((b) => b.kind === 'footnoteDefinition')?.index;
  for (const child of hast.children) {
    if (child.type !== 'element') continue;
    if (child.properties['dataFootnotes'] !== undefined && footnotes !== undefined) {
      elements.set(footnotes, [...(elements.get(footnotes) ?? []), child]);
      continue;
    }
    const line = lineOf(child);
    const index = line === undefined ? undefined : byLine.get(line);
    if (index !== undefined) current = index;
    if (current < 0) continue;
    const list = elements.get(current) ?? [];
    list.push(child);
    elements.set(current, list);
  }
  return { rendered: { ...rendered, hast }, elements };
}

function renderElements(children: ElementContent[]): ReactNode {
  const root: Root = { type: 'root', children };
  return toJsxRuntime(root, { Fragment, jsx, jsxs, components: previewComponents });
}

function renderBlocks(side: Side, blocks: Block[]): ReactNode {
  return blocks.map((block) => {
    if (block.kind === 'yaml') {
      const fm = side.rendered.frontMatter;
      return fm ? <FrontMatterCard key={block.index} frontMatter={fm} /> : null;
    }
    const elements = side.elements.get(block.index);
    if (elements && elements.length > 0) {
      return <Fragment key={block.index}>{renderElements(elements)}</Fragment>;
    }
    // Blocks that render nothing on their own (link definitions, footnotes): show the source.
    return (
      <pre key={block.index} className="diff-source">
        {block.raw}
      </pre>
    );
  });
}

export function RenderedDiff({
  oldText,
  newText,
  diff: given,
  states,
  labels,
  ariaLabel,
  renderToolbar,
  onGroupKeyDown,
  flashIndex = null,
  relPath = '',
  rootPath = '',
  getScrollContainer = noContainer,
}: RenderedDiffProps) {
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tooLarge = !canRenderDiff(oldText, newText);

  useEffect(() => {
    if (tooLarge) return;
    const run = { cancelled: false };
    void (async () => {
      try {
        const { renderMarkdown } = await import('../preview/pipeline/processor');
        const [a, b] = await Promise.all([renderMarkdown(oldText), renderMarkdown(newText)]);
        if (run.cancelled) return;
        const diff =
          given && given.oldText === oldText && given.newText === newText
            ? given
            : blockDiff(oldText, newText);
        setReady({
          oldText,
          newText,
          diff,
          old: sliceBlocks(a, diff.old.blocks, true),
          new: sliceBlocks(b, diff.new.blocks, false),
        });
        setError(null);
      } catch (err) {
        if (!run.cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      run.cancelled = true;
    };
  }, [oldText, newText, given, tooLarge]);

  const context = useMemo<PreviewContextValue>(
    () => ({ relPath, rootPath, getScrollContainer }),
    [relPath, rootPath, getScrollContainer],
  );

  // The two versions rendered once per diff; decisions only change classes and toolbars.
  const parts = useMemo(() => {
    if (!ready) return null;
    return ready.diff.groups.map((group) => ({
      group,
      removed: group.kind === 'same' ? null : renderBlocks(ready.old, group.oldBlocks),
      added: renderBlocks(ready.new, group.newBlocks),
    }));
  }, [ready]);

  if (tooLarge) {
    return (
      <p className="diff-notice" role="status">
        This document is too large to show a rendered comparison.
      </p>
    );
  }
  if (error) {
    return (
      <p className="diff-notice" role="alert">
        The comparison could not be rendered: {error}
      </p>
    );
  }
  if (!ready || !parts) return null;

  const count = ready.diff.changes.length;
  return (
    <PreviewContext.Provider value={context}>
      <article className="markdown-body rendered-diff">
        {parts.map(({ group, removed, added }, i) => {
          if (group.kind === 'same') return <Fragment key={i}>{added}</Fragment>;
          const index = group.changeIndex;
          const state = states?.[index] ?? 'pending';
          const slot: ChangeSlot = { index, count, group, state };
          const detail = labels?.[index] ?? group.label;
          return (
            <div
              key={i}
              onKeyDown={
                onGroupKeyDown
                  ? (e) => {
                      onGroupKeyDown(e, slot);
                    }
                  : undefined
              }
              role="group"
              tabIndex={0}
              aria-label={ariaLabel?.(slot) ?? `Change ${index + 1} of ${count}: ${detail}`}
              className={`diff-group diff-group--${group.kind} diff-group--${state}${
                flashIndex === index ? ' diff-group--flash' : ''
              }`}
              data-change-index={index}
              data-state={state}
            >
              {renderToolbar && <div className="diff-toolbar">{renderToolbar(slot)}</div>}
              {group.oldBlocks.length > 0 && (
                <div className="diff-part diff-part--removed">
                  <span className="diff-sr">Removed</span>
                  {removed}
                </div>
              )}
              {group.newBlocks.length > 0 && (
                <div className="diff-part diff-part--added">
                  <span className="diff-sr">Added</span>
                  {added}
                </div>
              )}
            </div>
          );
        })}
      </article>
    </PreviewContext.Provider>
  );
}

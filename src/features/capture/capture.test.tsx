import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureOverlay } from './CaptureOverlay';
import {
  boundingRect,
  captureCodeRegion,
  captureMarkdownRegion,
  clampRect,
  elementsInRect,
  mergeLineRects,
  narrowToSelection,
  rectFromPoints,
} from './capture';

const SOURCE = [
  '# Title', // 1
  '', // 2
  'First paragraph.', // 3
  '', // 4
  '- a', // 5
  '- b', // 6
  '', // 7
  'Last paragraph.', // 8
  '', // 9
].join('\n');

/** Gives an element a layout box (jsdom has no layout). */
function box(el: Element, top: number, height: number, left = 0, width = 400) {
  el.getBoundingClientRect = () => ({
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  });
}

function markdownContainer() {
  const c = document.createElement('div');
  c.innerHTML =
    '<h1 data-line="1">Title</h1><p data-line="3">First paragraph.</p>' +
    '<ul data-line="5"><li data-line="5">a</li><li data-line="6">b</li></ul>' +
    '<p data-line="8">Last paragraph.</p>';
  const marks = [...c.querySelectorAll('[data-line]')];
  const at = (i: number): Element => {
    const el = marks[i];
    if (!el) throw new Error('missing');
    return el;
  };
  box(at(0), 0, 40);
  box(at(1), 50, 20);
  box(at(2), 80, 40);
  box(at(3), 80, 20);
  box(at(4), 100, 20);
  box(at(5), 130, 20);
  return c;
}

const rect = (y: number, height: number) => ({ x: 10, y, width: 100, height });

describe('captureMarkdownRegion', () => {
  const c = markdownContainer();

  it('maps a paragraph to its lines', () => {
    expect(captureMarkdownRegion(c, rect(52, 10), SOURCE)).toEqual({
      firstLine: 3,
      lastLine: 3,
      text: 'First paragraph.',
    });
  });

  it('covers a whole list and excludes the trailing blank line', () => {
    expect(captureMarkdownRegion(c, rect(85, 30), SOURCE)).toEqual({
      firstLine: 5,
      lastLine: 6,
      text: '- a\n- b',
    });
  });

  it('spans several blocks and runs to the document end after the last one', () => {
    expect(captureMarkdownRegion(c, rect(45, 100), SOURCE)).toEqual({
      firstLine: 3,
      lastLine: 8,
      text: 'First paragraph.\n\n- a\n- b\n\nLast paragraph.',
    });
  });

  it('uses the nearest block with an empty text when nothing intersects', () => {
    expect(captureMarkdownRegion(c, rect(300, 40), SOURCE)).toEqual({
      firstLine: 8,
      lastLine: 8,
      text: '',
    });
    expect(captureMarkdownRegion(document.createElement('div'), rect(0, 10), SOURCE)).toBeNull();
  });
});

describe('captureCodeRegion', () => {
  it('maps rows to 1-based lines', () => {
    const c = document.createElement('div');
    c.innerHTML = [3, 4, 5]
      .map((i) => `<div class="code-line" data-index="${String(i)}"></div>`)
      .join('');
    [...c.children].forEach((row, i) => {
      box(row, i * 20, 20);
    });
    const src = 'l1\nl2\nl3\nl4\nl5\nl6\n';
    expect(captureCodeRegion(c, rect(25, 20), src)).toEqual({
      firstLine: 5,
      lastLine: 6,
      text: 'l5\nl6',
    });
    expect(captureCodeRegion(c, rect(500, 20), src)).toEqual({
      firstLine: 6,
      lastLine: 6,
      text: '',
    });
  });
});

describe('narrowToSelection', () => {
  const doc = [
    '# Services', // 1
    '', // 2
    '- **Auth**: signs users in.', // 3
    '- **Billing**: charges the [card](https://pay.example).', // 4
    '- **Mail**: sends `welcome` emails.', // 5
    '- **Search**: indexes documents.', // 6
    '- **Export**: writes CSV files.', // 7
    '', // 8
    'A long paragraph written on', // 9
    'several source lines, with _emphasis_', // 10
    'and more words at the end.', // 11
    '', // 12
  ].join('\n');
  const block = (firstLine: number, lastLine: number) => ({ firstLine, lastLine, text: 'x' });

  it('keeps only the list items the highlighted text is in', () => {
    // As the preview renders it: no marks, the link as its text.
    const picked = narrowToSelection(
      doc,
      block(3, 7),
      'Billing: charges the card.\nMail: sends welcome emails.',
    );
    expect(picked).toEqual({
      firstLine: 4,
      lastLine: 5,
      text: '- **Billing**: charges the [card](https://pay.example).\n- **Mail**: sends `welcome` emails.',
    });
  });

  it('keeps only the source lines of part of a paragraph', () => {
    expect(narrowToSelection(doc, block(9, 11), 'with emphasis and more')).toMatchObject({
      firstLine: 10,
      lastLine: 11,
    });
    expect(narrowToSelection(doc, block(9, 11), 'several source')).toMatchObject({
      firstLine: 10,
      lastLine: 10,
    });
  });

  it('picks the occurrence the user highlighted when the phrase repeats', () => {
    const repeated = ['The user signs in.', 'Then', 'the user signs in.', 'Again.'].join('\n');
    const whole = { firstLine: 1, lastLine: 4, text: 'x' };
    // Highlighted in the third line: the rendered text before it is the first two lines.
    expect(
      narrowToSelection(repeated, whole, 'user signs in', 'The user signs in. Then the '),
    ).toMatchObject({ firstLine: 3, lastLine: 3 });
    // Without a position, the first one.
    expect(narrowToSelection(repeated, whole, 'user signs in')).toMatchObject({
      firstLine: 1,
      lastLine: 1,
    });
  });

  it('matches both ends when the middle renders differently, else keeps the block', () => {
    expect(
      narrowToSelection(doc, block(3, 7), 'Mail: sends welcome emails. [1] Search: indexes'),
    ).toMatchObject({ firstLine: 5, lastLine: 6 });
    expect(narrowToSelection(doc, block(3, 7), 'nothing like this')).toEqual(block(3, 7));
  });
});

describe('selection helpers', () => {
  it('picks the lines of every box of a text selection', () => {
    const c = markdownContainer();
    // One box on the title, one on the last paragraph: everything between is covered.
    expect(captureMarkdownRegion(c, [rect(10, 10), rect(132, 10)], SOURCE)).toMatchObject({
      firstLine: 1,
      lastLine: 8,
    });
  });

  it('keeps the outermost blocks a region touches, in document order', () => {
    const c = markdownContainer();
    const hit = elementsInRect(c, rect(85, 30));
    expect(hit.map((el) => el.tagName)).toEqual(['UL']);
  });

  it('merges the boxes of one line and bounds them all', () => {
    const merged = mergeLineRects([
      { x: 50, y: 10, width: 20, height: 16 },
      { x: 0, y: 10, width: 51, height: 16 },
      { x: 0, y: 30, width: 40, height: 16 },
    ]);
    expect(merged).toEqual([
      { x: 0, y: 10, width: 70, height: 16 },
      { x: 0, y: 30, width: 40, height: 16 },
    ]);
    expect(boundingRect(merged)).toEqual({ x: 0, y: 10, width: 70, height: 36 });
    expect(boundingRect([])).toBeNull();
  });
});

describe('rect helpers', () => {
  it('normalizes and clamps', () => {
    expect(rectFromPoints(50, 60, 10, 20)).toEqual({ x: 10, y: 20, width: 40, height: 40 });
    expect(
      clampRect({ x: -5, y: 90, width: 30, height: 30 }, { x: 0, y: 0, width: 100, height: 100 }),
    ).toEqual({ x: 0, y: 70, width: 30, height: 30 });
  });
});

describe('CaptureOverlay', () => {
  afterEach(() => {
    document.querySelectorAll('[data-test-container]').forEach((n) => {
      n.remove();
    });
  });

  function setup() {
    const container = document.createElement('div');
    container.dataset['testContainer'] = '';
    document.body.append(container);
    box(container, 0, 400, 0, 600);
    const onCapture = vi.fn();
    const onCancel = vi.fn();
    const view = render(
      <CaptureOverlay container={container} onCapture={onCapture} onCancel={onCancel} />,
    );
    const overlay = document.querySelector<HTMLElement>('.capture-overlay');
    if (!overlay) throw new Error('no overlay');
    return { overlay, onCapture, onCancel, view };
  }

  it('captures a dragged rectangle and ignores one that is too small', () => {
    const { overlay, onCapture } = setup();
    fireEvent.mouseDown(overlay, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(overlay, { clientX: 110, clientY: 110 });
    fireEvent.mouseUp(overlay, { clientX: 110, clientY: 110 });
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.mouseDown(overlay, { clientX: 200, clientY: 150 });
    fireEvent.mouseMove(overlay, { clientX: 120, clientY: 80 });
    fireEvent.mouseUp(overlay, { clientX: 120, clientY: 80 });
    expect(onCapture).toHaveBeenCalledWith({ x: 120, y: 80, width: 80, height: 70 });
  });

  it('cancels on Escape', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('works from the keyboard: centre rectangle, move, resize, Enter', () => {
    const { overlay, onCapture } = setup();
    fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    fireEvent.keyDown(overlay, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(overlay, { key: 'Enter' });
    expect(onCapture).toHaveBeenCalledWith({ x: 216, y: 140, width: 200, height: 136 });
  });

  it('announces the keyboard selection and gives the focus back when it goes away', () => {
    const button = document.createElement('button');
    button.dataset['testContainer'] = '';
    document.body.append(button);
    button.focus();
    const { overlay, view } = setup();
    expect(overlay).toHaveFocus();
    fireEvent.keyDown(overlay, { key: 'ArrowRight' });
    expect(overlay.querySelector('[role="status"]')).toHaveTextContent(
      'Selection 200 by 120 pixels. Enter captures it.',
    );
    view.unmount();
    expect(button).toHaveFocus();
  });
});

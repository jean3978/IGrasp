import { fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptureOverlay } from './CaptureOverlay';
import { captureCodeRegion, captureMarkdownRegion, clampRect, rectFromPoints } from './capture';

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
});

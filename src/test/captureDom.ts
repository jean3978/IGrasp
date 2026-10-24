// jsdom has no layout: a document tab's markup with boxes, to draw capture rectangles on.

import { fireEvent } from '@testing-library/react';

export const CAPTURE_SOURCE = [
  '# Title',
  '',
  'First paragraph.',
  '',
  '- a',
  '- b',
  '',
  'Last paragraph.',
  '',
].join('\n');

export function box(el: Element, top: number, height: number, left = 0, width = 400) {
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

/** What a document tab renders, with layout boxes (jsdom has none). */
export function mountDocument() {
  const panel = document.createElement('div');
  panel.className = 'tab-content';
  panel.innerHTML =
    '<div class="document-scroll"><h1 data-line="1">Title</h1><p data-line="3">First paragraph.</p>' +
    '<ul data-line="5"><li data-line="5">a</li><li data-line="6">b</li></ul>' +
    '<p data-line="8">Last paragraph.</p></div>';
  document.body.append(panel);
  const scroll = panel.querySelector('.document-scroll');
  if (!scroll) throw new Error('no scroll');
  box(scroll, 0, 400, 0, 600);
  const marks = [...panel.querySelectorAll('[data-line]')];
  [
    [0, 40],
    [50, 20],
    [80, 40],
    [80, 20],
    [100, 20],
    [130, 20],
  ].forEach(([top, height], i) => {
    const el = marks[i];
    if (el && top !== undefined && height !== undefined) box(el, top, height);
  });
  return panel;
}

export const drag = (from: [number, number], to: [number, number]) => {
  const overlay = document.querySelector<HTMLElement>('.capture-overlay');
  if (!overlay) throw new Error('no overlay');
  fireEvent.mouseDown(overlay, { clientX: from[0], clientY: from[1] });
  fireEvent.mouseMove(overlay, { clientX: to[0], clientY: to[1] });
  fireEvent.mouseUp(overlay, { clientX: to[0], clientY: to[1] });
};

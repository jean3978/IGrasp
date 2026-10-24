import { describe, expect, it } from 'vitest';
import type { TreeRow } from '../../stores/tree';
import { rowId, treeKeyCommand } from './treeKeyboard';

const row = (kind: TreeRow['kind'], path: string, parent: string, expanded = false): TreeRow => ({
  kind,
  path,
  name: path.split('/').pop() ?? path,
  level: path.split('/').length,
  hidden: false,
  expanded,
  posInSet: 1,
  setSize: 1,
  parent,
});

// docs (expanded) > guide (collapsed), a.md ; notes ; README.md
const rows: TreeRow[] = [
  row('dir', 'docs', '', true),
  row('dir', 'docs/guide', 'docs'),
  row('file', 'docs/a.md', 'docs'),
  row('dir', 'notes', ''),
  row('file', 'README.md', ''),
];

describe('treeKeyCommand', () => {
  it('moves with arrows, Home and End', () => {
    expect(treeKeyCommand('ArrowDown', rows, 'docs')).toEqual({
      type: 'focus',
      path: 'docs/guide',
    });
    expect(treeKeyCommand('ArrowUp', rows, 'docs/guide')).toEqual({ type: 'focus', path: 'docs' });
    expect(treeKeyCommand('End', rows, 'docs')).toEqual({ type: 'focus', path: 'README.md' });
    expect(treeKeyCommand('Home', rows, 'notes')).toEqual({ type: 'focus', path: 'docs' });
    expect(treeKeyCommand('ArrowDown', rows, 'README.md').type).toBe('none');
  });

  it('expands, enters, collapses and climbs with left/right', () => {
    expect(treeKeyCommand('ArrowRight', rows, 'docs/guide')).toEqual({
      type: 'expand',
      path: 'docs/guide',
    });
    expect(treeKeyCommand('ArrowRight', rows, 'docs')).toEqual({
      type: 'focus',
      path: 'docs/guide',
    });
    expect(treeKeyCommand('ArrowLeft', rows, 'docs')).toEqual({ type: 'collapse', path: 'docs' });
    expect(treeKeyCommand('ArrowLeft', rows, 'docs/a.md')).toEqual({ type: 'focus', path: 'docs' });
  });

  it('opens files pinned with Enter and as a preview with Space', () => {
    expect(treeKeyCommand('Enter', rows, 'README.md')).toEqual({
      type: 'open',
      path: 'README.md',
      pin: true,
    });
    expect(treeKeyCommand(' ', rows, 'README.md')).toEqual({
      type: 'open',
      path: 'README.md',
      pin: false,
    });
  });

  it('expands collapsed sibling folders with *', () => {
    expect(treeKeyCommand('*', rows, 'docs')).toEqual({ type: 'expandMany', paths: ['notes'] });
  });

  it('jumps by type-ahead, cycling after the current row', () => {
    expect(treeKeyCommand('n', rows, 'docs', 'n')).toEqual({ type: 'focus', path: 'notes' });
    expect(treeKeyCommand('r', rows, 'notes', 're')).toEqual({ type: 'focus', path: 'README.md' });
    expect(treeKeyCommand('d', rows, 'README.md', 'd')).toEqual({ type: 'focus', path: 'docs' });
    expect(treeKeyCommand('x', rows, 'docs', 'x').type).toBe('none');
  });

  it('lands on the first row when nothing is focused', () => {
    expect(treeKeyCommand('ArrowDown', rows, null)).toEqual({ type: 'focus', path: 'docs' });
  });

  it('builds DOM-safe ids', () => {
    expect(rowId('docs/a b.md')).toMatch(/^tree-item-[a-zA-Z0-9_-]+$/);
    expect(rowId('a/b')).not.toBe(rowId('a_b'));
  });
});

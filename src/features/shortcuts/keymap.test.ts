import { describe, expect, it } from 'vitest';
import { matchBinding } from './keymap';

const key = (k: string, mods: Partial<Record<'ctrl' | 'shift' | 'alt', boolean>> = {}) => ({
  key: k,
  ctrlKey: mods.ctrl ?? false,
  shiftKey: mods.shift ?? false,
  altKey: mods.alt ?? false,
  metaKey: false,
});

describe('matchBinding', () => {
  it('matches Ctrl shortcuts case-insensitively', () => {
    expect(matchBinding(key('O', { ctrl: true }))).toBe('file.openFolder');
    expect(matchBinding(key('b', { ctrl: true }))).toBe('view.toggleSidebar');
  });

  it('requires the exact modifiers', () => {
    expect(matchBinding(key('o'))).toBeUndefined();
    expect(matchBinding(key('o', { ctrl: true, alt: true }))).toBeUndefined();
    expect(matchBinding(key('b', { ctrl: true, shift: true }))).toBeUndefined();
  });

  it('accepts both = and + for zoom in', () => {
    expect(matchBinding(key('=', { ctrl: true }))).toBe('view.zoomIn');
    expect(matchBinding(key('+', { ctrl: true, shift: true }))).toBe('view.zoomIn');
  });
});

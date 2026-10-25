import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../ipc/client';
import { DEFAULT_SETTINGS } from '../ipc/defaults';
import { BackendError } from '../ipc/types';
import { resolveTheme, selectEffectiveTheme, useSettings } from './settings';

beforeEach(() => {
  window.__igraspMock?.reset();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false, systemDark: false });
});

describe('resolveTheme', () => {
  it('follows the system preference for "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('keeps explicit themes', () => {
    expect(resolveTheme('high-contrast', true)).toBe('high-contrast');
  });
});

describe('settings store', () => {
  it('loads settings from the backend', async () => {
    await backend.updateSettings({ fontSize: 20 });
    await useSettings.getState().load();
    expect(useSettings.getState().loaded).toBe(true);
    expect(useSettings.getState().settings.fontSize).toBe(20);
  });

  it('persists updates and keeps the backend-normalized value', async () => {
    await useSettings.getState().update({ fontSize: 99, theme: 'dark' });
    expect(useSettings.getState().settings.fontSize).toBe(24);
    expect(selectEffectiveTheme(useSettings.getState())).toBe('dark');
    expect((await backend.getSettings()).theme).toBe('dark');
  });

  it('patches the AI settings field by field, like Rust', async () => {
    await useSettings.getState().update({ ai: { permissions: { commands: 'allow' } } });
    await useSettings.getState().update({ ai: { model: ' mock-smart ', historyLimit: 1 } });
    const { ai } = useSettings.getState().settings;
    expect(ai.model).toBe('mock-smart');
    expect(ai.historyLimit).toBe(10);
    expect(ai.permissions).toEqual({
      markdownEdits: 'ask',
      fileEdits: 'ask',
      commands: 'allow',
      web: 'ask',
      other: 'ask',
    });
    expect(ai.confirmFrom).toBe('large');
    expect((await backend.getSettings()).ai).toEqual(ai);
  });

  it('rolls back when persisting fails', async () => {
    vi.spyOn(backend, 'updateSettings').mockRejectedValueOnce(new BackendError('AppData', 'disk'));
    await expect(useSettings.getState().update({ theme: 'dark' })).rejects.toThrow('disk');
    expect(useSettings.getState().settings.theme).toBe('system');
  });
});

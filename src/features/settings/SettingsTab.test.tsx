import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../ipc/defaults';
import { backend } from '../../ipc/client';
import { useSettings } from '../../stores/settings';
import { SettingsTab } from './SettingsTab';

beforeEach(() => {
  window.__igraspMock?.reset();
  useSettings.setState({ settings: DEFAULT_SETTINGS });
});

const saved = () => backend.getSettings();

describe('SettingsTab', () => {
  it('changes the theme and the reading width and persists them', async () => {
    render(<SettingsTab />);
    await userEvent.click(screen.getByRole('radio', { name: 'High Contrast' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Wide' }));
    await waitFor(async () => {
      const s = await saved();
      expect(s.theme).toBe('high-contrast');
      expect(s.readingWidth).toBe('wide');
    });
  });

  it('mutes notifications with the switch', async () => {
    render(<SettingsTab />);
    await userEvent.click(screen.getByRole('switch', { name: 'Mute notifications' }));
    await waitFor(async () => {
      expect((await saved()).toastsMuted).toBe(true);
    });
  });

  it('applies extra ignore patterns', async () => {
    render(<SettingsTab />);
    const box = screen.getByRole('textbox', { name: 'Extra ignore patterns' });
    const apply = screen.getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    await userEvent.type(box, 'drafts/{Enter}*.tmp.md');
    await userEvent.click(apply);
    await waitFor(async () => {
      expect((await saved()).ignorePatterns).toEqual(['drafts/', '*.tmp.md']);
    });
  });

  it('resets every setting', async () => {
    await useSettings.getState().update({ fontSize: 22, theme: 'dark', toastsMuted: true });
    render(<SettingsTab />);
    await userEvent.click(screen.getByRole('button', { name: 'Reset settings' }));
    await waitFor(async () => {
      const s = await saved();
      expect(s).toEqual(DEFAULT_SETTINGS);
    });
  });
});

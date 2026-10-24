import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../App';
import { useTabs } from '../../stores/tabs';
import { useUi } from '../../stores/ui';

beforeEach(() => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  useUi.setState({ aboutOpen: false });
});

describe('menu bar', () => {
  it('opens a menu with its Alt mnemonic', async () => {
    render(<App />);
    await userEvent.keyboard('{Alt>}h{/Alt}');
    expect(await screen.findByRole('menuitem', { name: /Keyboard Shortcuts/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /About IGrasp/ })).toBeVisible();
  });

  it('lists the four menus with their shortcuts', () => {
    render(<App />);
    const triggers = screen
      .getAllByRole('menuitem')
      .filter((m) => m.hasAttribute('aria-keyshortcuts'));
    expect(triggers.map((t) => t.textContent)).toEqual(['File', 'Edit', 'View', 'Help']);
    expect(triggers.map((t) => t.getAttribute('aria-keyshortcuts'))).toEqual([
      'Alt+F',
      'Alt+E',
      'Alt+V',
      'Alt+H',
    ]);
  });

  it('opens the shortcuts reference with F1 and About from the Help menu', async () => {
    render(<App />);
    await userEvent.keyboard('{F1}');
    expect(useTabs.getState().tabs.map((t) => t.kind)).toEqual(['shortcuts']);
    expect(await screen.findByRole('heading', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
    await userEvent.keyboard('{Alt>}h{/Alt}');
    await userEvent.click(await screen.findByRole('menuitem', { name: /About IGrasp/ }));
    expect(await screen.findByRole('dialog', { name: 'IGrasp' })).toBeInTheDocument();
  });
});

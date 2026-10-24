// Every control that can start an AI operation (action flagged `usesAi`) or opens the AI feature
// (`aiFeature`) shows the marker, and no other control does.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { MOCK_PROVIDER_NAME } from '../../ipc/mock/mockAi';
import { useAi } from '../../stores/ai';
import { useAiPanel } from '../../stores/aiPanel';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { MenuBar } from './MenuBar';
import { actions } from './menuActions';
import type { ActionId } from './menuActions';
import { ToolbarActions } from './ToolbarActions';

const flagged = (Object.keys(actions) as ActionId[]).filter(
  (id) => actions[id].usesAi || actions[id].aiFeature,
);

beforeEach(async () => {
  window.__igraspMock?.reset();
  useAiPanel.setState({ open: false });
  useAi.setState({ status: null, providers: null });
  await useSettings.getState().load();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

function renderBars() {
  return render(
    <Tooltip.Provider>
      <MenuBar />
      <ToolbarActions />
    </Tooltip.Provider>,
  );
}

describe('the "uses AI" marker', () => {
  it('flags the AI chat action', () => {
    expect(flagged).toContain('ai.chat');
  });

  it('is on exactly the flagged controls of the toolbar', () => {
    renderBars();
    const toolbar = screen.getByRole('toolbar');
    for (const button of within(toolbar).getAllByRole('button')) {
      const marked = button.querySelector('[data-ai-mark]') !== null;
      const label = button.getAttribute('aria-label') ?? '';
      const action = (Object.keys(actions) as ActionId[]).find((id) => actions[id].label === label);
      const expected = action !== undefined && flagged.includes(action);
      expect(marked, label).toBe(expected);
    }
    for (const id of flagged) {
      if (id === 'ai.chat') {
        const button = within(toolbar).getByRole('button', { name: actions[id].label });
        expect(button.querySelector('[data-ai-mark]')).not.toBeNull();
      }
    }
  });

  it('is on exactly the flagged items of every menu', async () => {
    renderBars();
    for (const title of ['File', 'Edit', 'View', 'Help']) {
      await userEvent.click(screen.getByRole('menuitem', { name: title }));
      const menu = await screen.findByRole('menu');
      for (const item of within(menu).getAllByRole('menuitem')) {
        const label = item.querySelector('.menu-item-label')?.textContent ?? '';
        const action = (Object.keys(actions) as ActionId[]).find(
          (id) => actions[id].label === label,
        );
        const expected = action !== undefined && flagged.includes(action);
        expect(item.querySelector('[data-ai-mark]') !== null, `${title} > ${label}`).toBe(expected);
      }
      await userEvent.keyboard('{Escape}');
    }
  });

  it('names the provider from its status, never from code', async () => {
    renderBars();
    const toolbar = screen.getByRole('toolbar');
    const mark = () =>
      within(toolbar)
        .getByRole('button', { name: actions['ai.chat'].label })
        .querySelector<HTMLElement>('[data-ai-mark]');
    // Before any status check the provider list (which probes nothing) names it.
    await waitFor(() => {
      expect(mark()?.title).toContain(`uses ${MOCK_PROVIDER_NAME}`);
    });
    await act(() => useAi.getState().checkStatus());
    expect(mark()?.title).toContain(MOCK_PROVIDER_NAME);
  });
});

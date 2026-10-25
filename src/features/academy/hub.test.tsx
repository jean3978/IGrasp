// The Academy's hub: Hoot's welcome when the tab opens (once, skipped without motion), the
// classroom with the tutorials on the blackboard, and "New tutorial" into the wizard (subject,
// options, confirmation). None of it calls the AI.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import { useAcademy } from '../../stores/academy';
import { startEventBridge } from '../../stores/eventBridge';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { AcademyTab } from './AcademyTab';
import { WELCOME_FADE_MS, WELCOME_MS } from './AcademyWelcome';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};
const academy = () => useAcademy.getState();

let stop = () => {};

beforeEach(async () => {
  mock().reset();
  resetAiStores();
  await useSettings.getState().load();
  academy().leaveFolder();
  useAcademy.setState({ welcome: false });
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  useTabs.getState().closeAll();
});

afterEach(() => {
  stop();
});

const renderTab = () =>
  render(
    <Tooltip.Provider>
      <div className="tab-content">
        <AcademyTab />
      </div>
    </Tooltip.Provider>,
  );

describe("Hoot's welcome", () => {
  it('plays when the tab opens, then fades into the hub; not again when switching back', async () => {
    act(() => {
      useTabs.getState().openSpecial('academy');
    });
    expect(academy().welcome).toBe(true);
    const { container, unmount } = renderTab();
    const welcome = container.querySelector('.academy-welcome');
    expect(welcome).toHaveTextContent("Welcome toHoot's Academy");
    expect(welcome).toHaveAttribute('aria-hidden', 'true');
    // The hub is there under it.
    expect(screen.getByRole('heading', { name: "Hoot's Academy" })).toBeInTheDocument();
    await waitFor(
      () => {
        expect(container.querySelector('.academy-welcome')).toBeNull();
      },
      { timeout: WELCOME_MS + WELCOME_FADE_MS + 1000 },
    );
    expect(academy().welcome).toBe(false);
    // Another tab, then the Academy again: no welcome.
    unmount();
    act(() => {
      useTabs.getState().openSpecial('settings');
      useTabs.getState().openSpecial('academy');
    });
    expect(academy().welcome).toBe(false);
    expect(mock().state.ai.starts).toEqual([]);
  });

  it('is skipped by a key, and not shown at all without motion', async () => {
    act(() => {
      useTabs.getState().openSpecial('academy');
    });
    const first = renderTab();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(first.container.querySelector('.academy-welcome')).toBeNull();
    });
    first.unmount();

    await useSettings.getState().update({ learning: { effects: false } });
    act(() => {
      useTabs.getState().close('tab-academy');
      useTabs.getState().openSpecial('academy');
    });
    const second = renderTab();
    expect(second.container.querySelector('.academy-welcome')).toBeNull();
    await waitFor(() => {
      expect(academy().welcome).toBe(false);
    });
  });
});

describe('the hub', () => {
  it('lists the tutorials on the blackboard, and New tutorial walks through the wizard', async () => {
    useAcademy.setState({ welcome: false });
    renderTab();
    const board = await screen.findByRole('region', { name: 'Your tutorials' });
    expect(board).toHaveTextContent('No tutorial on the board yet.');

    const t = structuredClone(FIXTURE_SHARED_TUTORIAL.tutorial);
    t.id = '';
    await backend.saveTutorial(t);
    await act(async () => {
      await academy().refreshLibrary();
    });
    const list = within(board).getByRole('list', { name: 'Tutorials' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent(t.title);

    // New tutorial: step 1, the subject.
    await userEvent.click(screen.getByRole('button', { name: 'New tutorial' }));
    expect(academy().screen).toBe('create');
    const steps = screen.getByRole('list', { name: 'New tutorial steps' });
    expect(within(steps).getByText('Subject').closest('li')).toHaveAttribute(
      'aria-current',
      'step',
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'What do you want to learn?' }),
      'How it starts{Enter}',
    );
    // Step 2, the options: Back returns to the subject, as typed.
    expect(academy().screen).toBe('options');
    expect(
      within(screen.getByRole('list', { name: 'New tutorial steps' }))
        .getByText('Options')
        .closest('li'),
    ).toHaveAttribute('aria-current', 'step');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(academy().screen).toBe('create');
    expect(screen.getByRole('textbox', { name: 'What do you want to learn?' })).toHaveValue(
      'How it starts',
    );
    // And back to the hub.
    await userEvent.click(screen.getByRole('button', { name: 'Academy' }));
    expect(academy().screen).toBe('home');
    expect(mock().state.ai.starts).toEqual([]);
  });
});

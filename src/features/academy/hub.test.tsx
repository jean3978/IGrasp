// The Academy's hub: Hoot's welcome when the tab opens (once, skipped without motion), the
// classroom with the tutorials on the blackboard (details behind a button), and "New tutorial"
// into the wizard (role, subject, options, confirmation). None of it calls the AI.

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import { useAcademy } from '../../stores/academy';
import { useAiProvider } from '../../stores/aiProvider';
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
    // The welcome plays in full: longer than the default test timeout allows for comfort.
  }, 10_000);

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

describe('subjects found for the role', () => {
  it('asks for the role, keeps the subjects with it, and shows them in their own section', async () => {
    await useAiProvider.getState().checkStatus();
    await act(async () => {
      await academy().refreshSubjects();
    });
    academy().startNew();
    academy().chooseRole('Level designer');
    await act(async () => {
      await academy().prepareSuggest();
    });
    expect(academy().pending?.request).toEqual({ kind: 'suggest', role: 'Level designer' });
    expect(academy().pending?.title).toBe('Find subjects for a Level designer');
    expect(mock().state.ai.starts).toEqual([]);
    await act(async () => {
      await academy().confirmStart();
    });
    await waitFor(() => {
      expect(academy().subjects?.cards.some((c) => c.forRole === 'Level designer')).toBe(true);
    });
    expect(mock().state.ai.starts).toEqual(['subjectSuggestion']);

    useAcademy.setState({ screen: 'create', welcome: false });
    renderTab();
    const forRole = screen.getByRole('region', {
      name: 'Subjects for a Level designer, found by Hoot',
    });
    const suggested = academy().subjects?.cards.filter((c) => c.kind === 'suggested') ?? [];
    const first = suggested[0];
    if (!first) throw new Error('no suggestion');
    expect(within(forRole).getByRole('button', { name: new RegExp(first.title) })).toBeVisible();
    expect(
      within(forRole).getByRole('button', { name: /^Find more subjects for a Level designer/ }),
    ).toBeInTheDocument();
    // Not among the ready-made subjects, nor for another role.
    const ready = screen.getByRole('region', { name: 'Ready-made subjects' });
    expect(within(ready).queryByRole('button', { name: new RegExp(first.title) })).toBeNull();
    act(() => {
      academy().chooseRole('Artist');
    });
    expect(screen.queryByRole('button', { name: new RegExp(first.title) })).not.toBeInTheDocument();
  });
});

describe('the library', () => {
  it('takes in the shared tutorials when the graph is ready, while the Academy still loads', async () => {
    mock().addSharedTutorial();
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await waitFor(() => {
      expect(mock().state.graph).not.toBeNull();
    });
    act(() => {
      useTabs.getState().openSpecial('academy');
    });
    // The tab's first listing ran before the graph, and its subjects are not there yet.
    useAcademy.setState({ welcome: false, library: [], subjects: null });
    mock().emit('graph://ready', {
      generation: 1,
      docs: 1,
      links: 0,
      brokenCount: 0,
      elapsedMs: 1,
      skipped: 0,
    });
    await waitFor(() => {
      expect(academy().library.map((t) => t.reference.type)).toContain('shared');
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
    // Concise: the title, who it is for and its subject; progress and difficulty as icons.
    const row = within(list).getByRole('button', { name: new RegExp(`^${t.title}`) });
    expect(row).toHaveTextContent(`${t.role ?? 'Developer'} · ${t.subject}`);
    expect(within(row).getByRole('img', { name: /^Difficulty \d of 3: / })).toBeInTheDocument();
    expect(
      within(row).getByRole('img', { name: /steps done$|^Graduated$|^Outline only/ }),
    ).toBeInTheDocument();
    expect(row).not.toHaveTextContent('private');
    // Private or shared, as a badge on the progress ring.
    expect(within(row).getByRole('img', { name: "Private, in the app's data" })).toHaveClass(
      'lucide-lock',
    );
    // Each mark explains itself on hover; hovering the row shows no card.
    await userEvent.hover(within(row).getByRole('img', { name: /^Difficulty \d of 3: / }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Difficulty \d of 3: /);
    await userEvent.unhover(within(row).getByRole('img', { name: /^Difficulty \d of 3: / }));
    // The rest behind Details: progress, where it lives, freshness, verification.
    await userEvent.click(within(list).getByRole('button', { name: `Details of ${t.title}` }));
    const card = await screen.findByRole('dialog', { name: `Details of ${t.title}` });
    expect(within(card).getByRole('progressbar', { name: 'Progress' })).toBeInTheDocument();
    expect(card).toHaveTextContent(/Private, in the app's data|Shared in the project/);
    expect(card).toHaveTextContent(/Sources up to date|updated since you read it|outdated/i);
    expect(card).toHaveTextContent(/Verified on|Not verified yet/);
    await userEvent.keyboard('{Escape}');
    // Details is a labelled pill; the other actions are compact icon buttons with names.
    expect(within(list).getByRole('button', { name: `Details of ${t.title}` })).toHaveTextContent(
      'Details',
    );
    // Share and Save as… explain how they differ, without the title (it is right beside them).
    const tip = async (name: string, says: RegExp) => {
      const button = within(list).getByRole('button', { name });
      await userEvent.hover(button);
      const text = (await screen.findByRole('tooltip', { name: says })).textContent;
      await userEvent.unhover(button);
      await userEvent.keyboard('{Escape}');
      return text;
    };
    const share = await tip(`Share ${t.title} with the project`, /^Share with the team/);
    expect(share).toContain("into the project's tutorials folder");
    expect(share).toContain('sharing again updates the same files');
    const saveAs = await tip(`Save ${t.title} as…`, /^Save a copy as markdown/);
    expect(saveAs).toMatch(/any folder you choose: a one-off snapshot, not linked/);
    for (const text of [share, saveAs]) expect(text).not.toContain(t.title);
    expect(within(list).getByRole('button', { name: `Delete ${t.title}` })).toHaveClass(
      'icon-button',
    );

    const current = (label: string) =>
      expect(
        within(screen.getByRole('list', { name: 'New tutorial steps' }))
          .getByText(label)
          .closest('li'),
      ).toHaveAttribute('aria-current', 'step');

    // New tutorial: step 1, the role.
    await userEvent.click(screen.getByRole('button', { name: 'New tutorial' }));
    expect(academy().screen).toBe('role');
    current('Role');
    const roles = screen.getByRole('radiogroup', { name: 'Roles' });
    expect(screen.getByRole('button', { name: /^Next/ })).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Other role' }), 'Level designer');
    expect(within(roles).queryByRole('radio', { checked: true })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Next/ }));
    // Step 2, the subject, for that role.
    expect(academy().screen).toBe('create');
    expect(academy().setup.role).toBe('Level designer');
    current('Subject');
    expect(screen.getByText(/Choose what to learn as a Level designer/)).toBeInTheDocument();
    // Three ways, in this order: typed, found by Hoot for the role, ready-made.
    const ways = screen
      .getAllByRole('region')
      .filter((r) => r.classList.contains('academy-way'))
      .map((r) => r.getAttribute('aria-labelledby'))
      .map((id) => (id ? document.getElementById(id)?.textContent : null));
    expect(ways).toEqual([
      'What do you want to learn?',
      'Subjects for a Level designer, found by Hoot',
      'Ready-made subjects',
    ]);
    const forRole = screen.getByRole('region', {
      name: 'Subjects for a Level designer, found by Hoot',
    });
    expect(within(forRole).getByText('No subject found for a Level designer yet.')).toBeVisible();
    expect(
      within(forRole).getByRole('button', { name: /^Find subjects for a Level designer/ }),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'What do you want to learn?' }),
      'How it starts{Enter}',
    );
    // Step 3, the options: Back returns to the subject, as typed, then to the role.
    expect(academy().screen).toBe('options');
    current('Options');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(academy().screen).toBe('create');
    expect(screen.getByRole('textbox', { name: 'What do you want to learn?' })).toHaveValue(
      'How it starts',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(academy().screen).toBe('role');
    expect(screen.getByRole('textbox', { name: 'Other role' })).toHaveValue('Level designer');
    // And back to the hub.
    await userEvent.click(screen.getByRole('button', { name: 'Academy' }));
    expect(academy().screen).toBe('home');
    expect(mock().state.ai.starts).toEqual([]);
  });
});

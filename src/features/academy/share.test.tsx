// Sharing a tutorial with the project (plan §4.8): the plan lists the files before anything is
// written, the write puts them on the (fake) disk, the library lists it once (shared as), a shared
// tutorial reads back as it was written and updates in place; Save as… can be dismissed. Then the
// preview of the shared files: the banner and the folded step cards. Nothing here calls the AI.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import { BackendError } from '../../ipc/types';
import type { Tutorial } from '../../ipc/types';
import { normalizeTutorial } from '../../lib/tutorial';
import { useAcademy } from '../../stores/academy';
import { useTabs } from '../../stores/tabs';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { useWorkspace } from '../../stores/workspace';
import { MarkdownPreview } from '../preview/MarkdownPreview';
import { renderMarkdown } from '../preview/pipeline/processor';
import { WriteConfirmDialog } from './WriteConfirmDialog';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};

/** The fixture's tutorial, saved privately as a new one (its id, date and hashes). */
async function savedPrivately(): Promise<Tutorial> {
  const t = structuredClone(FIXTURE_SHARED_TUTORIAL.tutorial);
  t.id = '';
  t.generated = '';
  return (await backend.saveTutorial(t)).tutorial;
}

beforeEach(async () => {
  mock().reset();
  useTutorialWrite.setState({ pending: null, busy: false, error: null });
  useAcademy.getState().leaveFolder();
  useTabs.setState({ tabs: [], activeId: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

describe('sharing with the project', () => {
  it('plans, confirms, writes the files and lists the shared copy', async () => {
    const t = await savedPrivately();
    render(<WriteConfirmDialog />);
    await useTutorialWrite.getState().prepare({ type: 'share', id: t.id }, t.title);
    // Planning wrote nothing.
    const folder = FIXTURE_SHARED_TUTORIAL.folder;
    expect(mock().state.files.has(`${folder}/README.md`)).toBe(false);
    const dialog = await screen.findByRole('dialog', { name: 'Share with the project' });
    expect(dialog).toHaveTextContent(`${folder}/`);
    const files = within(dialog).getByRole('list', { name: 'Files' });
    expect(within(files).getAllByRole('listitem')).toHaveLength(5);
    expect(files).toHaveTextContent('README.md');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Share' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(mock().state.files.get(`${folder}/README.md`)).toContain('igrasp: tutorial');
    expect(mock().state.files.has(`${folder}/02-build-and-test-with-the-makefile.md`)).toBe(true);

    // Once the graph knows the shared copy, it is the same tutorial: one row, the private one,
    // tagged "shared as".
    await waitFor(() => {
      expect(mock().state.graph?.has(`${folder}/README.md`)).toBe(true);
    });
    const list = await backend.listTutorials();
    expect(list.map((s) => s.reference)).toEqual([{ type: 'private', id: t.id }]);
    expect(list[0]?.sharedAs).toBe(`${folder}/README.md`);
    const back = await backend.getTutorial({ type: 'shared', relPath: `${folder}/README.md` });
    expect(back).toEqual(normalizeTutorial(t));
    // Sharing again: the same folder, nothing to write.
    const again = await backend.planTutorialWrite({ type: 'share', id: t.id });
    expect(again.folder).toBe(folder);
    expect(again.files.every((f) => f.state === 'unchanged')).toBe(true);
    expect(mock().state.ai.starts).toEqual([]);
  });

  it('refuses a folder that holds another tutorial', async () => {
    const t = await savedPrivately();
    mock().addSharedTutorial({ ...FIXTURE_SHARED_TUTORIAL.tutorial, id: 'someone-elses' });
    await expect(backend.planTutorialWrite({ type: 'share', id: t.id })).rejects.toMatchObject({
      code: 'TutorialFolderTaken',
    });
  });

  it('updates a shared tutorial in place, only with the same tutorial', async () => {
    const readme = mock().addSharedTutorial();
    const t = await backend.getTutorial({ type: 'shared', relPath: readme });
    const changed = { ...t, intro: 'A new intro for the readers of igrasp-demo.' };
    const target = { type: 'shared', relPath: readme } as const;
    const plan = await backend.planTutorialWrite(target, changed);
    expect(plan.files.filter((f) => f.state !== 'unchanged').map((f) => f.name)).toEqual([
      'README.md',
    ]);
    await backend.writeTutorial(target, changed);
    expect(mock().state.files.get(readme)).toContain('A new intro for the readers');
    await expect(
      backend.planTutorialWrite(target, { ...changed, id: 'another' }),
    ).rejects.toBeInstanceOf(BackendError);
  });

  it('Save as… writes a copy where the user chose, or nothing when dismissed', async () => {
    const t = await savedPrivately();
    mock().state.exportFolderResult = '';
    await useTutorialWrite.getState().prepare({ type: 'export', id: t.id }, t.title);
    expect(await useTutorialWrite.getState().confirm()).toBeNull();
    expect(mock().state.exported).toEqual([]);
    mock().state.exportFolderResult = '/elsewhere/exports';
    const written = await useTutorialWrite.getState().confirm();
    expect(written?.readme).toBeNull();
    expect(mock().state.exported[0]?.folder).toBe(
      '/elsewhere/exports/how-igrasp-demo-starts-a-tour-of-igrasp-demo',
    );
  });
});

describe('shared tutorial files in the preview', () => {
  it('shows the banner and folded step cards, and opens the Academy on it', async () => {
    const readme = mock().addSharedTutorial();
    const folder = FIXTURE_SHARED_TUTORIAL.folder;
    const show = async (rel: string) =>
      render(
        <MarkdownPreview
          rendered={await renderMarkdown(mock().state.files.get(rel) ?? '')}
          relPath={rel}
        />,
      );
    const { unmount } = await show(readme);
    const banner = screen.getByRole('region', { name: 'Tutorial file' });
    expect(banner).toHaveTextContent('4 chapters');
    unmount();

    const { container } = await show(`${folder}/02-build-and-test-with-the-makefile.md`);
    expect(screen.getByRole('region', { name: 'Tutorial file' })).toHaveTextContent(
      'Build and test with the Makefile',
    );
    expect(container.querySelector('.front-matter')).toBeNull();
    const order = screen.getByRole('group', { name: 'Put in order' });
    const answer = order.querySelector('details');
    expect(answer?.open).toBe(false);
    expect(screen.getByRole('group', { name: 'Match' })).toBeInTheDocument();
    const tryIt = screen.getByRole('group', { name: 'Try it yourself' });
    expect(within(tryIt).getByText('make test')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Take it in the Academy/ }));
    await waitFor(() => {
      expect(useAcademy.getState().open).toEqual({ type: 'shared', relPath: readme });
    });
    expect(useTabs.getState().tabs.some((tab) => tab.kind === 'academy')).toBe(true);
  });

  it('opens your own unchanged shared copy as your private tutorial, its row on the board', async () => {
    const t = await savedPrivately();
    const readme = await sharedWithTheProject(t);
    render(
      <MarkdownPreview
        rendered={await renderMarkdown(mock().state.files.get(readme) ?? '')}
        relPath={readme}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Take it in the Academy/ }));
    await waitFor(() => {
      expect(useAcademy.getState().open).toEqual({ type: 'private', id: t.id });
    });
  });
});

/** Shares `t` (no dialog) and waits for the graph to know the README. */
async function sharedWithTheProject(t: Tutorial): Promise<string> {
  const written = await backend.writeTutorial({ type: 'share', id: t.id });
  const readme = written.readme ?? '';
  await waitFor(() => {
    expect(mock().state.graph?.has(readme)).toBe(true);
  });
  return readme;
}

describe('your shared copy on the board', () => {
  it('is listed on its own once it changed since, and the private one says so', async () => {
    const t = await savedPrivately();
    const readme = await sharedWithTheProject(t);
    expect((await backend.listTutorials())[0]?.sharedDiffers).toBe(false);
    // A teammate changed the shared copy (an accepted review), and it was pulled.
    const theirs = { ...normalizeTutorial(t), intro: 'A better intro, from a teammate.' };
    mock().addSharedTutorial(theirs);
    await waitFor(async () => {
      const list = await backend.listTutorials();
      expect(list.map((s) => s.reference)).toEqual([
        { type: 'private', id: t.id },
        { type: 'shared', relPath: readme },
      ]);
      expect(list.map((s) => s.sharedDiffers)).toEqual([true, false]);
    });
    // Updating it from the private one would replace their README: the plan says so.
    const plan = await backend.planTutorialWrite({ type: 'share', id: t.id });
    expect(plan.files.find((f) => f.name === 'README.md')?.state).toBe('changed');
  });

  it('keeps your progress when you delete the private copy', async () => {
    const t = await savedPrivately();
    const readme = await sharedWithTheProject(t);
    await backend.saveTutorialProgress({
      tutorialId: t.id,
      startedMs: 1,
      lastOpenedMs: 2,
      finishedMs: null,
      chapter: 0,
      step: 1,
      completed: {},
      answers: {},
      xp: 25,
      streak: 0,
      bestStreak: 0,
      chaptersDone: [],
      graduated: false,
    });
    await backend.deleteTutorial(t.id);
    const list = await backend.listTutorials();
    expect(list.map((s) => s.reference)).toEqual([{ type: 'shared', relPath: readme }]);
    expect(list[0]?.progress?.xp).toBe(25);
  });
});

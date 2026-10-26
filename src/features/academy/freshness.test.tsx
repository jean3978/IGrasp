// The local freshness check (no token), like Rust's: moved lines are relocated (saved for a
// private tutorial, offered for a shared one), a changed range marks the steps citing it, a gone
// file makes sources missing. Then the reader's panel and the course map's marks.

import { render, screen, waitFor, within } from '@testing-library/react';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import type { Tutorial } from '../../ipc/types';
import { useAcademy } from '../../stores/academy';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { useWorkspace } from '../../stores/workspace';
import { TutorialView } from './TutorialView';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};
const file = (p: string) => mock().state.files.get(p) ?? '';

beforeEach(async () => {
  mock().reset();
  useAcademy.getState().leaveFolder();
  useTutorialPlayer.getState().close();
  useTutorialWrite.setState({ pending: null, busy: false, error: null });
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

describe('the freshness check', () => {
  it('offers the moved citations of a shared tutorial without writing them', async () => {
    const readme = mock().addSharedTutorial();
    const ref = { type: 'shared', relPath: readme } as const;
    expect((await backend.checkTutorialFreshness(ref)).badge).toEqual({ badge: 'upToDate' });

    mock().writeFiles({ Makefile: `# The targets\n${file('Makefile')}` });
    const before = file(readme);
    const moved = await backend.checkTutorialFreshness(ref);
    expect(moved.badge).toEqual({ badge: 'upToDate' });
    expect(moved.checks.filter((c) => c.state === 'moved').map((c) => c.lines)).toEqual([
      '1-5',
      '4-5',
    ]);
    expect(moved.relocatedSaved).toBe(0);
    const relocated = moved.relocated;
    if (!relocated) throw new Error('no relocation offered');
    expect(file(readme)).toBe(before);
    expect(relocated.sources.find((s) => s.path === 'Makefile')?.lines).toBe('2-6');

    await backend.writeTutorial({ type: 'shared', relPath: readme }, relocated);
    const after = await backend.checkTutorialFreshness(ref);
    expect(after.checks.every((c) => c.state === 'upToDate')).toBe(true);
    expect(after.relocated).toBeNull();
  });

  it('relocates and saves a private tutorial, and marks changed and missing sources', async () => {
    const t = structuredClone(FIXTURE_SHARED_TUTORIAL.tutorial);
    t.id = '';
    const saved: Tutorial = (await backend.saveTutorial(t)).tutorial;
    const ref = { type: 'private', id: saved.id } as const;
    mock().writeFiles({ Makefile: `# The targets\n${file('Makefile')}` });
    const moved = await backend.checkTutorialFreshness(ref);
    expect(moved.relocatedSaved).toBeGreaterThan(0);
    expect(moved.relocated).toBeNull();
    expect((await backend.checkTutorialFreshness(ref)).relocatedSaved).toBe(0);

    mock().writeFiles({ 'src/main.ts': file('src/main.ts').replace('toUpperCase', 'toLowerCase') });
    const changed = await backend.checkTutorialFreshness(ref);
    expect(changed.badge.badge).toBe('maybeOutdated');
    expect(changed.affected.some((s) => s.chapter === 0)).toBe(true);

    mock().deleteFiles(['.github/workflows/ci.yml']);
    expect((await backend.checkTutorialFreshness(ref)).badge.badge).toBe('sourcesMissing');
    const row = (await backend.listTutorials()).find((s) => s.id === saved.id);
    expect(row?.freshness?.badge).toBe('sourcesMissing');
    expect(mock().state.ai.starts).toEqual([]);
  });
});

describe('the freshness panel', () => {
  it('shows the badge, the changed range and the steps it affects, and marks the map', async () => {
    const readme = mock().addSharedTutorial();
    mock().writeFiles({ 'src/main.ts': file('src/main.ts').replace('toUpperCase', 'toLowerCase') });
    render(
      <Tooltip.Provider>
        <TutorialView reference={{ type: 'shared', relPath: readme }} motion={false} />
      </Tooltip.Provider>,
    );
    const panel = await screen.findByRole('region', { name: 'Freshness of this tutorial' });
    expect(panel).toHaveTextContent(/Maybe outdated \(1 of \d+ sources changed\)/);
    expect(within(panel).getByRole('button', { name: 'src/main.ts:9-12' })).toBeInTheDocument();
    expect(panel).toHaveTextContent('Chapter 1, step 1');
    const map = screen.getByRole('list', { name: 'Chapters' });
    await waitFor(() => {
      expect(within(map).getByRole('button', { name: /Chapter 1: .*changed/ })).toBeInTheDocument();
    });
  });
});

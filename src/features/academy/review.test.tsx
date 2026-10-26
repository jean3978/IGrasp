// "Check with the AI" and "Mark as verified": the review starts only from its confirmation card,
// proposes replacements for the steps citing changed lines, and only the accepted ones change the
// tutorial. Verifying is the user's statement: a private tutorial is saved stamped; a shared one is
// written (only its README) after the write confirmation.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import type { Tutorial } from '../../ipc/types';
import { useAcademy } from '../../stores/academy';
import { useAiProvider } from '../../stores/aiProvider';
import { startEventBridge } from '../../stores/eventBridge';
import { useSettings } from '../../stores/settings';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { AcademyTab } from './AcademyTab';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};
const file = (p: string) => mock().state.files.get(p) ?? '';

async function privateCopy(): Promise<Tutorial> {
  const t = structuredClone(FIXTURE_SHARED_TUTORIAL.tutorial);
  t.id = '';
  return (await backend.saveTutorial(t)).tutorial;
}

const show = () =>
  render(
    <Tooltip.Provider>
      <AcademyTab />
    </Tooltip.Provider>,
  );

let stop = () => {};

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  resetAiStores();
  await useSettings.getState().load();
  useAcademy.getState().leaveFolder();
  useTutorialPlayer.getState().close();
  useTutorialWrite.setState({ pending: null, busy: false, error: null });
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
});

afterEach(() => {
  stop();
});

describe('Check with the AI', () => {
  it('starts from its card and applies only the accepted proposals', async () => {
    const t = await privateCopy();
    mock().writeFiles({ 'src/main.ts': file('src/main.ts').replace('toUpperCase', 'toLowerCase') });
    useAcademy.getState().openTutorial({ type: 'private', id: t.id });
    show();
    const panel = await screen.findByRole('region', { name: 'Freshness of this tutorial' });
    await userEvent.click(within(panel).getByRole('button', { name: /Check with the AI/ }));
    // The confirmation card: nothing started yet.
    await screen.findByRole('button', { name: /^Start/ });
    expect(mock().state.ai.starts).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    await waitFor(() => {
      expect(useAcademy.getState().screen).toBe('review');
    });
    expect(mock().state.ai.starts).toEqual(['tutorialReview']);

    const chapter = screen.getByRole('region', { name: /^Chapter 1:/ });
    expect(chapter).toHaveTextContent('outdated');
    const proposals = within(chapter).getAllByRole('article');
    expect(proposals.length).toBeGreaterThanOrEqual(2);
    const [first, second] = proposals as [HTMLElement, HTMLElement];
    await userEvent.click(within(first).getByRole('button', { name: /Accept/ }));
    second.focus();
    await userEvent.keyboard('r');
    expect(second).toHaveAttribute('data-decision', 'rejected');
    expect(screen.getByRole('region', { name: 'Missing topics' })).toHaveTextContent(
      'How igrasp-demo is deployed',
    );
    await userEvent.click(screen.getByRole('button', { name: /Save 1 accepted change/ }));
    await waitFor(() => {
      expect(useAcademy.getState().screen).toBe('tutorial');
    });
    const after = await backend.getTutorial({ type: 'private', id: t.id });
    const changed = after.chapters[0]?.steps.map(
      (s, i) => JSON.stringify(s) !== JSON.stringify(t.chapters[0]?.steps[i]),
    );
    expect(changed?.filter(Boolean)).toHaveLength(1);
    expect(mock().state.ai.starts).toEqual(['tutorialReview']);
  });

  it('retries a review whose proposal points at no step', async () => {
    const t = await privateCopy();
    mock().state.ai.tutorialScript = 'retry';
    await useAcademy.getState().prepareReview({ type: 'private', id: t.id });
    await useAcademy.getState().confirmStart();
    await waitFor(() => {
      expect(useAcademy.getState().screen).toBe('review');
    });
    expect(useAcademy.getState().review?.result.rejectedCount).toBe(1);
  });
});

describe('Mark as verified', () => {
  it('writes only the README of a shared tutorial, after the confirmation', async () => {
    const readme = mock().addSharedTutorial();
    const chapters = [...mock().state.files.entries()].filter(
      ([p]) => p.startsWith(FIXTURE_SHARED_TUTORIAL.folder) && !p.endsWith('README.md'),
    );
    useAcademy.getState().openTutorial({ type: 'shared', relPath: readme });
    show();
    const panel = await screen.findByRole('region', { name: 'Freshness of this tutorial' });
    await userEvent.click(within(panel).getByRole('button', { name: /Mark as verified…/ }));
    const group = within(panel).getByRole('group', { name: 'Mark as verified?' });
    expect(group).toHaveTextContent('records the date, the commit and your name');
    await userEvent.click(within(group).getByRole('button', { name: 'Mark as verified' }));
    const dialog = await screen.findByRole('dialog', { name: 'Update the shared tutorial' });
    expect(file(readme)).not.toContain('verified:');
    const changed = within(dialog)
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('data-state') !== 'unchanged');
    expect(changed.map((li) => li.querySelector('code')?.textContent)).toEqual(['README.md']);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Write' }));
    await waitFor(() => {
      expect(file(readme)).toContain('verified:');
    });
    for (const [p, text] of chapters) expect(file(p)).toBe(text);
    expect(file(readme)).toContain('Demo Reader');
    expect(mock().state.ai.starts).toEqual([]);
  });
});

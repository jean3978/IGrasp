// Taking a tutorial: the player store (progress saved after every step, resumed on reopening),
// the course map and the steps with the keyboard, and the rules of the interactive steps. Reading
// never calls the AI.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type {
  AiEvent,
  MatchStep,
  OutlineResult,
  PutInOrderStep,
  Tutorial,
  TryItStep,
} from '../../ipc/types';
import { useAcademy } from '../../stores/academy';
import { useSettings } from '../../stores/settings';
import { useTextFiles } from '../../stores/textFiles';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { TutorialView } from './TutorialView';
import { Match, PutInOrder } from './steps/OrderSteps';
import { TryIt } from './steps/ActionSteps';
import type { StepProps } from './steps/types';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};

/** A tutorial written by the mock AI: the outline, then every chapter (two operations). */
async function written(): Promise<Tutorial> {
  const run = async (tutorial: Parameters<typeof backend.aiStart>[1]['tutorial']) => {
    const events: AiEvent[] = [];
    let id = -1;
    const done = new Promise<void>((resolve) => {
      void backend.listen('ai://event', (e) => {
        if (id >= 0 && e.operationId !== id) return;
        events.push(e.event);
        if (e.event.type === 'done') resolve();
      });
    });
    id = await backend.aiStart('tutorialGeneration', {
      prompt: '',
      contextPaths: [],
      images: [],
      policy: 'readOnly',
      ...(tutorial ? { tutorial } : {}),
    });
    await done;
    return events.flatMap((e) => (e.type === 'structuredOutput' ? [e.value as unknown] : []));
  };
  const [outline] = (await run({
    kind: 'outline',
    input: {
      subject: 'How igrasp-demo starts',
      subjectId: null,
      picks: [],
      familiarity: 'newHere',
      domainGap: null,
      length: 'standard',
      role: null,
    },
  })) as [OutlineResult];
  let t = (
    await backend.saveTutorial({
      id: '',
      title: outline.title,
      intro: outline.intro,
      project: 'igrasp-demo',
      subject: 'How igrasp-demo starts',
      familiarity: 'newHere',
      length: 'standard',
      generated: '',
      provider: '',
      model: 'mock-fast',
      chapters: outline.chapters,
      sources: [],
    })
  ).tutorial;
  const chapters = (await run({
    kind: 'chapters',
    id: t.id,
    indices: t.chapters.map((_, i) => i),
  })) as { chapter: Tutorial['chapters'][number] }[];
  t = (await backend.saveTutorial({ ...t, chapters: chapters.map((c) => c.chapter) })).tutorial;
  return t;
}

const player = () => useTutorialPlayer.getState();

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  resetAiStores();
  useTextFiles.getState().clear();
  await useSettings.getState().load();
  useAcademy.getState().leaveFolder();
  player().close();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

describe('the player store', () => {
  it('saves the progress after every step and resumes where the reader left', async () => {
    const t = await written();
    const starts = mock().state.ai.starts.length;
    await player().load({ type: 'private', id: t.id });
    expect(player().chapter).toBeNull();
    player().openChapter(0);
    expect(player().step).toBe(0);
    player().complete({ kind: 'read' });
    expect(player().step).toBe(1);
    expect(player().progress?.xp).toBe(5);
    await waitFor(async () => {
      expect((await backend.getTutorialProgress(t.id))?.completed).toHaveProperty('c1:0');
    });
    // Reopened later: the same chapter and step.
    player().close();
    await player().load({ type: 'private', id: t.id });
    player().openChapter(0);
    expect(player().step).toBe(1);
    expect(mock().state.ai.starts.length).toBe(starts);
  });
});

describe('reading with the keyboard', () => {
  it('opens a chapter from the map, reads, tours and spots the line', async () => {
    const t = await written();
    render(
      <Tooltip.Provider>
        <TutorialView reference={{ type: 'private', id: t.id }} motion={false} />
      </Tooltip.Provider>,
    );
    const map = await screen.findByRole('list', { name: 'Chapters' });
    const current = within(map).getByRole('button', { name: /Chapter 1: .*current/ });
    expect(
      within(map).getByRole('button', { name: /Chapter 2: .*not reached yet/ }),
    ).toHaveAttribute('aria-disabled', 'true');
    current.focus();
    fireEvent.keyDown(current, { key: 'ArrowDown' });
    expect(document.activeElement).toHaveAccessibleName(/Chapter 2/);
    await userEvent.click(current);

    // Explain: Enter goes on.
    const explain = await screen.findByRole('article', { name: /^Explain:/ });
    fireEvent.keyDown(document.activeElement ?? explain, { key: 'Enter' });
    // Code tour: three stops, → each, the last one goes on.
    const tour = await screen.findByRole('article', { name: /^Code tour:/ });
    expect(within(tour).getByText('Stop 1 of 3')).toBeInTheDocument();
    for (let i = 0; i < 3; i++)
      fireEvent.keyDown(document.activeElement ?? tour, { key: 'ArrowRight' });
    // Spot it: ↓ ↓ Enter picks line 11, the right one.
    const spot = await screen.findByRole('article', { name: /^Spot it:/ });
    await waitFor(() => {
      expect(within(spot).getAllByRole('button', { name: /^Line \d+/ })).toHaveLength(4);
    });
    const body = document.activeElement ?? spot;
    fireEvent.keyDown(body, { key: 'ArrowDown' });
    fireEvent.keyDown(body, { key: 'ArrowDown' });
    fireEvent.keyDown(body, { key: 'Enter' });
    expect(await within(spot).findByText('Spot on.')).toBeInTheDocument();
    expect(player().progress?.xp).toBe(5 + 10 + 20);
    expect(player().progress?.answers['c1:2']).toMatchObject({ right: true, firstTry: true });
    // Escape: back to the map.
    act(() => {
      fireEvent.keyDown(document.activeElement ?? spot, { key: 'Escape' });
    });
    expect(await screen.findByRole('list', { name: 'Chapters' })).toBeInTheDocument();
    expect(mock().state.ai.starts).toHaveLength(2);
  });
});

const props = (over: Partial<StepProps> = {}): StepProps => ({
  stepKey: 'c1:3',
  done: false,
  answer: undefined,
  sources: [{ path: 'Makefile', firstLine: 1, lastLine: 5 }],
  sourceStatus: {},
  first: false,
  motion: false,
  onComplete: vi.fn(),
  onNext: vi.fn(),
  onPrevious: vi.fn(),
  onEscape: vi.fn(),
  ...over,
});

describe('the interactive steps', () => {
  const order: PutInOrderStep = {
    title: 'From a push to the tests',
    prompt: 'Put it in order.',
    items: ['ci.yml starts', 'make test', 'npm test', 'vitest run'],
    explanation: 'In this order.',
    sources: [],
  };

  it('puts in order with Space and the arrows, and shows the answer after two tries', () => {
    const p = props();
    render(<PutInOrder step={order} props={p} />);
    const items = () => screen.getAllByRole('listitem');
    const labels = () => items().map((li) => li.getAttribute('aria-label')?.replace(/^\d\. /, ''));
    const before = labels();
    const first = items()[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: ' ' });
    expect(items()[0]).toHaveAccessibleName(/picked up/);
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(labels()[1]?.replace(' (picked up)', '')).toBe(before[0]);
    fireEvent.keyDown(document.activeElement ?? first, { key: ' ' });
    // Two wrong checks (unless the shuffle happens to be right).
    const right = () => labels().every((l, i) => l === order.items[i]);
    if (!right()) {
      fireEvent.keyDown(items()[0] as HTMLElement, { key: 'Enter' });
      if (!right()) fireEvent.keyDown(items()[0] as HTMLElement, { key: 'Enter' });
    }
    expect(screen.getByText(/Here is the answer|Exactly right|Got it/)).toBeInTheDocument();
    expect(labels()).toEqual(order.items);
    expect(p.onComplete).toHaveBeenCalledTimes(1);
  });

  const match: MatchStep = {
    title: 'Which file does what',
    prompt: 'Match them.',
    pairs: [
      { left: 'Makefile', right: 'names the targets' },
      { left: 'package.json', right: 'maps the scripts' },
      { left: 'ci.yml', right: 'runs on push' },
    ],
    explanation: 'Each file has one job.',
    sources: [],
  };

  it('matches pairs, unpairs with Backspace, and scores a right first check', async () => {
    const p = props({ stepKey: 'c2:2' });
    render(<Match step={match} props={p} />);
    const check = screen.getByRole('button', { name: /Check/ });
    expect(check).toBeDisabled();
    for (const pair of match.pairs) {
      await userEvent.click(screen.getByRole('button', { name: pair.left }));
      await userEvent.click(screen.getByRole('button', { name: pair.right }));
    }
    const makefile = screen.getByRole('button', {
      name: /^Makefile, matched with names the targets/,
    });
    fireEvent.keyDown(makefile, { key: 'Backspace' });
    expect(screen.getByRole('button', { name: 'Makefile' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Makefile' }));
    await userEvent.click(screen.getByRole('button', { name: /names the targets/ }));
    await userEvent.click(screen.getByRole('button', { name: /Check/ }));
    expect(screen.getByText('Exactly right.')).toBeInTheDocument();
    expect(p.onComplete).toHaveBeenCalledWith(
      { kind: 'answered', right: true, tries: 1, usedHint: false },
      true,
    );
  });

  it('never runs a try-it command: C copies it, S skips', async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText: write } });
    const step: TryItStep = {
      title: 'Run the tests',
      instruction: 'Run the test target.',
      command: 'make test',
      where: 'terminal',
      sources: [{ path: 'Makefile', firstLine: 4, lastLine: 5 }],
    };
    const p = props();
    const { container } = render(<TryIt step={step} props={p} />);
    const body = container.querySelector('.academy-step-body') as HTMLElement;
    fireEvent.keyDown(body, { key: 'c' });
    await waitFor(() => {
      expect(write).toHaveBeenCalledWith('make test');
    });
    fireEvent.keyDown(body, { key: 's' });
    expect(p.onComplete).toHaveBeenCalledWith({ kind: 'skipped' });
    expect(mock().state.ai.starts).toEqual([]);
  });
});

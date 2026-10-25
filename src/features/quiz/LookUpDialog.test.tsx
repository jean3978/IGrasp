import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useAiProvider } from '../../stores/aiProvider';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { useSettings } from '../../stores/settings';
import { useTextFiles } from '../../stores/textFiles';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { QuestionScreen } from './QuestionScreen';

const quiz = () => useQuiz.getState();

beforeEach(async () => {
  window.__igraspMock?.reset();
  resetAiStores();
  useProjectProfile.getState().clear();
  useTextFiles.getState().clear();
  await useSettings.getState().load();
  quiz().leaveFolder();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
  // The fixture's quiz file: its first question cites src/main.ts, lines 9-12.
  await quiz().playFile('quizzes/quiz-architecture.md');
});

describe('Look it up', () => {
  it('opens the cited file before the answer, keeps the keys to itself, and is recorded', async () => {
    render(
      <Tooltip.Provider>
        <QuestionScreen motion />
      </Tooltip.Provider>,
    );
    const card = screen.getByRole('article');
    expect(within(card).getByRole('heading')).toHaveTextContent('main()');
    fireEvent.keyDown(card, { key: 'l' });

    const dialog = await screen.findByRole('dialog', { name: 'Look it up' });
    expect(within(dialog).getByText('src/main.ts')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole('region', { name: /src\/main\.ts/ })).toHaveTextContent(
        'export function main',
      );
    });
    expect(within(dialog).getByRole('img', { name: /Hoot/ })).toBeInTheDocument();
    expect(dialog.querySelector('.hoot[data-follow]')).not.toBeNull();

    // Keys typed in the window are not answers (the portal bubbles through the card in React).
    fireEvent.keyDown(dialog, { key: '1' });
    expect(quiz().engine?.chosen).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back to the question' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(quiz().screen).toBe('question');
    expect(screen.getByRole('button', { name: /Look again/ })).toBeInTheDocument();

    // The answer records it; the level ignores it.
    const q = quiz().record?.questions.find((x) => x.id === quiz().engine?.current);
    quiz().answer(q?.answer ?? 0);
    expect(quiz().record?.answers.at(-1)).toMatchObject({ lookedUp: true, correct: true });
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Look (it up|again)/ })).toBeNull();
    });
  });

  it('follows the pointer with the eyes', async () => {
    render(
      <Tooltip.Provider>
        <QuestionScreen motion />
      </Tooltip.Provider>,
    );
    fireEvent.keyDown(screen.getByRole('article'), { key: 'l' });
    const dialog = await screen.findByRole('dialog', { name: 'Look it up' });
    const svg = dialog.querySelector<SVGSVGElement>('.hoot-svg');
    const gaze = dialog.querySelector<SVGGElement>('.hoot-gaze');
    if (!svg || !gaze) throw new Error('no Hoot');
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      top: 100,
      width: 120,
      height: 140,
    } as DOMRect);
    // Looking down at the file first.
    expect(gaze.style.transform).toMatch(/translate\(0px, [\d.]+px\)/);
    fireEvent.pointerMove(window, { clientX: 0, clientY: 158 });
    expect(gaze.style.transform).toBe('translate(-4.5px, 0px)');
  });
});

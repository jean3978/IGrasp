import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuizQuestion } from '../../ipc/types';
import { useTabs } from '../../stores/tabs';
import { QuestionCard } from './QuestionCard';

const mc: QuizQuestion = {
  id: 'r1-q1',
  kind: 'multipleChoice',
  question: 'Which helper does src/main.ts import to build its message?',
  choices: ['greet', 'main', 'Options'],
  answer: 0,
  hint: 'The second line of the entry point.',
  explanation: "src/main.ts imports greet from './greet'.",
  sources: [
    { path: 'src/main.ts', firstLine: 2, lastLine: 2, why: 'the import', kind: 'code' },
    { path: 'docs/architecture.md', firstLine: 10, lastLine: 12, why: null, kind: 'markdown' },
    { path: 'assets/logo.bin', firstLine: null, lastLine: null, why: null, kind: 'binary' },
  ],
  difficulty: 2,
};

const tf: QuizQuestion = {
  ...mc,
  id: 'r1-q2',
  kind: 'trueFalse',
  choices: ['True', 'False'],
  answer: 1,
};

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
});

describe('QuestionCard', () => {
  it('answers with the number keys, shows the hint with H, and leaves with Escape', () => {
    const onChoose = vi.fn();
    const onHint = vi.fn();
    const onEscape = vi.fn();
    render(
      <QuestionCard
        question={mc}
        number={1}
        total={5}
        chosen={null}
        usedHint={false}
        onChoose={onChoose}
        onHint={onHint}
        onEscape={onEscape}
      />,
    );
    const card = screen.getByRole('article');
    expect(screen.getByRole('button', { name: /greet/ })).toHaveFocus();
    fireEvent.keyDown(card, { key: 'h' });
    expect(onHint).toHaveBeenCalled();
    fireEvent.keyDown(card, { key: '3' });
    expect(onChoose).toHaveBeenCalledWith(2);
    fireEvent.keyDown(card, { key: '9' });
    expect(onChoose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { key: 'Escape' });
    expect(onEscape).toHaveBeenCalled();
  });

  it('answers a true/false question with T and F', () => {
    const onChoose = vi.fn();
    render(
      <QuestionCard
        question={tf}
        number={2}
        total={5}
        chosen={null}
        usedHint
        onChoose={onChoose}
        onHint={vi.fn()}
      />,
    );
    expect(screen.getByRole('note')).toHaveTextContent(mc.hint);
    fireEvent.keyDown(screen.getByRole('article'), { key: 'f' });
    expect(onChoose).toHaveBeenCalledWith(1);
  });

  it('reveals the verdict, the explanation and sources that open the right tab at their lines', async () => {
    const onNext = vi.fn();
    render(
      <QuestionCard
        question={mc}
        number={1}
        total={5}
        chosen={1}
        usedHint={false}
        onChoose={vi.fn()}
        onHint={vi.fn()}
        onNext={onNext}
        actions={<button className="quiz-next">Next</button>}
      />,
    );
    expect(screen.getByText('Not this time.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /greet/ })).toHaveClass('quiz-choice-right');
    expect(screen.getByRole('button', { name: /^2\s*main/ })).toHaveClass('quiz-choice-wrong');
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus();
    const sources = screen.getByRole('list', { name: 'Sources' });
    await userEvent.click(
      within(sources).getByRole('button', { name: /Read more → src\/main\.ts:2/ }),
    );
    let tab = useTabs.getState().tabs[0];
    expect(tab?.kind).toBe('code');
    expect(tab?.pending).toEqual({ line: 2, endLine: 2 });
    await userEvent.click(
      within(sources).getByRole('button', { name: 'docs/architecture.md:10-12' }),
    );
    tab = useTabs.getState().tabs.find((t) => t.kind === 'document');
    expect(tab?.relPath).toBe('docs/architecture.md');
    expect(tab?.pending).toEqual({ line: 10 });
    // A binary source is named, never opened.
    expect(within(sources).queryByRole('button', { name: /logo/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole('article'), { key: 'Enter' });
    expect(onNext).toHaveBeenCalled();
  });
});

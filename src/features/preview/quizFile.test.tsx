import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_FILES } from '../../ipc/mock/fixture';
import { useQuiz } from '../../stores/quiz';
import { useTabs } from '../../stores/tabs';
import { MarkdownPreview } from './MarkdownPreview';
import { renderMarkdown } from './pipeline/processor';

const QUIZ = FIXTURE_FILES['quizzes/quiz-architecture.md'] ?? '';

async function show(markdown: string, relPath = 'quizzes/q.md') {
  const rendered = await renderMarkdown(markdown);
  return render(<MarkdownPreview rendered={rendered} relPath={relPath} />);
}

beforeEach(() => {
  useTabs.setState({ tabs: [], activeId: null });
});

describe('quiz files in the preview', () => {
  it('shows the banner instead of the front matter, and folded question cards', async () => {
    const { container } = await show(QUIZ);
    const banner = screen.getByRole('region', { name: 'Quiz file' });
    expect(banner).toHaveTextContent('How igrasp-demo fits together');
    expect(banner).toHaveTextContent('3 questions');
    expect(container.querySelector('.front-matter')).toBeNull();
    const cards = screen.getAllByRole('group', { name: 'Quiz question' });
    expect(cards).toHaveLength(3);
    const first = cards[0];
    if (!first) throw new Error('no card');
    expect(within(first).getByText('The greeting unchanged')).toBeVisible();
    const answer = first.querySelector('details');
    expect(answer?.open).toBe(false);
    await userEvent.click(within(first).getByText('Show the answer'));
    expect(answer?.open).toBe(true);
    await userEvent.click(within(first).getByRole('button', { name: 'src/main.ts:9-12' }));
    expect(useTabs.getState().tabs[0]?.relPath).toBe('src/main.ts');
  });

  it('plays the file from the banner', async () => {
    const playFile = vi.fn(() => Promise.resolve());
    useQuiz.setState({ playFile });
    await show(QUIZ);
    await userEvent.click(screen.getByRole('button', { name: /Play this quiz/ }));
    expect(playFile).toHaveBeenCalledWith('quizzes/q.md');
    expect(useTabs.getState().tabs.some((t) => t.kind === 'quiz')).toBe(true);
  });

  it('keeps the content of a block as text, and shows a broken block as code', async () => {
    const md = [
      '---',
      'igrasp: quiz',
      '---',
      '',
      '## 1. Safe?',
      '',
      '```igrasp-quiz',
      'choices: ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"]',
      'answer: 0',
      'explanation: "<a href=\'javascript:alert(1)\'>x</a>"',
      '```',
      '',
      '```igrasp-quiz',
      'choices: [only one]',
      '```',
    ].join('\n');
    const { container } = await show(md);
    expect(container.querySelector('img, script, a[href^="javascript"]')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Quiz question' })).toHaveLength(1);
    expect(container.querySelector('pre')?.textContent).toContain('only one');
  });
});

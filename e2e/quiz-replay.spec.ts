import { expect, test } from '@playwright/test';
import {
  answerAll,
  openFixture,
  openQuiz,
  playSavedQuiz,
  quizCard,
  quizMock,
  savedMarkdown,
  startQuiz,
  treeItem,
} from './helpers';

test('the fixture quiz file plays from its banner without the AI', async ({ page }) => {
  await openFixture(page);
  await quizMock(page, (m) => {
    m.state.ai.loggedIn = false;
  });
  await treeItem(page, 'quizzes').click();
  await treeItem(page, 'quiz-architecture.md').click();
  const banner = page.getByRole('region', { name: 'Quiz file' });
  await expect(banner).toContainText('3 questions');
  // The answers are folded in the preview.
  await expect(page.getByRole('group', { name: 'Quiz question' })).toHaveCount(3);
  await expect(page.locator('.quiz-block-answer[open]')).toHaveCount(0);

  await banner.getByRole('button', { name: /Play this quiz/ }).click();
  await expect(quizCard(page)).toBeVisible();
  let notices = 0;
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('1');
    notices += await page.getByText('the source changed since this quiz was written').count();
    await page.keyboard.press('Enter');
  }
  expect(notices).toBe(1);
  await expect(page.locator('.quiz-results')).toBeVisible();
  await expect(page.getByText('Replayed: no AI call.')).toBeVisible();
  expect(await quizMock(page, (m) => m.state.ai.starts)).toEqual([]);
});

test('Save quiz… writes a file the home lists, and it replays the same questions', async ({
  page,
}) => {
  await openQuiz(page);
  await startQuiz(page, { count: 5 });
  expect(await answerAll(page)).toBe(5);
  const played = await page
    .getByRole('list', { name: 'Your answers' })
    .locator('.quiz-review-question')
    .allTextContents();

  await page.getByRole('button', { name: /Save quiz/ }).click();
  await expect(page.getByText(/Quiz saved to quizzes\//)).toBeVisible();
  const [saved] = await savedMarkdown(page);
  expect(saved?.kind).toBe('quiz');
  expect(saved?.markdown).toMatch(/^---\nigrasp: quiz\n/);

  await page.getByRole('button', { name: /New quiz/ }).click();
  const path = saved?.relPath ?? '';
  await expect(page.getByRole('region', { name: 'Saved quizzes' })).toContainText(path);
  await playSavedQuiz(page, path);
  expect(await answerAll(page)).toBe(5);
  const replayed = await page
    .getByRole('list', { name: 'Your answers' })
    .locator('.quiz-review-question')
    .allTextContents();
  expect([...replayed].sort()).toEqual([...played].sort());
  // No Save quiz… for a quiz that is already a file.
  await expect(page.getByRole('button', { name: /Save quiz/ })).toHaveCount(0);
  expect(await quizMock(page, (m) => m.state.ai.starts)).toEqual(['quizGeneration']);
});

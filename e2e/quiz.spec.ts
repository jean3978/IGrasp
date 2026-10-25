import { expect, test } from '@playwright/test';
import {
  answerAll,
  openQuiz,
  quizCard,
  quizMock,
  savedMarkdown,
  startQuiz,
  toOptions,
} from './helpers';

test('a fixed quiz played with the keyboard, its results saved as markdown', async ({ page }) => {
  await openQuiz(page);
  // Slow enough for the generation screen to be seen.
  await quizMock(page, (m) => {
    m.state.ai.stepMs = 150;
  });
  // Opening the tab, the wizard and the card spend nothing.
  await toOptions(page);
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.getByRole('group', { name: /Confirm/ })).toBeVisible();
  expect(await quizMock(page, (m) => m.state.ai.starts)).toEqual([]);
  await page
    .getByRole('group', { name: /Confirm/ })
    .getByRole('button', { name: /Start/ })
    .click();

  await expect(page.getByLabel('What the AI reads').getByRole('listitem').first()).toBeVisible();
  await expect(quizCard(page)).toBeVisible();
  await expect(page.locator('canvas.quiz-effects')).toHaveCount(1);
  expect(await answerAll(page)).toBe(10);

  await expect(page.getByRole('list', { name: 'Your answers' }).getByRole('listitem')).toHaveCount(
    10,
  );
  await expect(page.locator('.quiz-results-usage')).toBeVisible();
  expect(await quizMock(page, (m) => m.state.ai.starts)).toEqual(['quizGeneration']);

  const before = await quizMock(page, (m) => m.state.files.size);
  await page.getByRole('button', { name: /Save results/ }).click();
  await expect(page.getByText(/Results saved to quiz-results\//)).toBeVisible();
  const [saved] = await savedMarkdown(page);
  expect(saved?.kind).toBe('results');
  expect(saved?.markdown.split('\n')[0]).toBe('---');
  // One new file, the one the user saved.
  expect(await quizMock(page, (m) => m.state.files.size)).toBe(before + 1);
});

test('Look it up opens the cited file, Escape closes it and the quiz goes on', async ({ page }) => {
  await openQuiz(page);
  await startQuiz(page);
  await expect(quizCard(page)).toBeVisible();
  await page.keyboard.press('l');
  const look = page.getByRole('dialog', { name: 'Look it up' });
  await expect(look).toBeVisible();
  await expect(look.locator('.quiz-look-code')).not.toBeEmpty();
  await expect(look.locator('.hoot[data-follow]')).toHaveCount(1);
  // Keys belong to the window: no answer, and Escape only closes it.
  await page.keyboard.press('1');
  await page.keyboard.press('Escape');
  await expect(look).toHaveCount(0);
  await expect(quizCard(page)).toBeVisible();
  await expect(page.locator('.quiz-reveal')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Look again/ })).toBeFocused();
  await page.keyboard.press('1');
  await page.keyboard.press('Enter');
  expect(await answerAll(page)).toBe(9);
  await page.locator('.quiz-review-item summary').first().click();
  await expect(page.getByText('· looked it up')).toBeVisible();
});

test('Check specific code writes questions on the picked files only', async ({ page }) => {
  await openQuiz(page);
  await startQuiz(page, { kind: 'Check specific code', paths: ['src'], count: 5 });
  await expect(quizCard(page)).toBeVisible();
  await expect(page.locator('.quiz-subject-name')).toHaveText('Code check: src');
  const answered = await answerAll(page);
  expect(answered).toBeGreaterThan(0);
  const sources = await page.locator('.quiz-review .quiz-source-path').allTextContents();
  expect(sources.every((s) => s.startsWith('src/'))).toBe(true);
});

test('a retry is shown, then the quiz plays', async ({ page }) => {
  await openQuiz(page);
  await quizMock(page, (m) => {
    m.state.ai.quizScript = 'retry';
    m.state.ai.stepMs = 200;
  });
  await startQuiz(page);
  await expect(page.locator('.quiz-attempt')).toContainText('retry 1 of 2', { timeout: 15_000 });
  await expect(quizCard(page)).toBeVisible();
  expect(await answerAll(page)).toBe(10);
});

test('nothing that checks out ends on the home with the reasons', async ({ page }) => {
  await openQuiz(page);
  await quizMock(page, (m) => {
    m.state.ai.quizScript = 'exhaust';
  });
  await startQuiz(page);
  await expect(page.locator('.quiz-failure')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quiz', level: 1 })).toBeVisible();
});

test('Stop during a slow generation returns to the home', async ({ page }) => {
  await openQuiz(page);
  await quizMock(page, (m) => {
    m.state.ai.quizScript = 'slow';
    m.state.ai.stepMs = 200;
  });
  await startQuiz(page);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('heading', { name: 'Quiz', level: 1 })).toBeVisible();
  await expect(quizCard(page)).toHaveCount(0);
});

test('an adaptive quiz writes its second round only on Next round', async ({ page }) => {
  await openQuiz(page);
  await toOptions(page);
  await page.getByRole('radio', { name: 'Adaptive', exact: true }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  const card = page.getByRole('group', { name: /Confirm/ });
  await expect(card).toContainText('Generate round 1 of 2');
  await card.getByRole('button', { name: /Start/ }).click();

  expect(await answerAll(page)).toBe(5);
  const nextRound = page.locator('.quiz-next', { hasText: 'Next round' });
  await expect(nextRound).toBeVisible();
  await expect(nextRound.locator('.ai-mark')).toHaveCount(1);
  expect(await quizMock(page, (m) => m.state.ai.starts)).toHaveLength(1);
  await nextRound.click();
  await expect(quizCard(page)).toBeVisible();
  expect(await quizMock(page, (m) => m.state.ai.starts)).toHaveLength(2);
  expect(await answerAll(page)).toBe(5);
  await expect(page.getByRole('list', { name: 'Your answers' }).getByRole('listitem')).toHaveCount(
    10,
  );
});

// Hoot's Academy end to end, on the mock backend: a tutorial written (nothing is spent before
// each Start), read with the keyboard, shared with the project and opened from the preview; a
// shared tutorial whose cited line changed, checked locally then with the AI, its proposals
// accepted and written after the confirmation; and the names of every control.

import { expect, test } from '@playwright/test';
import { academyMock, docBody, openAcademy, writeTutorial } from './helpers';

test('a tutorial written from its cards, read with the keyboard, spending only at each Start', async ({
  page,
}) => {
  await openAcademy(page);
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual([]);
  await page.getByPlaceholder(/How does a file change/).fill('How igrasp-demo starts');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Plan the outline/ }).click();
  // The confirmation card: still nothing spent.
  await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual([]);
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.locator('.academy-outline')).toBeVisible();
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual(['tutorialGeneration']);
  await page.getByRole('button', { name: /^Write \d+ chapters/ }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  const map = page.getByRole('list', { name: 'Chapters' });
  await expect(map.getByRole('button', { name: /Chapter 1: .*current/ })).toBeVisible();
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual([
    'tutorialGeneration',
    'tutorialGeneration',
  ]);

  // The first chapter with the keyboard: explain (Enter), the tour's stops (→), spot it.
  await map.getByRole('button', { name: /Chapter 1: .*current/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: /^Explain:/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('article', { name: /^Code tour:/ })).toBeVisible();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('article', { name: /^Spot it:/ })).toBeVisible();
  await expect(page.getByLabel('Your score')).toContainText('15 XP');
  await page.keyboard.press('Escape');
  await expect(map.getByRole('button', { name: /Chapter 1: .*2 of 5 steps/ })).toBeVisible();
  // Reading spent nothing more.
  expect(await academyMock(page, (m) => m.state.ai.starts)).toHaveLength(2);
});

test('sharing writes the listed files, which the preview shows with its banner', async ({
  page,
}) => {
  await openAcademy(page);
  await writeTutorial(page);
  await page.getByRole('button', { name: /Share with the project/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Share with the project' });
  await expect(dialog.getByRole('list', { name: 'Files' }).getByRole('listitem')).toHaveCount(5);
  await dialog.getByRole('button', { name: 'Share' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Shared with the project: docs\/tutorials\//)).toBeVisible();

  // Its README in the preview: the banner, then the Academy on it.
  const readme = await academyMock(page, (m) =>
    [...m.state.files.keys()].find(
      (p) => p.startsWith('docs/tutorials/') && p.endsWith('README.md'),
    ),
  );
  expect(readme).toBeTruthy();
  await page.keyboard.press('Control+t');
  const box = page.getByRole('combobox');
  await box.fill(readme ?? '');
  await expect(page.getByRole('option').first()).toBeVisible();
  await box.press('Enter');
  const banner = docBody(page).getByRole('region', { name: 'Tutorial file' });
  await expect(banner).toContainText('4 chapters');
  await banner.getByRole('button', { name: /Take it in the Academy/ }).click();
  await expect(page.getByText(/Shared · docs\/tutorials\//)).toBeVisible();
});

test('a changed cited line: the local check, then the AI review applied after confirmations', async ({
  page,
}) => {
  await openAcademy(page);
  await academyMock(page, (m) => {
    m.addSharedTutorial();
    const main = m.state.files.get('src/main.ts') ?? '';
    m.writeFiles({ 'src/main.ts': main.replace('toUpperCase', 'toLowerCase') });
  });
  await page
    .getByRole('button', { name: /^How igrasp-demo starts/ })
    .first()
    .click();
  const panel = page.getByRole('region', { name: 'Freshness of this tutorial' });
  await expect(panel).toContainText(/Maybe outdated \(1 of \d+ sources changed\)/);
  await expect(
    page
      .getByRole('list', { name: 'Chapters' })
      .getByRole('button', { name: /Chapter 1: .*changed/ }),
  ).toBeVisible();
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual([]);

  await panel.getByRole('button', { name: /Check with the AI/ }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.getByRole('heading', { name: 'Not covered yet' })).toBeVisible();
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual(['tutorialReview']);
  await page.getByRole('button', { name: 'Accept all' }).click();
  await page.getByRole('button', { name: /^Write \d+ accepted change/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Update the shared tutorial' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Write' }).click();
  await expect(page.getByText(/Shared tutorial updated/)).toBeVisible();
  expect(
    await academyMock(page, (m) =>
      [...m.state.files.values()].some((t) => t.includes('(checked again against the project)')),
    ),
  ).toBe(true);
  expect(await academyMock(page, (m) => m.state.ai.starts)).toEqual(['tutorialReview']);
});

test('every control of the Academy has a name; icon-only ones a tooltip', async ({ page }) => {
  await openAcademy(page);
  const scan = () =>
    page.evaluate(() => {
      const problems: string[] = [];
      const selector = 'button, input, select, textarea, [tabindex="0"], img, [role="group"]';
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>(
          `.academy-tab ${selector.split(', ').join(', .academy-tab ')}`,
        ),
      )) {
        const text = el.textContent.trim();
        const label = el.getAttribute('aria-label') ?? '';
        const labelled = el.getAttribute('aria-labelledby') !== null;
        const what = el.outerHTML.slice(0, 120);
        if (el.tagName === 'IMG') {
          if (el.getAttribute('alt') === null) problems.push(`image without alt: ${what}`);
          continue;
        }
        const placeholder = el.getAttribute('placeholder') ?? '';
        if (!text && !label && !labelled && !placeholder) problems.push(`no name: ${what}`);
        if (el.tagName === 'BUTTON' && !text && !el.title && !label)
          problems.push(`icon-only button without a tooltip: ${what}`);
      }
      return problems;
    });
  expect(await scan()).toEqual([]);
  await writeTutorial(page);
  expect(await scan()).toEqual([]);
  await page.getByRole('list', { name: 'Chapters' }).getByRole('button').first().click();
  await expect(page.getByRole('article', { name: /^Explain:/ })).toBeVisible();
  expect(await scan()).toEqual([]);
});

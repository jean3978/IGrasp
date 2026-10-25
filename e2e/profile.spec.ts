import { expect, test } from '@playwright/test';
import { openQuiz } from './helpers';

test('the project profile is detected locally and keeps its corrections', async ({ page }) => {
  await openQuiz(page);
  const profile = page.getByRole('region', { name: 'Project profile' });
  await expect(profile).toContainText('TypeScript');
  await expect(profile).toContainText('Vitest');

  await profile.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Notes for the generators').fill('Also a dedicated server.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  // Opening the folder again reads the corrections back from app data.
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('treeitem', { name: 'README.md', exact: true })).toBeVisible();
  await page.keyboard.press('Control+Alt+q');
  await expect(profile).toContainText('Also a dedicated server.');
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __igraspMock: { state: { ai: { starts: string[] } } } })
          .__igraspMock.state.ai.starts,
    ),
  ).toEqual([]);
});

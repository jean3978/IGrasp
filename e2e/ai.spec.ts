import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openFixture, treeItem } from './helpers';
import type { MockWindow } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Mock AI' });
const doc = (page: Page) => page.locator('.tab-content .markdown-body');

type AiMock = { state: { ai: { loggedIn: boolean; starts: string[] } } };
const aiMock = (page: Page, fn: (mock: AiMock) => void) =>
  page.evaluate((body) => {
    const mock = (window as MockWindow).__igraspMock as unknown as AiMock;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs in the page
    (new Function('mock', body) as (m: AiMock) => void)(mock);
  }, `(${fn.toString()})(mock)`);

async function openChat(page: Page) {
  await openFixture(page);
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText(/Mock AI 1\.0-mock/)).toBeVisible();
}

test('the AI chat shows a proposed edit as a diff and applies it when accepted', async ({
  page,
}) => {
  await openChat(page);
  const input = dialog(page).getByLabel('Message');
  await input.fill('Please edit README.md');
  await input.press('Enter');
  await expect(dialog(page).getByText('Please edit README.md')).toBeVisible();

  const card = dialog(page).getByRole('region', { name: 'Proposed edit to README.md' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/\(edited by the AI\)/)).toBeVisible();
  await expect(card.getByText('+1')).toBeVisible();
  await card.getByRole('button', { name: /Accept/ }).click();
  await expect(dialog(page).getByText('Done.')).toBeVisible();
  await expect(card).toHaveCount(0);

  // The provider wrote the file: the normal live reload shows the change.
  await treeItem(page, 'README.md').click();
  await expect(doc(page).getByRole('heading', { name: /edited by the AI/ })).toBeVisible();
});

test('a rejected edit leaves the file alone and the operation ends cleanly', async ({ page }) => {
  await openChat(page);
  const input = dialog(page).getByLabel('Message');
  await input.fill('Please edit README.md');
  await input.press('Enter');
  const card = dialog(page).getByRole('region', { name: 'Proposed edit to README.md' });
  await card.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog(page).getByText('Understood, I left the file unchanged.')).toBeVisible();
  await expect(dialog(page).getByText(/Edit README.md — refused or failed/)).toBeVisible();
  await treeItem(page, 'README.md').click();
  await expect(doc(page).getByRole('heading', { name: 'IGrasp demo project' })).toBeVisible();
});

test('browsing the project starts no AI operation; a logged-out provider is explained', async ({
  page,
}) => {
  await openFixture(page);
  await treeItem(page, 'README.md').click();
  await page.keyboard.press('Control+Shift+f');
  await page.keyboard.press('Control+Shift+r');
  await page.keyboard.press('Control+Shift+l');
  await page.keyboard.press('Control+Shift+e');
  await aiMock(page, (mock) => {
    mock.state.ai.loggedIn = false;
  });
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page).getByRole('alert')).toContainText('not logged in');
  await expect(dialog(page).getByLabel('Message')).toBeDisabled();
  await aiMock(page, (mock) => {
    mock.state.ai.loggedIn = true;
  });
  await dialog(page)
    .getByRole('button', { name: /Check again/ })
    .click();
  await expect(dialog(page).getByLabel('Message')).toBeEnabled();
  const starts = await page.evaluate(
    () => ((window as MockWindow).__igraspMock as unknown as AiMock).state.ai.starts,
  );
  expect(starts).toEqual([]);
});

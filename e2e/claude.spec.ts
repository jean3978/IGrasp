import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openFixture, treeItem } from './helpers';
import type { MockWindow } from './helpers';

const dialog = (page: Page) => page.getByRole('dialog', { name: /Claude/ });

async function openChat(page: Page) {
  await openFixture(page);
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByText(/claude 2\.1\.310/)).toBeVisible();
}

test('the Claude chat shows a proposed edit as a diff and applies it when accepted', async ({
  page,
}) => {
  await openChat(page);
  const input = dialog(page).getByLabel('Message to Claude');
  await input.fill('Please edit README.md');
  await input.press('Enter');
  await expect(dialog(page).getByText('Please edit README.md')).toBeVisible();

  const card = dialog(page).getByRole('region', { name: 'Proposed edit to README.md' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/\(edited by Claude\)/)).toBeVisible();
  await expect(card.getByText('+1')).toBeVisible();
  await card.getByRole('button', { name: /Accept/ }).click();
  await expect(dialog(page).getByText('Done.')).toBeVisible();
  await expect(card).toHaveCount(0);

  // The CLI wrote the file: the normal live reload shows the change.
  await treeItem(page, 'README.md').click();
  await expect(
    page.locator('.tab-content .markdown-body').getByRole('heading', { name: /edited by Claude/ }),
  ).toBeVisible();
});

test('a rejected edit leaves the file alone and stops the turn cleanly', async ({ page }) => {
  await openChat(page);
  const input = dialog(page).getByLabel('Message to Claude');
  await input.fill('Please edit README.md');
  await input.press('Enter');
  const card = dialog(page).getByRole('region', { name: 'Proposed edit to README.md' });
  await card.getByRole('button', { name: 'Reject' }).click();
  await expect(dialog(page).getByText('Understood, I left the file unchanged.')).toBeVisible();
  await expect(dialog(page).getByText(/Edit README.md — refused or failed/)).toBeVisible();
  await treeItem(page, 'README.md').click();
  await expect(
    page
      .locator('.tab-content .markdown-body')
      .getByRole('heading', { name: 'IGrasp demo project' }),
  ).toBeVisible();
});

test('a logged-out CLI is explained, with a way to check again', async ({ page }) => {
  await openFixture(page);
  await page.evaluate(() => {
    const mock = (window as MockWindow).__igraspMock as unknown as {
      state: { claude: { loggedIn: boolean } };
    };
    mock.state.claude.loggedIn = false;
  });
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page).getByRole('alert')).toContainText('not logged in');
  await expect(dialog(page).getByLabel('Message to Claude')).toBeDisabled();
  await page.evaluate(() => {
    const mock = (window as MockWindow).__igraspMock as unknown as {
      state: { claude: { loggedIn: boolean } };
    };
    mock.state.claude.loggedIn = true;
  });
  await dialog(page)
    .getByRole('button', { name: /Check again/ })
    .click();
  await expect(dialog(page).getByLabel('Message to Claude')).toBeEnabled();
});

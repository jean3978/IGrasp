import { expect, test } from '@playwright/test';
import { ask, chatPanel, docBody, fileOnDisk, inlineReview, openChat } from './helpers';

const review = inlineReview;
const dialog = chatPanel;
const doc = docBody;
test('a code edit is shown as a line diff in the chat and applied when accepted', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Please edit src/main.ts');
  const card = dialog(page).getByRole('region', { name: 'Proposed edit to main.ts' });
  await expect(card).toBeVisible();
  await expect(card.getByText(/\(edited by the AI\)/)).toBeVisible();
  await expect(card.getByText('+1')).toBeVisible();
  await card.getByRole('button', { name: /Accept/ }).click();
  await expect(dialog(page).getByText('Done.')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(await fileOnDisk(page, 'src/main.ts')).toContain('(edited by the AI)');
});

test('a markdown edit is reviewed in the preview: only the accepted change is written', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Please edit twice README.md');
  const card = dialog(page).getByRole('region', { name: 'Proposed edit to README.md' });
  await expect(card.getByText('Mock AI proposes 2 changes to README.md')).toBeVisible();
  // The review works with the chat closed; the status bar leads back to it.
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText('1 edit to review')).toBeVisible();
  await expect(review(page).getByRole('group', { name: /^Change \d of 2/ })).toHaveCount(2);

  await review(page).getByRole('button', { name: 'Reject change 1' }).click();
  await review(page).getByRole('button', { name: 'Accept change 2' }).click();
  await expect(review(page).getByText('2 of 2 decided', { exact: true })).toBeVisible();
  await review(page).getByRole('button', { name: 'Apply' }).click();

  // The provider wrote the file: the normal live reload shows it.
  await expect(review(page)).toHaveCount(0);
  await expect(doc(page).getByText(/The app starts in.*\(edited by the AI\)/)).toBeVisible();
  await expect(doc(page).getByText(/Welcome to the.*\(edited by the AI\)/)).toHaveCount(0);
  const written = (await fileOnDisk(page, 'README.md')) ?? '';
  expect(written.match(/\(edited by the AI\)/g)).toHaveLength(1);
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page).getByText('Applied 1 of 2 changes to README.md.')).toBeVisible();
});

test('Reject all leaves the file alone and the operation ends cleanly', async ({ page }) => {
  await openChat(page);
  const before = await fileOnDisk(page, 'README.md');
  await ask(page, 'Please rewrite README.md');
  await expect(review(page).getByRole('group', { name: /^Change 1 of/ })).toBeVisible();
  await review(page)
    .getByRole('group', { name: /^Change 1 of/ })
    .focus();
  await page.keyboard.press('Alt+Shift+R');
  await expect(dialog(page).getByText('Understood, I left the file unchanged.')).toBeVisible();
  await expect(dialog(page).getByText(/Write README.md — refused or failed/)).toBeVisible();
  await expect(doc(page).getByRole('heading', { name: 'IGrasp demo project' })).toBeVisible();
  expect(await fileOnDisk(page, 'README.md')).toBe(before);
});

test('a new markdown file is reviewed against an empty document, then created', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Please create notes/new.md');
  await expect(review(page).getByText('Mock AI proposes a new file notes/new.md')).toBeVisible();
  await expect(review(page).getByRole('heading', { name: 'New note' })).toBeVisible();
  await review(page)
    .getByRole('button', { name: /Accept all/ })
    .click();
  await expect(dialog(page).getByText('Done.')).toBeVisible();
  await expect(doc(page).getByRole('heading', { name: 'New note' })).toBeVisible();
  expect(await fileOnDisk(page, 'notes/new.md')).toContain('# New note');
});

test('with Markdown edits set to Allow in the settings, the next edit is applied without a review', async ({
  page,
}) => {
  await openChat(page);
  // Settings are a tab; close the floating chat while changing them.
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press('Control+,');
  const allow = page
    .getByRole('radiogroup', { name: 'Markdown edits' })
    .getByRole('radio', { name: 'Allow' });
  await allow.click();
  await expect(allow).toBeChecked();

  await page.getByRole('treeitem', { name: 'README.md', exact: true }).click();
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page)).toBeVisible();
  await ask(page, 'Please edit README.md');
  await expect(dialog(page).getByText(/^Allowed by your settings: /)).toBeVisible();
  await expect(dialog(page).getByText('Done.')).toBeVisible();
  await expect(review(page)).toHaveCount(0);
  await expect(dialog(page).getByRole('region', { name: /^Proposed edit/ })).toHaveCount(0);
  expect((await fileOnDisk(page, 'README.md')) ?? '').toContain('(edited by the AI)');
});

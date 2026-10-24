import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openFixture, treeItem } from './helpers';
import type { MockWindow } from './helpers';

const activeTab = (page: Page) => page.locator('.tab-main[aria-selected=true]');
const doc = (page: Page) => page.locator('.tab-content .markdown-body');

async function openReadme(page: Page) {
  await openFixture(page);
  await treeItem(page, 'README.md').click();
  await expect(doc(page).getByRole('heading', { name: 'IGrasp demo project' })).toBeVisible();
}

test('Ctrl+T finds a heading and scrolls to it', async ({ page }) => {
  await openReadme(page);
  await page.keyboard.press('Control+t');
  const box = page.getByRole('combobox');
  await box.fill('#install');
  await expect(page.getByRole('option')).toHaveText([/Install/]);
  await box.press('Enter');
  await expect(activeTab(page)).toContainText('getting-started.md');
  const heading = doc(page).getByRole('heading', { name: 'Install' });
  await expect(heading).toHaveClass(/flash/);
  await expect(heading).toBeInViewport();
});

test('Ctrl+Shift+F searches with options, opens a match at its line and steps with F4', async ({
  page,
}) => {
  await openReadme(page);
  await page.keyboard.press('Control+Shift+F');
  const box = page.getByRole('textbox', { name: 'Search' });
  await expect(box).toBeFocused();
  await box.fill('the\\s\\w+');
  await page.keyboard.press('Alt+r');
  await expect(page.getByRole('button', { name: 'Use Regular Expression' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#sidebar-view [role=status]')).toContainText(/results in \d+ files/);
  await page.keyboard.press('Alt+c');
  await box.fill('The');
  await page.keyboard.press('Alt+r');
  const results = page.getByRole('tree', { name: 'Search results' });
  await expect(results.locator('mark').first()).toHaveText('The');
  await expect(results.locator('mark', { hasText: /^the$/ })).toHaveCount(0);

  await page.keyboard.press('F4');
  await expect(results.locator('.list-row-active')).toHaveCount(1);
  const opened = await activeTab(page).innerText();
  await page.keyboard.press('F4');
  await expect(activeTab(page)).not.toHaveText(opened);
  await expect(doc(page).locator('.flash')).toHaveCount(1);
});

test('include and exclude globs filter the search', async ({ page }) => {
  await openReadme(page);
  await page.keyboard.press('Control+Shift+F');
  await page.getByRole('button', { name: 'Toggle Search Details' }).click();
  await page.getByRole('textbox', { name: 'files to include' }).fill('docs');
  await page.getByRole('textbox', { name: 'files to exclude' }).fill('guide');
  await page.getByRole('textbox', { name: 'Search' }).fill('the');
  const results = page.getByRole('tree', { name: 'Search results' });
  await expect(results.getByText('architecture.md')).toBeVisible();
  await expect(results.getByText('README.md')).toHaveCount(0);
  await expect(results.getByText('getting-started.md')).toHaveCount(0);
});

test('recent changes lists a file an agent just wrote first, with a marker', async ({ page }) => {
  await openReadme(page);
  await page.keyboard.press('Control+Shift+R');
  const list = page.getByRole('listbox', { name: 'Recently modified files' });
  await expect(list.getByRole('option').first()).toContainText('getting-started.md');
  await page.evaluate(() => {
    (window as MockWindow).__igraspMock?.writeFiles({ 'notes/TODO.MD': '# TODO\n\nUpdated.\n' });
  });
  await expect(list.getByRole('option').first()).toContainText('TODO.MD');
  await expect(list.getByRole('option').first().locator('.change-dot')).toBeVisible();
});

test('Alt+Left and Alt+Right move through the documents read', async ({ page }) => {
  await openReadme(page);
  await treeItem(page, 'CHANGELOG.md').dblclick();
  await expect(activeTab(page)).toContainText('CHANGELOG.md');
  await page.locator('.document-scroll').focus();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(activeTab(page)).toContainText('README.md');
  await page.keyboard.press('Alt+ArrowRight');
  await expect(activeTab(page)).toContainText('CHANGELOG.md');
  expect(page.url()).toMatch(/\/$/);
});

test('a link to a source file opens the code viewer at its lines', async ({ page }) => {
  await openReadme(page);
  await doc(page).getByRole('link', { name: 'the entry point' }).click();
  await expect(activeTab(page)).toContainText('main.ts');
  const code = page.getByRole('region', { name: /src\/main.ts/ });
  await expect(code.locator('.code-line[data-selected]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Open in Default Editor' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as MockWindow).__igraspMock?.state.opened))
    .toContain('editor:src/main.ts');
});

test('broken links are underlined and listed in the Broken links view', async ({ page }) => {
  await openReadme(page);
  await treeItem(page, 'docs').click();
  await treeItem(page, 'architecture.md').click();
  const broken = doc(page).getByRole('link', { name: 'old design' });
  await expect(broken).toHaveAttribute('data-status', 'broken');
  await expect(broken).toHaveAttribute('title', 'File not found: docs/old-design.md');
  await page.getByRole('button', { name: /3 broken links/ }).click();
  const tree = page.getByRole('tree', { name: 'Broken links by document' });
  await expect(tree.getByText('old design')).toBeVisible();
  await expect(tree.getByText('deep dive')).toBeVisible();
});

test('outline and backlinks in the right panel, restored with the session', async ({ page }) => {
  await openReadme(page);
  await page.keyboard.press('Control+Alt+B');
  const outline = page.getByRole('tree', { name: 'Outline' });
  await expect(outline.getByRole('treeitem')).toHaveText(['IGrasp demo project', 'Features']);
  await outline.getByRole('treeitem', { name: 'Features' }).click();
  await expect(doc(page).getByRole('heading', { name: 'Features' })).toHaveClass(/flash/);
  await expect(page.getByRole('list', { name: /Documents linking to README.md/ })).toContainText(
    'getting-started.md',
  );

  // Close and reopen the folder: the right panel comes back.
  await page.waitForTimeout(900);
  await page.getByRole('menuitem', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: 'Close Folder' }).click();
  await page.getByRole('button', { name: /Open Folder…/ }).click();
  await expect(page.getByRole('tree', { name: 'Outline' })).toBeVisible();
});

test('keyboard only: activity bar and search panel', async ({ page }) => {
  await openReadme(page);
  await page.getByRole('tab', { name: 'Explorer' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('tab', { name: 'Search' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tabpanel', { name: 'Search' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search' }).focus();
  await page.keyboard.type('Deep');
  const results = page.getByRole('tree', { name: 'Search results' });
  await expect(results.locator('mark').first()).toBeVisible();
  await results.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(activeTab(page)).toContainText('deep-dive.markdown');
});

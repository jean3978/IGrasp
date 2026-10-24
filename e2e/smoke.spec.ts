import { expect, test } from '@playwright/test';
import { openFixture, start, treeItem } from './helpers';
import type { MockWindow } from './helpers';

test('shows the splash, then the welcome screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.splash')).toBeVisible();
  await start(page);
  await expect(page.getByRole('button', { name: /Open Folder…/ })).toBeVisible();
  await expect(page.getByText('Folders you open will appear here.')).toBeVisible();
});

test('lists only markdown files and hides folders without markdown', async ({ page }) => {
  await openFixture(page);
  const tree = page.getByRole('tree', { name: 'Markdown files' });
  await expect(tree.getByRole('treeitem')).toHaveText([
    'docs',
    'notes',
    'CHANGELOG.md',
    'README.md',
  ]);
  // src/ has no markdown, build/ is git-ignored, node_modules/ and dotfolders are skipped.
  await expect(treeItem(page, 'src')).toHaveCount(0);
  await expect(treeItem(page, 'build')).toHaveCount(0);
  await expect(treeItem(page, '.github')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show ignored files' }).click();
  await expect(treeItem(page, 'build')).toBeVisible();
});

test('renders a document with highlighted code', async ({ page }) => {
  await openFixture(page);
  await treeItem(page, 'README.md').click();
  const doc = page.locator('.markdown-body');
  await expect(doc.getByRole('heading', { name: 'IGrasp demo project', level: 1 })).toBeVisible();
  await expect(doc.locator('pre.shiki')).toBeVisible();
  // Inline styles survive the CSP setup: the keyword is colored, not the default text color.
  const keyword = doc.locator('pre.shiki span span', { hasText: 'export' }).first();
  const color = await keyword.evaluate((el) => getComputedStyle(el).color);
  const text = await doc
    .locator('p')
    .first()
    .evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe(text);
  await expect(doc.locator('.katex').first()).toBeVisible();
  await expect(doc.locator('.markdown-alert-note')).toBeVisible();
});

test('renders Mermaid diagrams as SVG', async ({ page }) => {
  await openFixture(page);
  await treeItem(page, 'docs').click();
  await treeItem(page, 'architecture.md').click();
  await expect(page.locator('.mermaid-svg svg')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.mermaid-svg svg .node')).toHaveCount(3);
});

test('switches themes', async ({ page }) => {
  await start(page);
  for (const [name, value] of [
    ['Dark', 'dark'],
    ['High Contrast', 'high-contrast'],
    ['Light', 'light'],
  ] as const) {
    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  }
});

test('opens a file with the keyboard only', async ({ page }) => {
  await openFixture(page);
  await page.keyboard.press('Control+Shift+E');
  await expect(page.getByRole('tree')).toBeFocused();
  await page.keyboard.press('Home'); // docs
  await page.keyboard.press('ArrowRight'); // expand docs
  await page.keyboard.press('ArrowRight'); // first child
  await page.keyboard.type('arch');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: /architecture\.md/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.locator('.markdown-body h1')).toHaveText('Architecture');
});

test('reloads an open file and groups a burst of changes into one toast', async ({ page }) => {
  await openFixture(page);
  await treeItem(page, 'README.md').dblclick();
  await expect(page.locator('.markdown-body h1')).toHaveText('IGrasp demo project');
  await page.evaluate(() => {
    const mock = (window as MockWindow).__igraspMock;
    if (!mock) throw new Error('mock backend missing');
    const files: Record<string, string> = { 'README.md': '# Rewritten by an agent' };
    for (let i = 0; i < 12; i++) files[`agent/note-${String(i)}.md`] = `# Note ${String(i)}`;
    mock.writeFiles(files);
  });
  await expect(page.locator('.markdown-body h1')).toHaveText('Rewritten by an agent');
  const toast = page.locator('.toast-grouped');
  await expect(toast).toContainText('13 files changed');
  await expect(toast).toContainText('1 file modified · 12 added');
  await expect(treeItem(page, 'agent')).toBeVisible();
  await toast.locator('.toast-body').click();
  await expect(page.locator('.toast-popover li')).toHaveCount(13);
});

test('flags an open file deleted on disk', async ({ page }) => {
  await openFixture(page);
  await treeItem(page, 'CHANGELOG.md').dblclick();
  await page.evaluate(() => {
    const mock = (window as MockWindow).__igraspMock;
    if (!mock) throw new Error('mock backend missing');
    mock.deleteFiles(['CHANGELOG.md']);
  });
  await expect(page.getByText('This file was deleted on disk.')).toBeVisible();
  await expect(treeItem(page, 'CHANGELOG.md')).toHaveCount(0);
});

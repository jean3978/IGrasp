import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { aiMock, ask, capture, chatPanel, openChat, treeItem } from './helpers';

const panel = chatPanel;
const bar = (page: Page) => panel(page).getByRole('group', { name: 'Context of the next message' });

test('a region selected with the mouse becomes a chip, and the message carries the text and one image', async ({
  page,
}) => {
  await openChat(page);
  await treeItem(page, 'README.md').click();
  await expect(page.locator('.tab-content .markdown-body h1')).toBeVisible();
  await capture(page, { x: 20, y: 20, width: 420, height: 160 });

  // Nothing was sent: the chat shows the chip and a pre-filled draft.
  await expect(panel(page)).toBeVisible();
  const label = bar(page).getByText(/^README\.md lines? \d+/);
  await expect(label).toBeVisible();
  await expect(bar(page).locator('img.ai-context-thumb')).toBeVisible();
  const input = panel(page).getByLabel('Message', { exact: true });
  await expect(input).toHaveValue(/^About this region:/);
  expect(await aiMock(page, (mock) => mock.state.ai.starts)).toEqual([]);

  const chipText = (await label.textContent()) ?? '';
  const [, first, last] = /lines? (\d+)(?:–(\d+))?/.exec(chipText) ?? [];
  await input.pressSequentially(' what is this image?');
  await input.press('Enter');
  await expect(panel(page).getByText(/I see 1 attached image/)).toBeVisible();
  await expect(panel(page).getByText(/^Selected region: README\.md/)).toBeVisible();

  const request = await aiMock(page, (mock) => mock.state.ai.lastRequest);
  expect(request?.images).toHaveLength(1);
  expect(request?.images[0]?.mediaType).toBe('image/png');
  expect(request?.capture?.sourcePath).toBe('README.md');
  expect(String(request?.capture?.firstLine)).toBe(first);
  expect(String(request?.capture?.lastLine)).toBe(last ?? first);
  expect(request?.capture?.text).toContain('IGrasp demo project');
});

test('Ctrl+Alt+R and the keyboard select a region; Escape cancels another', async ({ page }) => {
  await openChat(page);
  await treeItem(page, 'README.md').click();
  await expect(page.locator('.tab-content .markdown-body h1')).toBeVisible();

  const overlay = page.getByRole('application', { name: /Select a region/ });
  await page.keyboard.press('Control+Alt+r');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(bar(page).getByText(/^README\.md lines?/)).toHaveCount(0);

  await page.keyboard.press('Control+Alt+r');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('ArrowRight'); // shows the keyboard rectangle
  await page.keyboard.press('Enter');
  await expect(overlay).toHaveCount(0);
  await expect(bar(page).getByText(/^README\.md lines? \d+/)).toBeVisible();
  await expect(panel(page).getByLabel('Message', { exact: true })).toHaveValue(
    /^About this region:/,
  );
  expect(await aiMock(page, (mock) => mock.state.ai.starts)).toEqual([]);
});

test('the controls that send something to the AI carry the "Uses AI" mark and its tooltip', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'hello');
  await expect(panel(page).getByText(/You said: "hello"/)).toBeVisible();
  const send = panel(page).getByRole('button', { name: /^Send/ });
  await expect(send.getByRole('img', { name: 'Uses AI' })).toHaveAttribute(
    'title',
    'Uses AI (Mock AI)',
  );
  const toolbarCapture = page.locator('[data-action="ai.capture"]');
  await expect(toolbarCapture.getByRole('img', { name: 'Uses AI' })).toHaveAttribute(
    'title',
    'Uses AI (Mock AI)',
  );
});

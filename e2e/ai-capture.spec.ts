import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { aiMock, ask, capture, chatPanel, openChat, treeItem } from './helpers';
import type { MockWindow } from './helpers';

const panel = chatPanel;
const selectionLine = (page: Page) =>
  panel(page).getByRole('group', { name: /^(Region|Selection):/ });
const tools = (page: Page) => page.getByRole('toolbar', { name: 'AI tools' });

test('a region selected with the mouse opens the chat next to it, highlighted, and goes as text', async ({
  page,
}) => {
  await openChat(page);
  await treeItem(page, 'README.md').click();
  await expect(page.locator('.tab-content .markdown-body h1')).toBeVisible();
  await capture(page, { x: 20, y: 20, width: 420, height: 160 });

  // Nothing was sent: the chat recalls the region on one line and pre-fills the draft.
  await expect(panel(page)).toBeVisible();
  await expect(selectionLine(page)).toHaveAccessibleName(/^Region: README\.md lines? \d+/);
  const input = panel(page).getByLabel('Message', { exact: true });
  await expect(input).toHaveValue(/^About this region:/);
  expect(await aiMock(page, (mock) => mock.state.ai.starts)).toEqual([]);
  // The region stays painted over the document, and the chat does not cover it.
  const region = page.locator('.document-scroll .ai-highlight-region');
  await expect(region).toBeVisible();
  const r = await region.boundingBox();
  const p = await panel(page).boundingBox();
  if (!r || !p) throw new Error('no boxes');
  expect(r.x + r.width <= p.x || p.x + p.width <= r.x).toBe(true);

  const name = (await selectionLine(page).getAttribute('aria-label')) ?? '';
  const [, first, last] = /lines? (\d+)(?:–(\d+))?/.exec(name) ?? [];
  await input.pressSequentially(' what is this?');
  await input.press('Enter');
  await expect(panel(page).getByText(/You said:/)).toBeVisible();
  await expect(panel(page).getByText(/^Selected region: README\.md/)).toBeVisible();

  const request = await aiMock(page, (mock) => mock.state.ai.lastRequest);
  expect(request?.images).toEqual([]);
  expect(request?.capture?.sourcePath).toBe('README.md');
  expect(String(request?.capture?.firstLine)).toBe(first);
  expect(String(request?.capture?.lastLine)).toBe(last ?? first);
  expect(request?.capture?.text).toContain('IGrasp demo project');
  // Still highlighted after Send, while the chat is open.
  await expect(region).toBeVisible();
});

test('the text tool: highlight text, release, and the chat opens about it with quick actions', async ({
  page,
}) => {
  await openChat(page);
  await page.keyboard.press('Escape');
  await treeItem(page, 'README.md').click();
  const paragraph = page.locator('.tab-content .markdown-body p').first();
  await expect(paragraph).toBeVisible();
  await tools(page).getByRole('button', { name: 'Ask About Selected Text' }).click();
  await expect(
    tools(page).getByRole('button', { name: 'Ask About Selected Text' }),
  ).toHaveAttribute('aria-pressed', 'true');

  const box = await paragraph.boundingBox();
  if (!box) throw new Error('no paragraph');
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(panel(page)).toBeVisible();
  await expect(selectionLine(page)).toHaveAccessibleName(/^Selection: README\.md line 3/);
  await expect(page.locator('.document-scroll .ai-highlight').first()).toBeVisible();
  await expect(panel(page).getByLabel('Message', { exact: true })).toHaveValue(
    /^About this selection:/,
  );
  expect(await aiMock(page, (mock) => mock.state.ai.starts)).toEqual([]);

  await panel(page).getByRole('button', { name: 'Explain', exact: true }).click();
  await expect(panel(page).getByText(/This is the mock AI/)).toBeVisible();
  const request = await aiMock(page, (mock) => mock.state.ai.lastRequest);
  expect(request?.prompt).toMatch(/^Explain the selection/);
  expect(request?.capture?.firstLine).toBe(3);
  expect(request?.capture?.text).toContain('Welcome to the');
});

test('a quick action on a few highlighted list items sends only their lines', async ({ page }) => {
  await openChat(page);
  await page.keyboard.press('Escape');
  const items = Array.from({ length: 12 }, (_, i) => `- Item ${String(i + 1)} of the list.`);
  await page.evaluate(
    (text) => {
      (window as unknown as MockWindow).__igraspMock?.writeFiles({ 'list.md': text });
    },
    `# List\n\n${items.join('\n')}\n`,
  );
  await treeItem(page, 'list.md').click();
  const li = page.locator('.tab-content .markdown-body li');
  await expect(li).toHaveCount(12);
  await tools(page).getByRole('button', { name: 'Ask About Selected Text' }).click();

  // Highlight items 5 and 6 only (source lines 7 and 8).
  const from = await li.nth(4).boundingBox();
  const to = await li.nth(5).boundingBox();
  if (!from || !to) throw new Error('no items');
  await page.mouse.move(from.x + 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 4, to.y + to.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(selectionLine(page)).toHaveAccessibleName(/^Selection: list\.md lines 7–8/);

  await panel(page).getByRole('button', { name: 'Shorten', exact: true }).click();
  await expect(panel(page).getByText(/You said:/)).toBeVisible();
  const request = await aiMock(page, (mock) => mock.state.ai.lastRequest);
  expect(request?.capture).toMatchObject({
    firstLine: 7,
    lastLine: 8,
    text: '- Item 5 of the list.\n- Item 6 of the list.',
  });
  expect(request?.prompt).toMatch(/^Shorten the selection.*Scope: change only the selection/s);
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
  await expect(selectionLine(page)).toHaveCount(0);

  await page.keyboard.press('Control+Alt+r');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('ArrowRight'); // shows the keyboard rectangle
  await page.keyboard.press('Enter');
  await expect(overlay).toHaveCount(0);
  await expect(selectionLine(page)).toHaveAccessibleName(/^Region: README\.md lines? \d+/);
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
  await treeItem(page, 'README.md').click();
  const regionTool = tools(page).locator('[data-action="ai.capture"]');
  await expect(regionTool.getByRole('img', { name: 'Uses AI' })).toHaveAttribute(
    'title',
    'Uses AI (Mock AI)',
  );
  // The window toolbar has no AI controls any more.
  await expect(
    page.getByRole('toolbar', { name: 'Window toolbar' }).locator('[data-ai-mark]'),
  ).toHaveCount(0);
});

test('a tooltip of the chat shows above the chat', async ({ page }) => {
  await openChat(page);
  await panel(page).getByRole('button', { name: 'History' }).hover();
  const tooltip = page.locator('.tooltip', { hasText: 'History' });
  await expect(tooltip).toBeVisible();
  const z = (selector: string) =>
    page.evaluate(
      (s) => Number(getComputedStyle(document.querySelector(s) as Element).zIndex),
      selector,
    );
  expect(await z('.tooltip')).toBeGreaterThan(await z('.ai-panel'));
});

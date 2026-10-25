import { expect, test } from '@playwright/test';
import { aiMock, capture, chatPanel, openChat, openFixture, treeItem } from './helpers';
import type { AiMock, MockWindow } from './helpers';

const dialog = chatPanel;

test('the chat panel moves, resizes, stays in the window and is remembered for the folder', async ({
  page,
}) => {
  await openChat(page);
  const panel = dialog(page);
  const before = await panel.boundingBox();
  if (!before) throw new Error('no panel');
  // Drag by the title.
  const title = panel.getByRole('heading', { name: 'Mock AI' });
  const handle = await title.boundingBox();
  if (!handle) throw new Error('no title');
  await page.mouse.move(handle.x + 10, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x - 290, handle.y - 55, { steps: 5 });
  await page.mouse.up();
  const moved = await panel.boundingBox();
  expect(Math.round(moved?.x ?? 0)).toBe(Math.round(before.x - 300));
  expect(Math.round(moved?.y ?? 0)).toBe(Math.round(before.y - 60));

  // Resize from the bottom-right corner, then by keyboard.
  const corner = panel.locator('.ai-resize-se');
  const c = await corner.boundingBox();
  if (!c) throw new Error('no corner');
  await page.mouse.move(c.x + 6, c.y + 6);
  await page.mouse.down();
  await page.mouse.move(c.x + 86, c.y + 46, { steps: 4 });
  await page.mouse.up();
  const resized = await panel.boundingBox();
  expect(Math.round(resized?.width ?? 0)).toBe(Math.round(before.width + 80));
  await title.focus();
  await page.keyboard.press('Alt+ArrowLeft');
  expect(Math.round((await panel.boundingBox())?.x ?? 0)).toBe(Math.round(before.x - 324));

  // A smaller window keeps the panel inside.
  await page.setViewportSize({ width: 700, height: 500 });
  await expect
    .poll(async () => {
      const inside = await panel.boundingBox();
      return (inside?.x ?? 0) + (inside?.width ?? 0);
    })
    .toBeLessThanOrEqual(700);
  const inside = await panel.boundingBox();
  expect((inside?.x ?? 0) + (inside?.width ?? 0)).toBeLessThanOrEqual(700);
  expect((inside?.y ?? 0) + (inside?.height ?? 0)).toBeLessThanOrEqual(500);
  await page.setViewportSize({ width: 1280, height: 800 });
  const kept = await panel.boundingBox();

  // Opening the folder again restores the panel where it was.
  await page.keyboard.press('Control+o');
  await expect(page.getByRole('treeitem', { name: 'README.md', exact: true })).toBeVisible();
  await expect(panel).toBeVisible();
  expect(await panel.boundingBox()).toEqual(kept);

  // Escape closes it (nothing runs) and the focus goes back to its button over the view.
  await panel.getByLabel('Message', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'AI Chat' })).toBeFocused();
});

test('history: two conversations, reopen the first and continue it', async ({ page }) => {
  await openChat(page);
  const panel = dialog(page);
  const input = panel.getByLabel('Message', { exact: true });
  await input.fill('First question');
  await input.press('Enter');
  await expect(panel.getByText(/You said: "First question"/)).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Send/ })).toBeVisible();
  await page.keyboard.press('Control+Alt+n');
  await expect(panel.getByText(/You said: "First question"/)).toHaveCount(0);
  await input.fill('Second question');
  await input.press('Enter');
  await expect(panel.getByText(/You said: "Second question"/)).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Send/ })).toBeVisible();

  await page.keyboard.press('Control+Alt+h');
  const list = panel.getByRole('listbox', { name: 'Conversations' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await list.getByRole('option', { name: 'First question' }).click();
  await expect(panel.getByText(/You said: "First question"/)).toBeVisible();
  await input.fill('Tell me more');
  await input.press('Enter');
  await expect(panel.getByText(/You said: "Tell me more"/)).toBeVisible();
  const resumed = await page.evaluate(
    () =>
      (
        (window as MockWindow).__igraspMock as unknown as {
          state: { ai: { lastRequest: { resumeId?: string } | null } };
        }
      ).state.ai.lastRequest?.resumeId,
  );
  expect(resumed).toMatch(/^00000000-/);
});

test('the context bar lists what the message carries; a dropped document is not sent', async ({
  page,
}) => {
  await openChat(page);
  await treeItem(page, 'README.md').click();
  const panel = dialog(page);
  const bar = panel.getByRole('group', { name: 'Context of the next message' });
  await expect(bar.getByRole('listitem')).toHaveCount(2);
  await expect(bar.getByText('AGENTS.md')).toBeVisible();
  await expect(bar.getByText('README.md')).toBeVisible();
  await bar.getByRole('button', { name: 'Remove AGENTS.md from the next message' }).click();
  const input = panel.getByLabel('Message', { exact: true });
  await input.fill('What is this file about?');
  await input.press('Enter');
  await expect(panel.getByText(/You said: "What is this file about\?"/)).toBeVisible();
  const paths = await page.evaluate(() =>
    (
      (window as MockWindow).__igraspMock as unknown as {
        state: { ai: { lastRequest: { context: { path: string }[] } | null } };
      }
    ).state.ai.lastRequest?.context.map((d) => d.path),
  );
  expect(paths).toEqual(['README.md']);
});

test('a command denied, then allowed for the conversation, then run without a prompt', async ({
  page,
}) => {
  await openChat(page);
  const panel = dialog(page);
  const input = panel.getByLabel('Message', { exact: true });
  const card = panel.getByRole('region', { name: 'Permission for Bash' });
  await input.fill('Run a command');
  await input.press('Enter');
  await card.getByRole('button', { name: 'Deny' }).click();
  await expect(panel.getByText(/Bash git log --oneline -5 — refused or failed/)).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Send/ })).toBeVisible();

  await input.fill('Run a command again');
  await input.press('Enter');
  await card.getByRole('button', { name: 'Allow for this conversation' }).click();
  await expect(card).toHaveCount(0);
  await expect(panel.getByRole('button', { name: /^Send/ })).toBeVisible();

  await input.fill('One more command');
  await input.press('Enter');
  await expect(
    panel.getByText('Allowed for this conversation: Bash git log --oneline -5'),
  ).toBeVisible();
  await expect(card).toHaveCount(0);
  await panel.getByRole('button', { name: 'Rules of this conversation (1)' }).click();
  await expect(page.getByRole('dialog', { name: 'Rules of this conversation' })).toContainText(
    'Bash',
  );
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
  await expect(dialog(page).getByLabel('Message', { exact: true })).toBeDisabled();
  await aiMock(page, (mock) => {
    mock.state.ai.loggedIn = true;
  });
  await dialog(page)
    .getByRole('button', { name: /Check again/ })
    .click();
  await expect(dialog(page).getByLabel('Message', { exact: true })).toBeEnabled();
  // A region selection, the history list and the settings are not messages either.
  await capture(page, { x: 20, y: 20, width: 300, height: 100 });
  await expect(
    dialog(page).getByRole('group', { name: /^Region: README\.md lines? \d+/ }),
  ).toBeVisible();
  await page.keyboard.press('Control+Alt+h');
  await expect(dialog(page).getByLabel('Conversation history')).toBeVisible();
  await page.keyboard.press('Control+,');
  await page
    .getByRole('radiogroup', { name: 'Commands' })
    .getByRole('radio', { name: 'Deny' })
    .click();
  const starts = await page.evaluate(
    () => ((window as MockWindow).__igraspMock as unknown as AiMock).state.ai.starts,
  );
  expect(starts).toEqual([]);
});

test('a large file open: the chat asks before starting; closing the chat keeps Stop in the status bar', async ({
  page,
}) => {
  await openChat(page);
  await page.evaluate(() => {
    (window as MockWindow).__igraspMock?.writeFiles({
      'BIG.md': `# Big\n\n${'word '.repeat(70_000)}\n`,
    });
  });
  await treeItem(page, 'BIG.md').click();
  const input = dialog(page).getByLabel('Message', { exact: true });
  await input.fill('Summarize this');
  await input.press('Enter');
  const card = dialog(page).getByRole('group', { name: /Confirm/ });
  await expect(card).toContainText('Large');
  await expect(card).toContainText('BIG.md');
  const starts = () =>
    page.evaluate(() => ((window as MockWindow).__igraspMock as unknown as AiMock).state.ai.starts);
  expect(await starts()).toEqual([]);

  // Escape declines; nothing started.
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(await starts()).toEqual([]);

  // A slow answer, then the chat is closed: the status bar shows it with Stop.
  await input.fill('a slow answer about BIG.md');
  await input.press('Enter');
  await card.getByRole('button', { name: /^Start/ }).click();
  expect(await starts()).toEqual(['chatMessage']);
  await dialog(page).getByRole('button', { name: 'Close' }).click();
  const bar = page.getByRole('contentinfo', { name: 'Status bar' });
  await expect(bar.getByText('Mock AI is working…')).toBeVisible();
  await bar.getByRole('button', { name: 'Stop' }).click();
  await expect(bar.getByText('Mock AI is working…')).toHaveCount(0);
  await page.keyboard.press('Control+Alt+c');
  await expect(dialog(page).getByText('Stopped.')).toBeVisible();
});

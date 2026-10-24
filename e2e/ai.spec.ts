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

  // Escape closes it (nothing runs) and the focus goes back to the toolbar button.
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

const review = (page: Page) => page.locator('.tab-content .inline-review');
const fileOnDisk = (page: Page, path: string) =>
  page.evaluate(
    (p) =>
      (
        (window as MockWindow).__igraspMock as unknown as {
          state: { files: Map<string, string> };
        }
      ).state.files.get(p),
    path,
  );

async function ask(page: Page, prompt: string) {
  const input = dialog(page).getByLabel('Message', { exact: true });
  await input.fill(prompt);
  await input.press('Enter');
}

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

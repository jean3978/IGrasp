// Keyboard and screen reader paths of the AI features (plan §6.12): tab order, focus that comes
// back after a card, a review or a capture, the live region, and roles.

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ask, chatPanel, inlineReview, openChat, treeItem } from './helpers';

const announcer = (page: Page) => page.locator('.ai-announcer');

test('the chat comes right after the toolbar in the tab order, and is a non-modal dialog', async ({
  page,
}) => {
  await openChat(page);
  await expect(chatPanel(page)).toHaveAttribute('aria-modal', 'false');
  const handle = chatPanel(page).getByRole('heading', { name: 'Mock AI' });
  await handle.focus();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.titlebar')))).toBe(
    true,
  );
  // Escape (nothing running) closes the chat and the focus goes back to its button over the
  // view (there even with no tab open).
  await chatPanel(page).getByLabel('Message', { exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(chatPanel(page)).toHaveCount(0);
  await expect(page.locator('[data-action="ai.chat"]')).toBeFocused();
});

test('every control of the chat, the review and the status bar item has a name; icon-only ones a tooltip', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Please edit twice README.md');
  await expect(inlineReview(page).getByRole('group', { name: /^Change 2 of 2/ })).toBeVisible();
  await page.keyboard.press('Control+Alt+c');
  await expect(page.locator('.statusbar .ai-activity')).toBeVisible();
  await page.keyboard.press('Control+Alt+c');
  const scan = () =>
    page.evaluate(() => {
      const problems: string[] = [];
      const selector = [
        'button',
        'input',
        'select',
        'textarea',
        '[tabindex="0"]',
        'img',
        '[role="group"]',
      ].join(',');
      const scopes = Array.from(
        document.querySelectorAll('.ai-panel, .inline-review, .ai-activity'),
      );
      for (const scope of scopes) {
        for (const el of Array.from(scope.querySelectorAll<HTMLElement>(selector))) {
          const text = el.textContent.trim();
          const label = el.getAttribute('aria-label') ?? '';
          const labelled = el.getAttribute('aria-labelledby') !== null;
          const what = el.outerHTML.slice(0, 100);
          if (el.tagName === 'IMG') {
            if (el.getAttribute('alt') === null) problems.push(`image without alt: ${what}`);
            continue;
          }
          if (!text && !label && !labelled) problems.push(`no name: ${what}`);
          const iconOnly = el.tagName === 'BUTTON' && !text;
          if (iconOnly && !el.classList.contains('icon-button') && !el.title) {
            problems.push(`icon-only button without a tooltip: ${what}`);
          }
        }
      }
      return problems;
    });
  expect(await scan()).toEqual([]);
  await page.keyboard.press('Control+Alt+c');
  expect(await scan()).toEqual([]);
});

test('a permission is announced, and answering it leaves the focus in the message box', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Please run a command');
  await expect(announcer(page)).toContainText('Mock AI asks to use Bash');
  await chatPanel(page).getByRole('button', { name: 'Deny', exact: true }).click();
  await expect(announcer(page)).toContainText('Mock AI finished.');
  await expect(chatPanel(page).getByLabel('Message', { exact: true })).toBeFocused();
});

test('the review is reached from the chat by keyboard, and answered from its change units', async ({
  page,
}) => {
  await openChat(page);
  await ask(page, 'Please edit twice README.md');
  const card = chatPanel(page).getByRole('region', { name: 'Proposed edit to README.md' });
  await card.getByRole('button', { name: /Review in preview/ }).click();
  const first = inlineReview(page).getByRole('group', { name: /^Change 1 of 2: / });
  await expect(first).toBeFocused();
  await page.keyboard.press('a');
  await expect(inlineReview(page).getByRole('status')).toHaveText(
    'Change 1 accepted. 1 of 2 decided.',
  );
  await expect(first).toHaveAccessibleName(/^Change 1 of 2: .*, accepted$/);
  await inlineReview(page)
    .getByRole('group', { name: /^Change 2 of 2: / })
    .focus();
  await page.keyboard.press('r');
  await inlineReview(page).getByRole('button', { name: 'Apply' }).focus();
  await page.keyboard.press('Enter');
  // The review leaves with the focus: it goes to the document.
  await expect(inlineReview(page)).toHaveCount(0);
  await expect(page.locator('.tab-content .document-scroll')).toBeFocused();
});

test('a cancelled capture gives the focus back; a capture is announced', async ({ page }) => {
  await openChat(page);
  await treeItem(page, 'README.md').click();
  await expect(page.locator('.tab-content .markdown-body h1')).toBeVisible();
  const scroll = page.locator('.tab-content .document-scroll');
  await scroll.focus();
  const overlay = page.getByRole('application', { name: /Select a region/ });
  await page.keyboard.press('Control+Alt+r');
  await expect(overlay).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(overlay).toHaveCount(0);
  await expect(scroll).toBeFocused();

  await page.keyboard.press('Control+Alt+r');
  await page.keyboard.press('ArrowDown');
  await expect(overlay.getByRole('status')).toHaveText(/^Selection 200 by 120 pixels/);
  await page.keyboard.press('Enter');
  await expect(announcer(page)).toContainText(/Region attached: README\.md lines? \d+/);
  await expect(chatPanel(page).getByLabel('Message', { exact: true })).toBeFocused();
});

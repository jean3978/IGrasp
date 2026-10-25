import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The part of the mock backend's test controls (`window.__igraspMock`) the smoke tests use. */
export interface MockControls {
  writeFiles(files: Record<string, string>): void;
  deleteFiles(paths: string[]): void;
  state: { opened: string[] };
}

/** `window` in the page, with the mock backend's controls (absent in the real app). */
export type MockWindow = Window & { __igraspMock?: MockControls };

/** Loads the app and waits for the splash to finish. */
export async function start(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'IGrasp', level: 1 })).toBeVisible();
  await expect(page.locator('.splash')).toHaveCount(0);
}

/** Opens the mock fixture project from the welcome screen and waits for the tree. */
export async function openFixture(page: Page): Promise<void> {
  await start(page);
  await page.getByRole('button', { name: /Open Folder…/ }).click();
  await expect(page.getByRole('treeitem', { name: 'README.md', exact: true })).toBeVisible();
}

export const treeItem = (page: Page, name: string) =>
  page.getByRole('treeitem', { name, exact: true });

/** The mock AI provider's state (`window.__igraspMock.state`), as far as the tests read it. */
export interface AiMock {
  state: {
    files: Map<string, string>;
    ai: {
      loggedIn: boolean;
      starts: string[];
      lastRequest: {
        prompt: string;
        resumeId?: string;
        context: { path: string }[];
        images: { mediaType: string; dataBase64: string }[];
        capture?: {
          sourcePath: string;
          firstLine: number;
          lastLine: number;
          text: string;
          selection?: string;
        };
      } | null;
    };
  };
}

/**
 * Runs `fn` in the page with the mock backend and returns its (serializable) result. `fn` is
 * serialized, so it must not use variables from the test.
 */
export const aiMock = <T = void>(page: Page, fn: (mock: AiMock) => T): Promise<T> =>
  page.evaluate((body) => {
    const mock = (window as MockWindow).__igraspMock as unknown as AiMock;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs in the page
    return (new Function('mock', `return ${body}`) as (m: AiMock) => T)(mock);
  }, `(${fn.toString()})(mock)`);

export const chatPanel = (page: Page) => page.getByRole('dialog', { name: 'Mock AI' });
export const docBody = (page: Page) => page.locator('.tab-content .markdown-body');
export const inlineReview = (page: Page) => page.locator('.tab-content .inline-review');

/** The content of a file of the mock project (what the provider would find on disk). */
export const fileOnDisk = (page: Page, path: string): Promise<string | undefined> =>
  page.evaluate(
    (p) => ((window as MockWindow).__igraspMock as unknown as AiMock).state.files.get(p),
    path,
  );

/** Opens the fixture project, then the AI chat with its shortcut. */
export async function openChat(page: Page): Promise<void> {
  await openFixture(page);
  await page.keyboard.press('Control+Alt+c');
  await expect(chatPanel(page)).toBeVisible();
  // The subtitle under the title: version · account · session.
  await expect(chatPanel(page).getByText(/^1\.0-mock · /)).toBeVisible();
}

/** Sends `prompt` from the chat box. */
export async function ask(page: Page, prompt: string): Promise<void> {
  const input = chatPanel(page).getByLabel('Message', { exact: true });
  await input.fill(prompt);
  await input.press('Enter');
}

/** A rectangle in pixels, relative to the top left of the document area. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Region capture by mouse: starts the selection with Ctrl+Alt+R, drags `rect` (relative to the
 * document area) and waits for the overlay to go away.
 */
export async function capture(page: Page, rect: Region): Promise<void> {
  const area = await page.locator('.tab-content .document-scroll').boundingBox();
  if (!area) throw new Error('no document area');
  await page.keyboard.press('Control+Alt+r');
  const overlay = page.getByRole('application', { name: /Select a region/ });
  await expect(overlay).toBeVisible();
  const x = area.x + rect.x;
  const y = area.y + rect.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + rect.width, y + rect.height, { steps: 4 });
  await page.mouse.up();
  await expect(overlay).toHaveCount(0);
}

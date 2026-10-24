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

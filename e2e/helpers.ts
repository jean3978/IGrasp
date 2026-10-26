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

/** The mock backend's quiz state, as far as the quiz tests read and drive it. */
export interface QuizMock {
  state: {
    files: Map<string, string>;
    saved: { kind: 'results' | 'quiz'; relPath: string; markdown: string }[];
    ai: {
      loggedIn: boolean;
      stepMs: number;
      starts: string[];
      quizScript: 'valid' | 'retry' | 'exhaust' | 'thin' | 'textOnly' | 'slow' | 'leak';
    };
  };
}

export const quizMock = <T = void>(page: Page, fn: (mock: QuizMock) => T): Promise<T> =>
  page.evaluate((body) => {
    const mock = (window as MockWindow).__igraspMock as unknown as QuizMock;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs in the page
    return (new Function('mock', `return ${body}`) as (m: QuizMock) => T)(mock);
  }, `(${fn.toString()})(mock)`);

/** Opens the fixture project, then the Quiz tab with its shortcut (free: nothing is sent). */
export async function openQuiz(page: Page): Promise<void> {
  await openFixture(page);
  await quizMock(page, (m) => {
    m.state.ai.stepMs = 5;
  });
  await page.keyboard.press('Control+Alt+q');
  await expect(page.getByRole('heading', { name: 'Quiz', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Who are you on this project?' })).toBeVisible();
}

export type QuizKindLabel = 'Global concepts' | 'A feature' | 'Check specific code';

export interface WizardChoice {
  /** A proposed role (default: the first one), or `other` typed. */
  role?: string;
  otherRole?: string;
  kind?: QuizKindLabel;
  /** A subject chip of the global concepts or the features. */
  subject?: string;
  /** "Something else": a concept or feature typed. */
  custom?: string;
  /** Code to check. */
  paths?: string[];
}

/** Walks the new-quiz wizard to its options step: role, kind, subject, with Next between. */
export async function toOptions(page: Page, choice: WizardChoice = {}): Promise<void> {
  if (choice.otherRole)
    await page.getByRole('textbox', { name: 'Other role' }).fill(choice.otherRole);
  else if (choice.role) await page.getByRole('radio', { name: choice.role }).click();
  else await page.getByRole('radiogroup', { name: 'Roles' }).getByRole('radio').first().click();
  await page.getByRole('button', { name: /^Next/ }).click();
  await page.getByRole('radio', { name: new RegExp(choice.kind ?? 'Global concepts') }).click();
  if (choice.subject) await page.getByRole('radio', { name: choice.subject }).click();
  if (choice.custom)
    await page.getByRole('textbox', { name: 'Something else' }).fill(choice.custom);
  for (const p of choice.paths ?? []) {
    await page.getByLabel('A file or folder to check').fill(p);
    await page.keyboard.press('Enter');
  }
  await page.getByRole('button', { name: /^Next/ }).click();
  await expect(page.getByRole('heading', { name: 'How should the quiz go?' })).toBeVisible();
}

/** Sets up a new quiz with the wizard, then Start and the confirmation card's Start. */
export async function startQuiz(
  page: Page,
  options: WizardChoice & { mode?: 'Fixed' | 'Adaptive'; count?: number } = {},
): Promise<void> {
  await toOptions(page, options);
  if (options.mode) await page.getByRole('radio', { name: options.mode, exact: true }).click();
  if (options.count !== undefined)
    await page.getByLabel('Questions', { exact: true }).fill(String(options.count));
  await page.getByRole('button', { name: /^Start/ }).click();
  const card = page.getByRole('group', { name: /Confirm/ });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /Start/ }).click();
}

export const quizCard = (page: Page) => page.getByRole('article');

/**
 * Answers every question on screen with the keyboard (the first choice, then Enter), until the
 * results or a Next round button. Returns the number of questions answered.
 */
export async function answerAll(page: Page): Promise<number> {
  let answered = 0;
  for (;;) {
    const done = page.locator('.quiz-results, .quiz-next:has-text("Next round")');
    if ((await done.count()) > 0) return answered;
    await expect(quizCard(page)).toBeVisible();
    await page.keyboard.press('1');
    answered++;
    const next = page.locator('.quiz-next');
    await expect(next).toBeFocused();
    if ((await next.textContent())?.includes('Next round')) return answered;
    await page.keyboard.press('Enter');
    await expect(page.locator('.quiz-results, .quiz-card:not(:has(.quiz-reveal))')).toHaveCount(1);
  }
}

/** The markdown files written by Save results… and Save quiz… (the mock dialog). */
export const savedMarkdown = (page: Page) => quizMock(page, (m) => m.state.saved);

/** Plays a saved quiz from the Saved quizzes list of the quiz home. */
export async function playSavedQuiz(page: Page, path: string): Promise<void> {
  await page
    .getByRole('region', { name: 'Saved quizzes' })
    .getByRole('button', { name: new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
    .click();
  await expect(quizCard(page)).toBeVisible();
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

/** The mock backend's Academy state, as far as the tests read or set it. */
export interface AcademyMock {
  state: {
    files: Map<string, string>;
    ai: { stepMs: number; starts: string[] };
  };
  writeFiles(files: Record<string, string>): void;
  addSharedTutorial(): string;
}

export const academyMock = <T = void>(page: Page, fn: (mock: AcademyMock) => T): Promise<T> =>
  page.evaluate((body) => {
    const mock = (window as MockWindow).__igraspMock as unknown as AcademyMock;
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- runs in the page
    return (new Function('mock', `return ${body}`) as (m: AcademyMock) => T)(mock);
  }, `(${fn.toString()})(mock)`);

/** Opens the fixture project, then the Academy with its shortcut (free: nothing is sent). */
export async function openAcademy(page: Page): Promise<void> {
  await openFixture(page);
  await academyMock(page, (m) => {
    m.state.ai.stepMs = 5;
  });
  await page.keyboard.press('Control+Alt+a');
  await expect(page.locator('.academy-home')).toBeVisible();
  // Hoot's welcome plays for under four seconds over the tab, then goes.
  await expect(page.locator('.academy-welcome')).toHaveCount(0, { timeout: 5000 });
}

/** The first step of "New tutorial": the first proposed role, then Next. */
export async function pickTutorialRole(page: Page): Promise<void> {
  await page.getByRole('radiogroup', { name: 'Roles' }).getByRole('radio').first().click();
  await page.getByRole('button', { name: /^Next/ }).click();
}

/**
 * Writes a tutorial with the mock AI: the first proposed role, a typed subject, its options, the
 * outline's card and Start, then every chapter's card and Start. Ends on the course map.
 */
export async function writeTutorial(page: Page, subject = 'How igrasp-demo starts'): Promise<void> {
  await page.getByRole('button', { name: 'New tutorial' }).click();
  await pickTutorialRole(page);
  await page.getByPlaceholder(/How does a file change/).fill(subject);
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: /Plan the outline/ }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(page.locator('.academy-outline')).toBeVisible();
  await page.getByRole('button', { name: /^Write \d+ chapters/ }).click();
  await page.getByRole('button', { name: /^Start/ }).click();
  await expect(
    page.getByRole('list', { name: 'Chapters' }).getByRole('button', { name: /Chapter 1:/ }),
  ).toBeVisible();
}

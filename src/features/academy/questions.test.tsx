// Asking about a step: highlight text of a step card (the text tool), ask in the chat, save the
// question and the answer on the step; a shared tutorial gains it through the write
// confirmation, without any name. Only the Send of the chat message starts the AI.

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT, FIXTURE_SHARED_TUTORIAL } from '../../ipc/mock/fixture';
import type { TutorialRef } from '../../ipc/types';
import { useAcademy } from '../../stores/academy';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { useAiProvider } from '../../stores/aiProvider';
import { startEventBridge } from '../../stores/eventBridge';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useTutorialPlayer } from '../../stores/tutorialPlayer';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { Transcript } from '../ai/Transcript';
import { CaptureHost } from '../capture/CaptureHost';
import { runAction } from '../titlebar/menuActions';
import { AcademyTab } from './AcademyTab';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('no mock');
  return m;
};

let stop = () => {};

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  resetAiStores();
  await useSettings.getState().load();
  useAcademy.getState().leaveFolder();
  useTutorialPlayer.getState().close();
  useTutorialWrite.setState({ pending: null, busy: false, error: null });
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
});

afterEach(() => {
  stop();
});

/** The Academy on chapter 1, step 1 of `ref`, with the capture host and the chat transcript. */
async function onFirstStep(ref: TutorialRef) {
  useTabs.getState().openSpecial('academy');
  useAcademy.getState().openTutorial(ref);
  render(
    <Tooltip.Provider>
      <div className="tab-content">
        <AcademyTab />
      </div>
      <CaptureHost />
      <Transcript />
    </Tooltip.Provider>,
  );
  await screen.findByRole('list', { name: 'Chapters' });
  act(() => {
    useTutorialPlayer.getState().openChapter(0);
  });
  return screen.findByRole('article', { name: /^Explain:/ });
}

/** Highlights the first words of the step's body with the text tool and releases the mouse. */
async function highlight(card: HTMLElement): Promise<string> {
  act(() => {
    runAction('ai.selectText');
  });
  const paragraph = await waitFor(() => {
    const p = card.querySelector('.academy-step-body p');
    if (!p?.firstChild) throw new Error('not rendered yet');
    return p;
  });
  const text = paragraph.firstChild as Text;
  fireEvent.mouseDown(paragraph, { button: 0 });
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, 12);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  fireEvent.mouseUp(paragraph, { button: 0 });
  return range.toString().trim();
}

async function ask(question: string) {
  await act(async () => {
    await useAiConversation.getState().send(question);
  });
  await waitFor(() => {
    expect(selectBusy(useAiConversation.getState())).toBe(false);
  });
}

describe('a question about a step', () => {
  it('attaches the step, sends it with the question, and saves the answer on the step', async () => {
    const t = structuredClone(FIXTURE_SHARED_TUTORIAL.tutorial);
    t.id = '';
    for (const c of t.chapters) c.questions = [];
    const saved = (await backend.saveTutorial(t)).tutorial;
    const ref = { type: 'private', id: saved.id } as const;
    const card = await onFirstStep(ref);
    const quote = await highlight(card);
    await waitFor(() => {
      expect(useAiPanel.getState().attachment?.step).toMatchObject({
        chapter: 0,
        step: 0,
        quote,
      });
    });
    expect(mock().state.ai.starts).toEqual([]);

    await ask('Why is it built there?');
    expect(mock().state.ai.starts).toEqual(['chatMessage']);
    const request = mock().state.ai.lastRequest;
    expect(request?.prompt).toContain(`The user is taking the tutorial "${saved.title}"`);
    expect(request?.prompt).toContain(`> ${quote}`);
    expect(request?.prompt.endsWith('Their question: Why is it built there?')).toBe(true);
    expect(request?.context.some((d) => d.path === 'src/main.ts')).toBe(true);

    const item = screen.getByRole('group', { name: /^About Chapter 1, step 1:/ });
    await userEvent.click(within(item).getByRole('button', { name: /Save to this step/ }));
    expect(await within(item).findByRole('status')).toHaveTextContent('Saved on the step');
    const after = await backend.getTutorial(ref);
    expect(after.chapters[0]?.questions).toEqual([
      expect.objectContaining({ step: 0, quote, question: 'Why is it built there?' }),
    ]);
    expect(Object.keys(after.chapters[0]?.questions[0] ?? {}).sort()).toEqual([
      'answer',
      'question',
      'quote',
      'step',
    ]);
    // On the card, and removable.
    const section = await within(card).findByRole('region', { name: 'Questions from readers' });
    expect(section).toHaveTextContent('1 question from a reader');
    await userEvent.click(within(section).getByRole('button', { name: /Remove the question/ }));
    await waitFor(async () => {
      expect((await backend.getTutorial(ref)).chapters[0]?.questions).toEqual([]);
    });
    // Saving and removing spent nothing.
    expect(mock().state.ai.starts).toEqual(['chatMessage']);
  });

  it('writes a shared tutorial only after the confirmation, anonymously', async () => {
    const readme = mock().addSharedTutorial();
    const card = await onFirstStep({ type: 'shared', relPath: readme });
    await highlight(card);
    await waitFor(() => {
      expect(useAiPanel.getState().attachment?.step).toBeDefined();
    });
    await ask('What calls this?');
    const item = screen.getByRole('group', { name: /^About Chapter 1, step 1:/ });
    await userEvent.click(within(item).getByRole('button', { name: /Save to this step/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Update the shared tutorial' });
    const chapterFile = `${FIXTURE_SHARED_TUTORIAL.folder}/01-the-entry-point-main-in-src-main-ts.md`;
    expect(mock().state.files.get(chapterFile)).not.toContain('What calls this?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Write' }));
    await waitFor(() => {
      expect(mock().state.files.get(chapterFile)).toContain('## Questions from readers');
    });
    const text = mock().state.files.get(chapterFile) ?? '';
    expect(text).toContain('question: What calls this?');
    expect(text).not.toMatch(/Demo Reader|asked by|author/i);
  });
});

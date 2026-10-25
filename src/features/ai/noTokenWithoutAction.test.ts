// Rule 1 of the AI integration principles: no token without a user action. Opening a folder,
// changing files, opening every view, tab kind and document, and every AI setting must not start
// an AI operation. Only `send` (when no confirmation is needed) and Start on the confirmation
// card add to `starts`.

import { act, render, screen, waitFor } from '@testing-library/react';
import { Tooltip } from 'radix-ui';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { backend } from '../../ipc/client';
import { DEFAULT_SETTINGS } from '../../ipc/defaults';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type { Conversation, SidebarView } from '../../ipc/types';
import { MODEL_SAVE_DELAY_MS, useAiProvider } from '../../stores/aiProvider';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { startEventBridge } from '../../stores/eventBridge';
import { useGraph } from '../../stores/graph';
import { useOutline } from '../../stores/outline';
import { useProjectProfile } from '../../stores/projectProfile';
import { useQuiz } from '../../stores/quiz';
import { useUi } from '../../stores/ui';
import { useQuickOpen } from '../../stores/quickOpen';
import { useSearch } from '../../stores/search';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { CaptureHost } from '../capture/CaptureHost';
import { CAPTURE_SOURCE, drag, mountDocument } from '../../test/captureDom';
import { useDocuments } from '../../stores/documents';
import { actions, runAction } from '../titlebar/menuActions';
import { AiPanel } from './AiPanel';
import { resetAiStores } from '../../test/resetAi';
import type { ActionId } from '../titlebar/menuActions';

let stop: () => void = () => undefined;
const starts = () => window.__igraspMock?.state.ai.starts ?? [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  useAiPanel.setState({ open: false, rect: null, draft: '' });
  resetAiStores();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await useSettings.getState().load();
  stop = await startEventBridge();
});

afterEach(async () => {
  stop();
  useAiConversation.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

describe('no token without a user action', () => {
  it('never starts an AI operation while browsing the project', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(useGraph.getState().status.ready).toBe(true);
    });

    // Every sidebar view, the right panel and the AI panel itself.
    const views: SidebarView[] = ['explorer', 'search', 'recent', 'broken'];
    for (const view of views) useWorkspace.getState().setSidebarView(view);
    useWorkspace.getState().setRightPanelVisible(true);
    useAiPanel.getState().setOpen(true);
    await useAiProvider.getState().checkStatus();

    // Documents, searches and quick open.
    useTabs.getState().openDocument('README.md');
    useTabs.getState().openDocument('getting-started.md');
    useSearch.getState().setQuery('agent');
    await useSearch.getState().run();
    useQuickOpen.getState().setQuery('install');

    // Files changing on disk, as an agent would.
    window.__igraspMock?.writeFiles({ 'notes/new.md': '# New\n', 'README.md': '# Changed\n' });
    window.__igraspMock?.deleteFiles(['notes/new.md']);
    await settle();

    expect(starts()).toEqual([]);

    // Only a message sent by the user starts one.
    await useAiConversation.getState().send('hello');
    expect(starts()).toEqual(['chatMessage']);
  });

  it('starts nothing from any view, tab kind, outline, backlinks or AI action of the UI', async () => {
    render(createElement(App));
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(useGraph.getState().status.ready).toBe(true);
    });

    // Every action of the menus, the toolbar and the shortcuts that works without a dialog.
    const skipped: ActionId[] = ['file.exit', 'file.openFolder', 'file.closeFolder'];
    const ids = (Object.keys(actions) as ActionId[]).filter((id) => !skipped.includes(id));
    for (const id of ids) {
      runAction(id);
      await settle();
    }
    expect(useAiPanel.getState().open).toBeDefined();

    // Every tab kind: document, code, settings, shortcuts.
    useTabs.getState().openDocument('README.md');
    useTabs.getState().openCode('src/main.ts');
    useTabs.getState().openSpecial('settings');
    useTabs.getState().openSpecial('shortcuts');
    useTabs.getState().activateIndex(1);

    // The right panel's outline and backlinks of a document that has both.
    useTabs.getState().openDocument('docs/guide/getting-started.md');
    useWorkspace.getState().setRightPanelVisible(true);
    await waitFor(() => {
      expect(Object.keys(useOutline.getState().byPath).length).toBeGreaterThan(0);
    });
    await screen.findAllByText(/Outline|Backlinks/i);

    // The AI chat opens and checks the provider, which is free.
    runAction('ai.chat');
    useAiPanel.setState({ open: true });
    await screen.findAllByRole('dialog');
    await useAiProvider.getState().checkStatus(true);
    await settle();

    // With the panel open, switching tabs lists the context again (metadata only).
    const contextCalls = vi.spyOn(backend, 'aiContext');
    useTabs.getState().openDocument('README.md');
    await settle();
    useTabs.getState().openCode('src/main.ts');
    await settle();
    useTabs.getState().openSpecial('settings');
    await settle();
    useTabs.getState().openDocument('docs/guide/getting-started.md');
    await settle();
    expect(contextCalls.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(useAiPanel.getState().context?.currentPath).toBe('docs/guide/getting-started.md');
    contextCalls.mockRestore();

    expect(starts()).toEqual([]);
  });

  it('starts nothing from the history, the context, the model and the permission settings', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAiProvider.getState().checkStatus();

    // History: saving, listing, loading, deleting and forgetting conversations.
    const conversation: Conversation = {
      id: 'c1',
      title: 'hello',
      createdMs: 1,
      updatedMs: 2,
      providerId: 'mock',
      model: '',
      resumeId: null,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
      items: [],
    };
    await backend.saveConversation(conversation);
    expect(await backend.listConversations()).toHaveLength(1);
    await backend.getConversation('c1');
    await backend.deleteConversation('c1');
    await backend.forgetConversations();

    // The same through the chat: the history list, loading a past conversation (with a resume
    // id), saving it, New conversation, deleting, forgetting, leaving the folder.
    await backend.saveConversation({
      ...conversation,
      id: 'c2',
      resumeId: 'some-session',
      items: [{ kind: 'user', id: 'u', text: 'hello' }],
    });
    useAiPanel.setState({ open: true, historyOpen: true });
    const panel = render(createElement(Tooltip.Provider, null, createElement(AiPanel)));
    await screen.findByRole('option', { name: 'hello' });
    await useAiConversation.getState().loadHistory();
    await useAiConversation.getState().load('c2');
    await useAiConversation.getState().save();
    useAiConversation.getState().newConversation();
    runAction('ai.newConversation');
    runAction('ai.history');
    await useAiConversation.getState().load('c2');
    await useAiConversation.getState().remove('c2');
    await useAiConversation.getState().forgetAll();
    await useAiConversation.getState().leaveFolder();
    panel.unmount();
    useAiPanel.setState({ open: false, historyOpen: false });
    expect(starts()).toEqual([]);

    // Context and size estimates, for the current file and for the paths.
    const documents = await backend.aiContext('docs/guide/getting-started.md');
    await backend.aiEstimate({
      promptBytes: 10,
      contextPaths: documents.map((d) => d.path),
      images: 0,
    });
    await backend.aiContext(null);
    await backend.aiCapabilities();
    await useAiProvider.getState().loadProviders();

    // The model picker and the provider setting.
    useAiProvider.getState().setModel('mock-smart');
    await new Promise((resolve) => setTimeout(resolve, MODEL_SAVE_DELAY_MS * 2));
    await useAiProvider.getState().setProvider('mock');

    // The permission, confirmation and history settings.
    await useSettings.getState().update({
      ai: {
        confirmFrom: 'medium',
        historyLimit: 20,
        permissions: { markdownEdits: 'allow', commands: 'deny', web: 'deny' },
      },
    });
    await useSettings.getState().update({ ai: { confirmFrom: 'never' } });

    // The project profile and its corrections (local detection).
    await useProjectProfile.getState().load(FIXTURE_ROOT, true);
    await useProjectProfile.getState().loadSubjects();
    await useProjectProfile.getState().saveCorrections({
      addKinds: ['service'],
      removeKinds: [],
      addEngines: [],
      removeEngines: [],
      addFrameworks: ['Nakama'],
      removeFrameworks: [],
      notes: 'Also a dedicated server.',
    });

    expect(starts()).toEqual([]);
  });

  it('starts only when the user sends, and, past the threshold, only on Start', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAiProvider.getState().checkStatus();

    // A small message goes straight through.
    await useAiConversation.getState().send('hello');
    expect(starts()).toEqual(['chatMessage']);
    await vi.waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });

    // A large one waits on the card: asking, estimating and showing it start nothing.
    useTabs.getState().openCode('logs/huge.log');
    await useAiConversation.getState().send('summarize');
    expect(useAiConversation.getState().pendingConfirm).not.toBeNull();
    expect(starts()).toEqual(['chatMessage']);
    useAiConversation.getState().cancelConfirm();
    expect(starts()).toEqual(['chatMessage']);

    await useAiConversation.getState().send('summarize again');
    expect(starts()).toEqual(['chatMessage']);
    await useAiConversation.getState().confirmStart();
    expect(starts()).toEqual(['chatMessage', 'chatMessage']);
  });

  it('starts nothing when a region is captured; only Send does', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAiProvider.getState().checkStatus();
    useTabs.getState().openDocument('README.md');
    await settle();
    useDocuments.setState({
      byPath: {
        'README.md': {
          status: 'ready',
          content: CAPTURE_SOURCE,
          size: CAPTURE_SOURCE.length,
          modifiedMs: 0,
          error: null,
          revision: 1,
        },
      },
    });
    const page = mountDocument();
    render(createElement(CaptureHost));
    act(() => {
      runAction('ai.capture');
    });
    await waitFor(() => {
      expect(document.querySelector('.capture-overlay')).not.toBeNull();
    });
    act(() => {
      drag([20, 52], [300, 76]);
    });
    await waitFor(() => {
      expect(useAiPanel.getState().attachment).not.toBeNull();
    });
    await settle();
    expect(starts()).toEqual([]);

    // The user's Send starts the one operation, with the region.
    await useAiConversation.getState().send('Explain this');
    expect(starts()).toEqual(['chatMessage']);
    expect(window.__igraspMock?.state.ai.lastRequest?.capture?.text).toBe('First paragraph.');
    page.remove();
  });

  it('starts a quiz only from its card, a Next round click or Keep going, never from playing', async () => {
    render(createElement(App));
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await vi.waitFor(() => {
      expect(useGraph.getState().status.ready).toBe(true);
    });
    const mock = window.__igraspMock;
    if (!mock) throw new Error('no mock');
    mock.state.ai.stepMs = 1;
    // Opening the Quiz tab (menu, toolbar, profile) loads the profile, the subjects and the
    // history: all local.
    runAction('learn.quiz');
    await vi.waitFor(() => {
      expect(document.querySelector('.quiz-home')).not.toBeNull();
    });
    runAction('learn.profile');
    await vi.waitFor(() => {
      expect(document.querySelector('.profile-dialog')).not.toBeNull();
    });
    useUi.setState({ profileEditorOpen: false });
    const quiz = () => useQuiz.getState();
    quiz().setSetup({
      subjectId: 'build',
      mode: 'adaptive',
      count: 10,
      scope: 'documentationOnly',
    });
    quiz().setSetup({ subjectId: null, mode: 'fixed', count: 5, scope: 'wholeProject' });
    await quiz().prepare();
    quiz().cancelConfirm();
    await settle();
    expect(starts()).toEqual([]);

    // Start on the card: one.
    await quiz().prepare();
    await quiz().confirmStart();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    expect(starts()).toEqual(['quizGeneration']);

    // Playing, hints, the results, playing again, going home: none.
    for (let i = 0; i < 5; i++) {
      quiz().hint();
      const { record, engine } = quiz();
      const q = record?.questions.find((x) => x.id === engine?.current);
      quiz().answer(q?.answer ?? 0);
      quiz().next();
    }
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('results');
    });
    await quiz().playAgain();
    quiz().goHome();
    quiz().continueSaved();
    quiz().newQuiz();
    await settle();
    expect(starts()).toEqual(['quizGeneration']);

    // Adaptive: round 1 from the card, nothing while playing it, one more on Next round.
    quiz().setSetup({ mode: 'adaptive', count: 10 });
    await quiz().prepare();
    await quiz().confirmStart();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    for (let i = 0; i < 5; i++) {
      const { record, engine } = quiz();
      const q = record?.questions.find((x) => x.id === engine?.current);
      quiz().answer(q?.answer ?? 0);
      if (i < 4) quiz().next();
    }
    // `next` on the last question of a round never starts the round.
    quiz().next();
    await settle();
    expect(starts()).toEqual(['quizGeneration', 'quizGeneration']);
    await quiz().nextRound();
    await vi.waitFor(() => {
      expect(quiz().screen).toBe('question');
    });
    expect(starts()).toHaveLength(3);
  });
});

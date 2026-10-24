// Rule 1 of the AI integration principles: no token without a user action. Opening a folder,
// changing files, opening every view, tab kind and document, and every AI setting must not start
// an AI operation. Only `send` (when no confirmation is needed) and Start on the confirmation
// card add to `starts`.

import { render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App';
import { backend } from '../../ipc/client';
import { DEFAULT_SETTINGS } from '../../ipc/defaults';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import type { Conversation, SidebarView } from '../../ipc/types';
import { MODEL_SAVE_DELAY_MS, useAi } from '../../stores/ai';
import { useAiPanel } from '../../stores/aiPanel';
import { startEventBridge } from '../../stores/eventBridge';
import { useGraph } from '../../stores/graph';
import { useOutline } from '../../stores/outline';
import { useQuickOpen } from '../../stores/quickOpen';
import { useSearch } from '../../stores/search';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { actions, runAction } from '../titlebar/menuActions';
import type { ActionId } from '../titlebar/menuActions';

let stop: () => void = () => undefined;
const starts = () => window.__igraspMock?.state.ai.starts ?? [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(async () => {
  window.__igraspMock?.reset();
  useTabs.setState({ tabs: [], activeId: null });
  useAiPanel.setState({ open: false, rect: null, draft: '' });
  useAi.setState({
    status: null,
    capabilities: null,
    providers: null,
    model: '',
    resumeId: null,
    operationId: null,
    starting: false,
    pendingConfirm: null,
    items: [],
    permissions: [],
  });
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await useSettings.getState().load();
  stop = await startEventBridge();
});

afterEach(async () => {
  stop();
  useAi.getState().newConversation();
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
    await useAi.getState().checkStatus();

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
    await useAi.getState().send('hello');
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
    await useAi.getState().checkStatus(true);
    await settle();

    expect(starts()).toEqual([]);
  });

  it('starts nothing from the history, the context, the model and the permission settings', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAi.getState().checkStatus();

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

    // Context and size estimates, for the current file and for the paths.
    const documents = await backend.aiContext('docs/guide/getting-started.md');
    await backend.aiEstimate({
      promptBytes: 10,
      contextPaths: documents.map((d) => d.path),
      images: 0,
    });
    await backend.aiContext(null);
    await backend.aiCapabilities();
    await useAi.getState().loadProviders();

    // The model picker and the provider setting.
    useAi.getState().setModel('mock-smart');
    await new Promise((resolve) => setTimeout(resolve, MODEL_SAVE_DELAY_MS * 2));
    await useAi.getState().setProvider('mock');

    // The permission, confirmation and history settings.
    await useSettings.getState().update({
      ai: {
        confirmFrom: 'medium',
        historyLimit: 20,
        permissions: { markdownEdits: 'allow', commands: 'deny', web: 'deny' },
      },
    });
    await useSettings.getState().update({ ai: { confirmFrom: 'never' } });

    expect(starts()).toEqual([]);
  });

  it('starts only when the user sends, and, past the threshold, only on Start', async () => {
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAi.getState().checkStatus();

    // A small message goes straight through.
    await useAi.getState().send('hello');
    expect(starts()).toEqual(['chatMessage']);
    await vi.waitFor(() => {
      expect(useAi.getState().operationId).toBeNull();
    });

    // A large one waits on the card: asking, estimating and showing it start nothing.
    useTabs.getState().openCode('logs/huge.log');
    await useAi.getState().send('summarize');
    expect(useAi.getState().pendingConfirm).not.toBeNull();
    expect(starts()).toEqual(['chatMessage']);
    useAi.getState().cancelConfirm();
    expect(starts()).toEqual(['chatMessage']);

    await useAi.getState().send('summarize again');
    expect(starts()).toEqual(['chatMessage']);
    await useAi.getState().confirmStart();
    expect(starts()).toEqual(['chatMessage', 'chatMessage']);
  });
});

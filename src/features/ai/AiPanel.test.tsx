import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../../ipc/client';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import {
  MOCK_APPLIED_TEXT,
  MOCK_LATE_LOGIN_ERROR,
  MOCK_NOT_INSTALLED,
  MOCK_NOT_LOGGED_IN,
  MOCK_NOT_LOGGED_IN_HELP,
  MOCK_PROVIDER_NAME,
  MOCK_PROVIDER_VERSION,
  MOCK_REJECTED_TEXT,
} from '../../ipc/mock/mockAi';
import { REJECTION_MESSAGE, useAiConversation } from '../../stores/aiConversation';
import { startEventBridge } from '../../stores/eventBridge';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import {
  PANEL_DEFAULT_WIDTH,
  PANEL_KEY_STEP,
  PANEL_MIN_HEIGHT,
  PANEL_MIN_WIDTH,
  selectPanelRect,
  useAiPanel,
} from '../../stores/aiPanel';
import { AiPanel } from './AiPanel';
import { Message } from './Transcript';
import { resetAiStores } from '../../test/resetAi';

let stop: () => void = () => undefined;

function resetStore() {
  resetAiStores();
}

beforeEach(async () => {
  window.__igraspMock?.reset();
  if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 1;
  resetStore();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  // Opening a folder restores its panel (closed for the fixture): open it for the tests.
  useAiPanel.setState({ open: true, rect: null, draft: '' });
});

afterEach(async () => {
  stop();
  useAiConversation.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

const composer = () => screen.getByLabelText('Message');
/** The subtitle under the chat title: version · account · session. */
const statusLine = new RegExp(`^${MOCK_PROVIDER_VERSION} · `);

const renderPanel = () =>
  render(
    <Tooltip.Provider>
      <AiPanel />
    </Tooltip.Provider>,
  );

describe('AiPanel', () => {
  it('shows the provider status, uses its name and streams a plain answer', async () => {
    const user = userEvent.setup();
    renderPanel();
    expect(await screen.findByText(statusLine)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: MOCK_PROVIDER_NAME })).toBeInTheDocument();
    // The model list comes from the provider's capabilities.
    expect(screen.getByLabelText('Model')).toHaveValue('mock-fast');

    await user.type(composer(), 'What is this project?{Enter}');
    expect(screen.getByText('What is this project?')).toBeInTheDocument();
    expect(await screen.findByText(/This is the mock AI/)).toBeInTheDocument();
    await waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });
    expect(useAiConversation.getState().resumeId).toMatch(/^00000000-/);
    expect(screen.getByText(/session 00000000/)).toBeInTheDocument();
    expect(screen.getByText(/1280 tokens · \$0\.0031/)).toBeInTheDocument();
    expect(window.__igraspMock?.state.ai.starts).toEqual(['chatMessage']);
    expect(composer()).toHaveValue('');
  });

  it('shows a proposed code edit as a line diff and applies it when accepted', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Please edit src/main.ts{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to main.ts' });
    expect(within(card).getByText(/Proposed edit · src\/main.ts/)).toBeInTheDocument();
    expect(within(card).getByText(/\(edited by the AI\)/)).toBeInTheDocument();
    expect(within(card).getByText('+1')).toBeInTheDocument();
    expect(within(card).getByText('−1')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /Accept/ }));
    expect(await screen.findByText(MOCK_APPLIED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Proposed edit/ })).not.toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('src/main.ts')).toContain('(edited by the AI)');
    expect(screen.getByText('Edit src/main.ts')).toBeInTheDocument();
    // Not a markdown edit: nothing is reviewed in the preview.
    expect(useAiConversation.getState().pendingReview).toBeNull();
  });

  it('leaves the file alone when the edit is rejected', async () => {
    const user = userEvent.setup();
    const before = window.__igraspMock?.state.files.get('src/main.ts');
    renderPanel();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Please edit src/main.ts{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to main.ts' });
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(MOCK_REJECTED_TEXT)).toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('src/main.ts')).toBe(before);
    expect(screen.getByText(/Edit src\/main.ts — refused or failed/)).toBeInTheDocument();
  });

  it('points a markdown edit to the review in the preview, and accepts it from the card', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Please edit README.md{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to README.md' });
    expect(
      await within(card).findByText(`${MOCK_PROVIDER_NAME} proposes 1 change to README.md`),
    ).toBeInTheDocument();
    // The review opened the document's tab.
    expect(useTabs.getState().tabs.map((t) => t.relPath)).toEqual(['README.md']);
    useTabs.setState({ tabs: [], activeId: null });
    await user.click(within(card).getByRole('button', { name: /Review in preview/ }));
    expect(useTabs.getState().tabs.map((t) => t.relPath)).toEqual(['README.md']);

    await user.click(within(card).getByRole('button', { name: /Accept all/ }));
    expect(await screen.findByText(MOCK_APPLIED_TEXT)).toBeInTheDocument();
    expect(screen.getByText('Applied the change to README.md.')).toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('README.md')).toContain('(edited by the AI)');
    expect(useAiConversation.getState().pendingReview).toBeNull();
  });

  it('asks before running a command, naming the provider', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Run a command to list recent commits{Enter}');
    const card = await screen.findByRole('region', { name: 'Permission for Bash' });
    expect(within(card).getByText(/Mock AI wants to use Bash: git log/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Here is what I found.')).toBeInTheDocument();
  });

  it('runs a command the settings allow without asking, and says so', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.settings.ai.permissions.commands = 'allow';
    renderPanel();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Run a command to list recent commits{Enter}');
    expect(await screen.findByText(/^Allowed by your settings: Bash git log/)).toBeInTheDocument();
    expect(await screen.findByText('Here is what I found.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Permission for Bash' })).not.toBeInTheDocument();
  });

  it('stops a running operation', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 500;
    renderPanel();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Tell me a long story{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(useAiConversation.getState().operationId).toBeNull();
    expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();
  });

  it('explains a logged-out provider with its own help, and checks again', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.ai.loggedIn = false;
    renderPanel();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(MOCK_NOT_LOGGED_IN);
    expect(alert).toHaveTextContent(MOCK_NOT_LOGGED_IN_HELP);
    expect(composer()).toBeDisabled();

    if (window.__igraspMock) window.__igraspMock.state.ai.loggedIn = true;
    await user.click(screen.getByRole('button', { name: /Check again/ }));
    expect(await screen.findByText(statusLine)).toBeInTheDocument();
    expect(composer()).toBeEnabled();
  });

  it('explains a missing provider', async () => {
    if (window.__igraspMock) window.__igraspMock.state.ai.installed = false;
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent(MOCK_NOT_INSTALLED);
    expect(composer()).toBeDisabled();
  });

  it('shows an error the provider reports after starting', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    // Logged out between the status check and the message (like an expired token).
    if (window.__igraspMock) window.__igraspMock.state.ai.loggedIn = false;
    await user.type(composer(), 'Hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(MOCK_LATE_LOGIN_ERROR);
    await waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });
  });

  it('starts a new conversation', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    await user.type(composer(), 'Hi{Enter}');
    await screen.findByText(/This is the mock AI/);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText(/This is the mock AI/)).not.toBeInTheDocument();
    expect(useAiConversation.getState().resumeId).toBeNull();
    expect(screen.getByText(/session new/)).toBeInTheDocument();
  });
});

describe('the history', () => {
  const idle = () =>
    waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });

  it('lists two conversations, reopens each and continues one', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    await user.type(composer(), 'First question{Enter}');
    await screen.findByText(/You said: "First question"/);
    await idle();
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.type(composer(), 'Second question{Enter}');
    await screen.findByText(/You said: "Second question"/);
    await idle();

    await user.click(screen.getByRole('button', { name: 'History' }));
    const list = await screen.findByRole('listbox', { name: 'Conversations' });
    await waitFor(() => {
      expect(within(list).getAllByRole('option')).toHaveLength(2);
    });
    const rows = within(list).getAllByRole('option');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual([
      'Second question',
      'First question',
    ]);
    expect(rows[0]).toHaveAttribute('aria-selected', 'true');

    // Open the first one: its transcript comes back and the list closes.
    await user.click(within(list).getByRole('option', { name: 'First question' }));
    expect(await screen.findByText(/You said: "First question"/)).toBeInTheDocument();
    expect(screen.queryByText(/You said: "Second question"/)).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Conversations' })).toBeNull();
    const resumeId = useAiConversation.getState().resumeId;

    await user.type(composer(), 'More about it{Enter}');
    await screen.findByText(/You said: "More about it"/);
    expect(window.__igraspMock?.state.ai.lastRequest?.resumeId).toBe(resumeId);

    // Then the second one.
    await idle();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('option', { name: 'Second question' }));
    expect(await screen.findByText(/You said: "Second question"/)).toBeInTheDocument();
  });

  it('filters, and deletes a conversation after a confirmation', async () => {
    const user = userEvent.setup();
    const rowsOf = () =>
      within(screen.getByRole('listbox', { name: 'Conversations' })).getAllByRole('option');
    renderPanel();
    await screen.findByText(statusLine);
    await user.type(composer(), 'Alpha{Enter}');
    await idle();
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    await user.type(composer(), 'Beta{Enter}');
    await idle();
    await user.click(screen.getByRole('button', { name: 'History' }));
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(2);
    });
    await user.type(screen.getByLabelText('Filter conversations'), 'alp');
    expect(rowsOf().map((r) => r.getAttribute('aria-label'))).toEqual(['Alpha']);
    await user.clear(screen.getByLabelText('Filter conversations'));

    await user.click(screen.getByRole('button', { name: 'Delete "Alpha"' }));
    await user.click(screen.getByRole('button', { name: 'Keep' }));
    expect(rowsOf()).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Delete "Alpha"' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(rowsOf()).toHaveLength(1);
    });
    expect(window.__igraspMock?.state.ai.starts).toEqual(['chatMessage', 'chatMessage']);
  });

  it('offers to start again when the provider lost the conversation', async () => {
    const user = userEvent.setup();
    await backend.saveConversation({
      id: 'lost',
      title: 'Old talk',
      createdMs: 1,
      updatedMs: 2,
      providerId: 'mock',
      model: 'mock-fast',
      resumeId: 'unknown-session',
      usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
      items: [{ kind: 'user', id: 'x', text: 'Old talk' }],
    });
    renderPanel();
    await screen.findByText(statusLine);
    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('option', { name: 'Old talk' }));
    await user.type(composer(), 'Still there?{Enter}');
    const offer = await screen.findByRole('button', { name: /Start a new conversation from here/ });
    expect(within(offer).getByLabelText('Uses AI')).toBeInTheDocument();
    await user.click(offer);
    expect(await screen.findByText(/You said: "Still there\?"/)).toBeInTheDocument();
    expect(window.__igraspMock?.state.ai.lastRequest?.resumeId).toBeUndefined();
  });
});

describe('permission prompts and conversation rules', () => {
  const idle = () =>
    waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });
  const card = () => screen.findByRole('region', { name: 'Permission for Bash' });

  it('denies a command, then allows it for the conversation, then runs it without asking', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);

    // Deny: the model is told the user rejected it.
    await user.type(composer(), 'Run a command{Enter}');
    await user.click(within(await card()).getByRole('button', { name: 'Deny' }));
    await idle();
    const denied = useAiConversation
      .getState()
      .items.find((i) => i.kind === 'tool' && i.tool === 'Bash');
    expect(denied).toMatchObject({ isError: true, result: REJECTION_MESSAGE });

    // Allow for this conversation: runs now, and becomes a rule.
    await user.type(composer(), 'Run a command again{Enter}');
    const prompt = await card();
    expect(within(prompt).getByText('Details')).toBeInTheDocument();
    await user.click(within(prompt).getByRole('button', { name: 'Allow for this conversation' }));
    await idle();
    expect(useAiConversation.getState().rules).toEqual([{ tool: 'Bash', kind: 'command' }]);

    // The next one runs without a prompt, and the transcript says why.
    await user.type(composer(), 'And one more command{Enter}');
    expect(
      await screen.findByText('Allowed for this conversation: Bash git log --oneline -5'),
    ).toBeInTheDocument();
    await idle();
    expect(screen.queryByRole('region', { name: 'Permission for Bash' })).toBeNull();

    // The rules popover lists it; ✕ removes it, and the next one asks again.
    await user.click(screen.getByRole('button', { name: 'Rules of this conversation (1)' }));
    const popover = await screen.findByRole('dialog', { name: 'Rules of this conversation' });
    expect(within(popover).getByText('Bash')).toBeInTheDocument();
    await user.click(within(popover).getByRole('button', { name: 'Stop allowing Bash' }));
    expect(useAiConversation.getState().rules).toEqual([]);
    // The popover went away with the last rule: the focus is not lost, it is in the message box.
    await waitFor(() => {
      expect(composer()).toHaveFocus();
    });
    expect(useAiPanel.getState().open).toBe(true);
    await user.type(composer(), 'Last command{Enter}');
    await user.click(within(await card()).getByRole('button', { name: 'Allow' }));
    await idle();
  });

  it('forgets the rules on New conversation', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    await user.type(composer(), 'Run a command{Enter}');
    await user.click(
      within(await card()).getByRole('button', { name: 'Allow for this conversation' }),
    );
    await idle();
    expect(screen.getByRole('button', { name: /Rules of this conversation/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(useAiConversation.getState().rules).toEqual([]);
    expect(screen.queryByRole('button', { name: /Rules of this conversation/ })).toBeNull();
    await user.type(composer(), 'Run a command{Enter}');
    expect(await card()).toBeInTheDocument();
  });
});

describe('the chat feel', () => {
  it('wears the Academy look, with Hoot, while it is about a step', async () => {
    renderPanel();
    const panel = await screen.findByRole('dialog');
    expect(panel).not.toHaveAttribute('data-mode');
    act(() => {
      useAiPanel.getState().setAttachment({
        step: {
          tutorial: { type: 'private', id: 't1' },
          chapter: 0,
          step: 1,
          label: 'Chapter 1, step 2: The watcher',
          quote: null,
          kind: 'whole',
        },
      });
    });
    expect(panel).toHaveAttribute('data-mode', 'step');
    expect(within(panel).getByText('About a step')).toBeInTheDocument();
    expect(panel.querySelector('.ai-step-hoot .hoot')).not.toBeNull();
    act(() => {
      useAiPanel.getState().setAttachment(null);
    });
    expect(panel).not.toHaveAttribute('data-mode');
  });

  it('shows a typing indicator, then the answer in one piece', async () => {
    if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 40;
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    await user.type(composer(), 'What is this project?{Enter}');
    const typing = await screen.findByRole('img', { name: `${MOCK_PROVIDER_NAME} is writing` });
    expect(typing).toBeInTheDocument();
    // Streamed text is never shown piece by piece.
    expect(screen.queryByText(/This is the mock AI/)).toBeNull();
    expect(await screen.findByText(/This is the mock AI/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('img', { name: `${MOCK_PROVIDER_NAME} is writing` })).toBeNull();
    });
  });

  it('shows the answer written so far only while a card waits on the user', () => {
    const item = {
      kind: 'assistant' as const,
      id: 'a1',
      text: 'I will list the recent commits first.',
      streaming: true,
    };
    const { rerender } = render(<Message item={item} />);
    expect(screen.queryByText(/list the recent commits/)).toBeNull();
    rerender(<Message item={item} showPartial />);
    expect(screen.getByText(/list the recent commits/)).toBeInTheDocument();
  });

  it('recalls the selection on one line and sends a quick action about it', async () => {
    const capture = {
      sourcePath: 'README.md',
      firstLine: 3,
      lastLine: 4,
      text: 'Welcome to the **demo project**.\nMore text.',
      selection: 'demo project',
    };
    useAiPanel.setState({ attachment: { capture } });
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    const line = screen.getByRole('group', { name: 'Selection: README.md lines 3–4' });
    expect(within(line).getByText('demo project')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Shorten' }));
    await waitFor(() => {
      expect(window.__igraspMock?.state.ai.lastRequest?.prompt).toMatch(/^Shorten the selection/);
    });
    expect(window.__igraspMock?.state.ai.lastRequest?.capture).toEqual(capture);
    // The transcript shows the action's name, not the instruction.
    expect(screen.getByText('Shorten', { selector: '.ai-msg-user' })).toBeInTheDocument();
    await waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });
    expect(useAiPanel.getState().attachment).toBeNull();

    // ✕ drops it.
    useAiPanel.setState({ attachment: { capture } });
    await user.click(await screen.findByRole('button', { name: 'Remove the selection' }));
    expect(screen.queryByRole('group', { name: /^Selection:/ })).toBeNull();
  });
});

describe('the context bar', () => {
  const bar = () => screen.getByRole('group', { name: 'Context of the next message' });
  const sentPaths = () => window.__igraspMock?.state.ai.lastRequest?.context.map((d) => d.path);
  const idle = () =>
    waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });

  it('lists the instruction files and the current file, and sends exactly those', async () => {
    const user = userEvent.setup();
    act(() => {
      useTabs.getState().openDocument('docs/guide/getting-started.md');
    });
    renderPanel();
    await screen.findByText(statusLine);
    await waitFor(() => {
      expect(within(bar()).getAllByRole('listitem')).toHaveLength(3);
    });
    const names = within(bar())
      .getAllByRole('button', { name: /^Remove/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Remove AGENTS.md from the next message',
      'Remove docs/AGENTS.md from the next message',
      'Remove docs/guide/getting-started.md from the next message',
    ]);
    expect(within(bar()).getAllByText('AGENTS.md')).toHaveLength(2);
    expect(within(bar()).getByText('getting-started.md')).toBeInTheDocument();

    await user.type(composer(), 'Explain this page{Enter}');
    await idle();
    expect(sentPaths()).toEqual(['AGENTS.md', 'docs/AGENTS.md', 'docs/guide/getting-started.md']);
    expect(window.__igraspMock?.state.ai.lastRequest?.context[0]?.content).toContain('Agent rules');

    // Dropped with ✕: left out of the next messages from this file.
    await user.click(
      within(bar()).getByRole('button', { name: 'Remove docs/AGENTS.md from the next message' }),
    );
    await user.type(composer(), 'Again without the docs rules{Enter}');
    await idle();
    expect(sentPaths()).toEqual(['AGENTS.md', 'docs/guide/getting-started.md']);
    await user.type(composer(), 'And once more{Enter}');
    await idle();
    expect(sentPaths()).toEqual(['AGENTS.md', 'docs/guide/getting-started.md']);

    // Added back.
    await user.click(
      within(bar()).getByRole('button', { name: 'Add docs/AGENTS.md back to the next message' }),
    );
    await user.type(composer(), 'With everything{Enter}');
    await idle();
    expect(sentPaths()).toHaveLength(3);
  });

  it('follows the active tab and brings dropped documents back', async () => {
    const user = userEvent.setup();
    act(() => {
      useTabs.getState().openDocument('docs/guide/getting-started.md', { pin: true });
    });
    renderPanel();
    await screen.findByText(statusLine);
    await waitFor(() => {
      expect(within(bar()).getAllByRole('listitem')).toHaveLength(3);
    });
    await user.click(
      within(bar()).getByRole('button', { name: 'Remove AGENTS.md from the next message' }),
    );

    act(() => {
      useTabs.getState().openDocument('README.md', { pin: true });
    });
    await waitFor(() => {
      expect(within(bar()).getAllByRole('listitem')).toHaveLength(2);
    });
    expect(within(bar()).getByText('README.md')).toBeInTheDocument();
    expect(within(bar()).queryByRole('button', { name: /^Add/ })).toBeNull();

    // A settings tab has no current file: the root instructions only.
    act(() => {
      useTabs.getState().openSpecial('settings');
    });
    await waitFor(() => {
      expect(within(bar()).getAllByRole('listitem')).toHaveLength(1);
    });

    // Disk changes do not list again (only opening the panel or switching tabs does).
    const calls = vi.spyOn(backend, 'aiContext');
    window.__igraspMock?.writeFiles({ 'docs/guide/AGENTS.md': '# More rules\n' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).not.toHaveBeenCalled();
    calls.mockRestore();
    expect(window.__igraspMock?.state.ai.starts).toEqual([]);
  });
});

describe('the floating panel', () => {
  const panel = () => screen.getByRole('dialog', { name: MOCK_PROVIDER_NAME });

  it('is not modal and sits in the default corner', async () => {
    renderPanel();
    await screen.findByText(statusLine);
    expect(panel()).toHaveAttribute('aria-modal', 'false');
    const rect = selectPanelRect(useAiPanel.getState());
    expect(panel().style.left).toBe(`${String(rect.x)}px`);
    expect(panel().style.width).toBe(`${String(PANEL_DEFAULT_WIDTH)}px`);
  });

  it('moves by dragging its header, kept inside the window', async () => {
    renderPanel();
    await screen.findByText(statusLine);
    const start = selectPanelRect(useAiPanel.getState());
    const header = screen.getByRole('heading', { name: MOCK_PROVIDER_NAME });
    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 500, pointerId: 1 });
    fireEvent.pointerMove(header, { clientX: 450, clientY: 420, pointerId: 1 });
    fireEvent.pointerUp(header, { pointerId: 1 });
    expect(useAiPanel.getState().rect).toMatchObject({ x: start.x - 50, y: start.y - 80 });
    expect(panel().style.top).toBe(`${String(start.y - 80)}px`);

    // Far beyond the top-left corner: stops at the window's edge.
    fireEvent.pointerDown(header, { button: 0, clientX: 500, clientY: 500, pointerId: 2 });
    fireEvent.pointerMove(header, { clientX: -5000, clientY: -5000, pointerId: 2 });
    fireEvent.pointerUp(header, { pointerId: 2 });
    expect(useAiPanel.getState().rect).toMatchObject({ x: 0, y: 0 });
  });

  it('resizes from a corner, never below the minimum size', async () => {
    renderPanel();
    await screen.findByText(statusLine);
    const corner = document.querySelector('.ai-resize-nw');
    if (!corner) throw new Error('no handle');
    fireEvent.pointerDown(corner, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(corner, { clientX: 2000, clientY: 2000, pointerId: 1 });
    fireEvent.pointerUp(corner, { pointerId: 1 });
    expect(useAiPanel.getState().rect).toMatchObject({
      width: PANEL_MIN_WIDTH,
      height: PANEL_MIN_HEIGHT,
    });
  });

  it('moves with Alt+arrows from its header without going back in the history', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText(statusLine);
    const start = selectPanelRect(useAiPanel.getState());
    screen.getByRole('heading', { name: MOCK_PROVIDER_NAME }).focus();
    await user.keyboard('{Alt>}{ArrowLeft}{ArrowUp}{/Alt}');
    expect(useAiPanel.getState().rect).toMatchObject({
      x: start.x - PANEL_KEY_STEP,
      y: start.y - PANEL_KEY_STEP,
    });
    await user.keyboard('{Alt>}{Shift>}{ArrowRight}{/Shift}{/Alt}');
    expect(useAiPanel.getState().rect?.width).toBe(start.width + PANEL_KEY_STEP);
  });

  it('stops a running answer on Escape, closes on the next, and gives the focus back', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 500;
    render(
      <Tooltip.Provider>
        <button type="button" data-action="ai.chat">
          AI Chat
        </button>
        <AiPanel />
      </Tooltip.Provider>,
    );
    await screen.findByText(statusLine);
    await user.type(composer(), 'Tell me a long story{Enter}');
    await screen.findByRole('button', { name: 'Stop' });
    await user.keyboard('{Escape}');
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(useAiPanel.getState().open).toBe(true);

    composer().focus();
    await user.keyboard('{Escape}');
    expect(useAiPanel.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'AI Chat' })).toHaveFocus();
  });
});

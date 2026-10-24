import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import {
  MOCK_APPLIED_TEXT,
  MOCK_CLAUDE_VERSION,
  MOCK_NOT_INSTALLED,
  MOCK_NOT_LOGGED_IN,
  MOCK_REJECTED_TEXT,
} from '../../ipc/mock/mockClaude';
import { useClaude } from '../../stores/claude';
import { startEventBridge } from '../../stores/eventBridge';
import { useWorkspace } from '../../stores/workspace';
import { ClaudeDialog } from './ClaudeDialog';

let stop: () => void = () => undefined;

function resetClaudeStore() {
  useClaude.setState({
    open: true,
    status: null,
    checking: false,
    sessionId: null,
    turnId: null,
    starting: false,
    buffered: [],
    items: [],
    permissions: [],
    costUsd: 0,
  });
}

beforeEach(async () => {
  window.__igraspMock?.reset();
  if (window.__igraspMock) window.__igraspMock.state.claude.stepMs = 1;
  resetClaudeStore();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

afterEach(async () => {
  stop();
  useClaude.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

const composer = () => screen.getByLabelText('Message to Claude');

const renderDialog = () =>
  render(
    <Tooltip.Provider>
      <ClaudeDialog />
    </Tooltip.Provider>,
  );

describe('ClaudeDialog', () => {
  it('shows the CLI status and answers a plain question with streamed text', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(
      await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`)),
    ).toBeInTheDocument();

    await user.type(composer(), 'What is this project?{Enter}');
    expect(screen.getByText('What is this project?')).toBeInTheDocument();
    expect(await screen.findByText(/This is the mock Claude/)).toBeInTheDocument();
    await waitFor(() => {
      expect(useClaude.getState().turnId).toBeNull();
    });
    expect(useClaude.getState().sessionId).toMatch(/^00000000-/);
    expect(screen.getByText(/session 00000000/)).toBeInTheDocument();
    expect(composer()).toHaveValue('');
  });

  it('shows a proposed markdown edit as a diff and applies it when accepted', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`));

    await user.type(composer(), 'Please edit README.md{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to README.md' });
    expect(within(card).getByText(/Proposed edit · README.md/)).toBeInTheDocument();
    expect(within(card).getByText(/\(edited by Claude\)/)).toBeInTheDocument();
    expect(within(card).getByText('+1')).toBeInTheDocument();
    expect(within(card).getByText('−1')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /Accept/ }));
    expect(await screen.findByText(MOCK_APPLIED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Proposed edit/ })).not.toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('README.md')).toContain('(edited by Claude)');
    expect(screen.getByText('Edit README.md')).toBeInTheDocument();
  });

  it('leaves the file alone when the edit is rejected', async () => {
    const user = userEvent.setup();
    const before = window.__igraspMock?.state.files.get('README.md');
    renderDialog();
    await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`));

    await user.type(composer(), 'Please edit README.md{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to README.md' });
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(MOCK_REJECTED_TEXT)).toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('README.md')).toBe(before);
    expect(screen.getByText(/Edit README.md — refused or failed/)).toBeInTheDocument();
  });

  it('asks before running a command, with the input shown', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`));

    await user.type(composer(), 'Run a command to list recent commits{Enter}');
    const card = await screen.findByRole('region', { name: 'Permission for Bash' });
    expect(within(card).getByText(/Claude wants to use Bash: git log/)).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Allow' }));
    expect(await screen.findByText('Here is what I found.')).toBeInTheDocument();
  });

  it('stops a running turn', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.claude.stepMs = 500;
    renderDialog();
    await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`));

    await user.type(composer(), 'Tell me a long story{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(useClaude.getState().turnId).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('explains when the CLI is not logged in, with a way to check again', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.claude.loggedIn = false;
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(MOCK_NOT_LOGGED_IN);
    expect(composer()).toBeDisabled();

    if (window.__igraspMock) window.__igraspMock.state.claude.loggedIn = true;
    await user.click(screen.getByRole('button', { name: /Check again/ }));
    expect(
      await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`)),
    ).toBeInTheDocument();
    expect(composer()).toBeEnabled();
  });

  it('explains when the CLI is not installed', async () => {
    if (window.__igraspMock) window.__igraspMock.state.claude.installed = false;
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(MOCK_NOT_INSTALLED);
    expect(composer()).toBeDisabled();
  });

  it('shows the error result of a turn that fails after starting', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`));
    // Logged out between the status check and the message (like an expired token).
    if (window.__igraspMock) window.__igraspMock.state.claude.loggedIn = false;
    await user.type(composer(), 'Hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Not logged in · Please run /login');
    await waitFor(() => {
      expect(useClaude.getState().turnId).toBeNull();
    });
  });

  it('starts a new conversation', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(new RegExp(`claude ${MOCK_CLAUDE_VERSION}`));
    await user.type(composer(), 'Hi{Enter}');
    await screen.findByText(/This is the mock Claude/);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText(/This is the mock Claude/)).not.toBeInTheDocument();
    expect(useClaude.getState().sessionId).toBeNull();
    expect(screen.getByText(/session new/)).toBeInTheDocument();
  });
});

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
import { useAi } from '../../stores/ai';
import { startEventBridge } from '../../stores/eventBridge';
import { useWorkspace } from '../../stores/workspace';
import { AiChatDialog } from './AiChatDialog';

let stop: () => void = () => undefined;

function resetStore() {
  useAi.setState({
    open: true,
    status: null,
    capabilities: null,
    checking: false,
    model: '',
    resumeId: null,
    operationId: null,
    starting: false,
    buffered: [],
    items: [],
    permissions: [],
    usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
  });
}

beforeEach(async () => {
  window.__igraspMock?.reset();
  if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 1;
  resetStore();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

afterEach(async () => {
  stop();
  useAi.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

const composer = () => screen.getByLabelText('Message');
const statusLine = new RegExp(`${MOCK_PROVIDER_NAME} ${MOCK_PROVIDER_VERSION}`);

const renderDialog = () =>
  render(
    <Tooltip.Provider>
      <AiChatDialog />
    </Tooltip.Provider>,
  );

describe('AiChatDialog', () => {
  it('shows the provider status, uses its name and streams a plain answer', async () => {
    const user = userEvent.setup();
    renderDialog();
    expect(await screen.findByText(statusLine)).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: MOCK_PROVIDER_NAME })).toBeInTheDocument();
    // The model list comes from the provider's capabilities.
    expect(screen.getByLabelText('Model')).toHaveValue('mock-fast');

    await user.type(composer(), 'What is this project?{Enter}');
    expect(screen.getByText('What is this project?')).toBeInTheDocument();
    expect(await screen.findByText(/This is the mock AI/)).toBeInTheDocument();
    await waitFor(() => {
      expect(useAi.getState().operationId).toBeNull();
    });
    expect(useAi.getState().resumeId).toMatch(/^00000000-/);
    expect(screen.getByText(/session 00000000/)).toBeInTheDocument();
    expect(screen.getByText(/1280 tokens · \$0\.0031/)).toBeInTheDocument();
    expect(window.__igraspMock?.state.ai.starts).toEqual(['chatMessage']);
    expect(composer()).toHaveValue('');
  });

  it('shows a proposed markdown edit as a diff and applies it when accepted', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Please edit README.md{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to README.md' });
    expect(within(card).getByText(/Proposed edit · README.md/)).toBeInTheDocument();
    expect(within(card).getByText(/\(edited by the AI\)/)).toBeInTheDocument();
    expect(within(card).getByText('+1')).toBeInTheDocument();
    expect(within(card).getByText('−1')).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: /Accept/ }));
    expect(await screen.findByText(MOCK_APPLIED_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Proposed edit/ })).not.toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('README.md')).toContain('(edited by the AI)');
    expect(screen.getByText('Edit README.md')).toBeInTheDocument();
  });

  it('leaves the file alone when the edit is rejected', async () => {
    const user = userEvent.setup();
    const before = window.__igraspMock?.state.files.get('README.md');
    renderDialog();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Please edit README.md{Enter}');
    const card = await screen.findByRole('region', { name: 'Proposed edit to README.md' });
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText(MOCK_REJECTED_TEXT)).toBeInTheDocument();
    expect(window.__igraspMock?.state.files.get('README.md')).toBe(before);
    expect(screen.getByText(/Edit README.md — refused or failed/)).toBeInTheDocument();
  });

  it('asks before running a command, naming the provider', async () => {
    const user = userEvent.setup();
    renderDialog();
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
    renderDialog();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Run a command to list recent commits{Enter}');
    expect(await screen.findByText(/^Allowed by your settings: Bash git log/)).toBeInTheDocument();
    expect(await screen.findByText('Here is what I found.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Permission for Bash' })).not.toBeInTheDocument();
  });

  it('stops a running operation', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 500;
    renderDialog();
    await screen.findByText(statusLine);

    await user.type(composer(), 'Tell me a long story{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('Stopped.')).toBeInTheDocument();
    expect(useAi.getState().operationId).toBeNull();
    expect(screen.getByRole('button', { name: /Send/ })).toBeInTheDocument();
  });

  it('explains a logged-out provider with its own help, and checks again', async () => {
    const user = userEvent.setup();
    if (window.__igraspMock) window.__igraspMock.state.ai.loggedIn = false;
    renderDialog();
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
    renderDialog();
    expect(await screen.findByRole('alert')).toHaveTextContent(MOCK_NOT_INSTALLED);
    expect(composer()).toBeDisabled();
  });

  it('shows an error the provider reports after starting', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(statusLine);
    // Logged out between the status check and the message (like an expired token).
    if (window.__igraspMock) window.__igraspMock.state.ai.loggedIn = false;
    await user.type(composer(), 'Hello{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(MOCK_LATE_LOGIN_ERROR);
    await waitFor(() => {
      expect(useAi.getState().operationId).toBeNull();
    });
  });

  it('starts a new conversation', async () => {
    const user = userEvent.setup();
    renderDialog();
    await screen.findByText(statusLine);
    await user.type(composer(), 'Hi{Enter}');
    await screen.findByText(/This is the mock AI/);
    await user.click(screen.getByRole('button', { name: 'New conversation' }));
    expect(screen.queryByText(/This is the mock AI/)).not.toBeInTheDocument();
    expect(useAi.getState().resumeId).toBeNull();
    expect(screen.getByText(/session new/)).toBeInTheDocument();
  });
});

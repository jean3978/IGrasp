// Accessibility of the AI features (plan §6.12): the live region, focus that never falls to
// nowhere when a card answers, names and roles screen readers rely on.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { MOCK_PROVIDER_NAME, MOCK_PROVIDER_VERSION } from '../../ipc/mock/mockAi';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { startEventBridge } from '../../stores/eventBridge';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { AiActivityItem } from './AiActivityItem';
import { AiAnnouncer } from './AiAnnouncer';
import { AiPanel } from './AiPanel';
import { LineDiffCard } from './PermissionCard';

let stop: () => void = () => undefined;

beforeEach(async () => {
  window.__igraspMock?.reset();
  if (window.__igraspMock) window.__igraspMock.state.ai.stepMs = 1;
  resetAiStores();
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  useAiPanel.setState({ open: true, rect: null, draft: '' });
});

afterEach(async () => {
  stop();
  useAiConversation.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

const composer = () => screen.getByLabelText('Message');
const live = () => document.querySelector<HTMLElement>('.ai-announcer');
const idle = () =>
  waitFor(() => {
    expect(useAiConversation.getState().operationId).toBeNull();
  });

const renderAll = () =>
  render(
    <Tooltip.Provider>
      <AiPanel />
      <AiActivityItem />
      <AiAnnouncer />
    </Tooltip.Provider>,
  );

describe('AI accessibility', () => {
  it('announces an answer, a permission and its outcome in one polite live region', async () => {
    const user = userEvent.setup();
    renderAll();
    await screen.findByText(new RegExp(`^${MOCK_PROVIDER_VERSION} · `));
    const region = live();
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // The transcript itself is not live: streamed text would be read word by word.
    expect(document.querySelector('.ai-messages')).not.toHaveAttribute('aria-live');

    await user.type(composer(), 'Run a command to list recent commits{Enter}');
    await waitFor(() => {
      expect(live()).toHaveTextContent(`${MOCK_PROVIDER_NAME} asks to use Bash: git log`);
    });
    // The permission card answered and left the page: the focus goes to the message box.
    const card = screen.getByRole('region', { name: 'Permission for Bash' });
    await user.click(within(card).getByRole('button', { name: 'Deny' }));
    await idle();
    await waitFor(() => {
      expect(composer()).toHaveFocus();
    });
    await waitFor(() => {
      expect(live()).toHaveTextContent(`${MOCK_PROVIDER_NAME} finished.`);
    });
  });

  it('announces a region or a text selection attached to the chat', async () => {
    renderAll();
    useAiPanel.getState().setAttachment({
      capture: { sourcePath: 'docs/a.md', firstLine: 3, lastLine: 5, text: 'x' },
    });
    await waitFor(() => {
      expect(live()).toHaveTextContent(
        'Region attached: docs/a.md lines 3–5. Nothing is sent until you press Send.',
      );
    });
    useAiPanel.getState().setAttachment({
      capture: { sourcePath: 'docs/a.md', firstLine: 7, lastLine: 7, text: 'y', selection: 'y' },
    });
    await waitFor(() => {
      expect(live()).toHaveTextContent('Selection attached: docs/a.md line 7.');
    });
  });

  it('names the waiting permission in the status bar button', async () => {
    const user = userEvent.setup();
    renderAll();
    await screen.findByText(new RegExp(`^${MOCK_PROVIDER_VERSION} · `));
    await user.type(composer(), 'Run a command to list recent commits{Enter}');
    await screen.findByRole('region', { name: 'Permission for Bash' });
    useAiPanel.getState().setOpen(false);
    expect(
      await screen.findByRole('button', {
        name: /is working….*1 permission waiting/,
      }),
    ).toBeInTheDocument();
    await useAiConversation.getState().cancel();
  });

  it('says which lines of a line diff are added or removed', () => {
    render(
      <LineDiffCard
        edit={{
          path: 'a.ts',
          isMarkdown: false,
          wholeFile: false,
          hunks: [{ oldText: 'a', newText: 'b' }],
        }}
        onAccept={() => undefined}
        onReject={() => undefined}
      />,
    );
    const diff = document.querySelector('.ai-diff');
    expect(diff).toHaveTextContent('Removed: a');
    expect(diff).toHaveTextContent('Added: b');
  });
});

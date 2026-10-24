import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_FILES, FIXTURE_ROOT } from '../../ipc/mock/fixture';
import {
  MOCK_APPLIED_TEXT,
  MOCK_EDIT_SUFFIX,
  MOCK_NEW_FILE_CONTENT,
  MOCK_PROVIDER_NAME,
  MOCK_REJECTED_BY_USER,
  MOCK_REJECTED_TEXT,
} from '../../ipc/mock/mockAi';
import type { PermissionDecision } from '../../ipc/types';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiProvider } from '../../stores/aiProvider';
import { startEventBridge } from '../../stores/eventBridge';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { DocumentTab } from '../preview/DocumentTab';
import { runAction } from '../titlebar/menuActions';

let stop: () => void = () => undefined;
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};
const conv = () => useAiConversation.getState();
const README = FIXTURE_FILES['README.md'] ?? '';
const plain = README.split('\n').filter((l) => /^[A-Za-z]/.test(l));
const FIRST = plain[0] ?? '';
const LAST = plain[plain.length - 1] ?? '';

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  resetAiStores();
  useTabs.setState({ tabs: [], activeId: null });
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
});

afterEach(async () => {
  stop();
  conv().newConversation();
  await useWorkspace.getState().closeRoot();
});

/** Sends `prompt` and renders the tab the review opened, once its diff is shown. */
async function review(prompt: string, path: string) {
  await conv().send(prompt);
  await vi.waitFor(() => {
    expect(conv().pendingReview?.status).toBe('ready');
  });
  const tab = useTabs.getState().tabs.find((t) => t.relPath === path);
  expect(tab).toBeDefined();
  expect(useTabs.getState().activeId).toBe(tab?.id);
  const view = render(<DocumentTab tabId={tab?.id ?? ''} relPath={path} />);
  await screen.findAllByRole('group', { name: /^Change \d+ of/ });
  return view;
}

/** The decision the mock provider received for the edit (spied on the backend call). */
function spyDecisions(): PermissionDecision[] {
  const decisions: PermissionDecision[] = [];
  const original = conv().respond;
  useAiConversation.setState({
    respond: async (requestId, decision) => {
      decisions.push(decision);
      await original(requestId, decision);
    },
  });
  return decisions;
}

const finished = (text: string) =>
  vi.waitFor(() => {
    expect(conv().operationId).toBeNull();
    expect(conv().items.some((i) => i.kind === 'assistant' && i.text === text)).toBe(true);
  });

describe('InlineEditReview', () => {
  it('applies only the accepted hunk of a two-hunk edit', async () => {
    const user = userEvent.setup();
    const decisions = spyDecisions();
    await review('edit twice README.md', 'README.md');
    expect(
      screen.getByText(`${MOCK_PROVIDER_NAME} proposes 2 changes to README.md`),
    ).toBeInTheDocument();
    const groups = screen.getAllByRole('group', { name: /^Change \d+ of 2/ });
    expect(groups).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Reject change 1' }));
    expect(document.querySelector('.inline-review [aria-live]')).toHaveTextContent(
      'Change 1 rejected. 1 of 2 decided.',
    );
    await user.click(screen.getByRole('button', { name: 'Accept change 2' }));
    expect(screen.getByText('2 of 2 decided')).toBeInTheDocument();
    expect(groups[0]).toHaveAttribute('data-state', 'rejected');
    expect(groups[1]).toHaveAttribute('data-state', 'accepted');

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await finished(MOCK_APPLIED_TEXT);
    expect(decisions).toEqual([
      {
        behavior: 'allow',
        updatedEdit: {
          path: 'README.md',
          isMarkdown: true,
          wholeFile: false,
          hunks: [{ oldText: LAST, newText: `${LAST}${MOCK_EDIT_SUFFIX}` }],
        },
      },
    ]);
    const written = mock().state.files.get('README.md') ?? '';
    expect(written).toContain(`${LAST}${MOCK_EDIT_SUFFIX}`);
    expect(written).not.toContain(`${FIRST}${MOCK_EDIT_SUFFIX}`);
    expect(
      conv().items.some((i) => i.kind === 'notice' && i.text.startsWith('Applied 1 of 2')),
    ).toBe(true);
    // The tab left review mode.
    expect(screen.queryByRole('region', { name: 'Proposed edit' })).not.toBeInTheDocument();
  });

  it('Reject all sends a denial and leaves the file unchanged', async () => {
    const user = userEvent.setup();
    const decisions = spyDecisions();
    await review('edit twice README.md', 'README.md');
    await user.click(screen.getByRole('button', { name: 'Accept change 1' }));
    await user.click(screen.getByRole('button', { name: /Reject all/ }));
    await finished(MOCK_REJECTED_TEXT);
    expect(decisions).toEqual([{ behavior: 'deny', message: MOCK_REJECTED_BY_USER }]);
    expect(mock().state.files.get('README.md')).toBe(README);
  });

  it('accepts every change with the shortcut action and with A on a focused change', async () => {
    const decisions = spyDecisions();
    await review('edit twice README.md', 'README.md');
    const [first] = screen.getAllByRole('group', { name: /^Change \d+ of 2/ });
    if (!first) throw new Error('no change group');
    first.focus();
    fireEvent.keyDown(first, { key: 'a' });
    expect(first).toHaveAttribute('data-state', 'accepted');
    fireEvent.keyDown(first, { key: 'r' });
    expect(first).toHaveAttribute('data-state', 'rejected');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Undo the decision on change 1/ })).toBeVisible();
    });
    await user().click(screen.getByRole('button', { name: /Undo the decision on change 1/ }));
    expect(first).toHaveAttribute('data-state', 'pending');

    runAction('ai.acceptAllChanges');
    await finished(MOCK_APPLIED_TEXT);
    // Everything accepted: the tool runs as proposed.
    expect(decisions).toEqual([{ behavior: 'allow', updatedEdit: null }]);
    const written = mock().state.files.get('README.md') ?? '';
    expect(written).toContain(`${FIRST}${MOCK_EDIT_SUFFIX}`);
    expect(written).toContain(`${LAST}${MOCK_EDIT_SUFFIX}`);
  });

  it('composes the accepted blocks of a rewrite into the content written', async () => {
    const decisions = spyDecisions();
    const u = user();
    await review('rewrite README.md', 'README.md');
    // The new title and the rewritten paragraph are adjacent: one change (ADR 0017).
    expect(screen.getAllByRole('group', { name: /^Change \d+ of 2/ })).toHaveLength(2);
    await u.click(screen.getByRole('button', { name: 'Reject change 1' }));
    await u.click(screen.getByRole('button', { name: 'Accept change 2' }));
    await u.click(screen.getByRole('button', { name: 'Apply' }));
    await finished(MOCK_APPLIED_TEXT);
    const written = mock().state.files.get('README.md') ?? '';
    expect(written).toContain('# IGrasp demo project\n');
    expect(written).toContain(FIRST);
    expect(written).not.toContain('A paragraph rewritten by the AI.');
    expect(written).toBe(`${README.trimEnd()}\n\nA closing paragraph added by the AI.\n`);
    const [decision] = decisions;
    expect(decision?.behavior).toBe('allow');
    if (decision?.behavior === 'allow') {
      expect(decision.updatedEdit?.wholeFile).toBe(true);
      expect(decision.updatedEdit?.hunks).toEqual([{ oldText: '', newText: written }]);
    }
  });

  it('reviews a new file against an empty content, and closes its tab when rejected', async () => {
    await review('create notes/new.md', 'notes/new.md');
    expect(
      screen.getByText(`${MOCK_PROVIDER_NAME} proposes a new file notes/new.md`),
    ).toBeInTheDocument();
    const region = screen.getByRole('group', { name: /^Change 1 of 1/ });
    expect(within(region).getByRole('heading', { name: 'New note' })).toBeInTheDocument();
    expect(region.querySelector('.diff-part--removed')).toBeNull();

    runAction('ai.rejectAllChanges');
    await finished(MOCK_REJECTED_TEXT);
    expect(mock().state.files.has('notes/new.md')).toBe(false);
    expect(useTabs.getState().tabs).toEqual([]);
  });

  it('creates a new file when accepted', async () => {
    await review('create notes/new.md', 'notes/new.md');
    await user().click(screen.getByRole('button', { name: /Accept all/ }));
    await finished(MOCK_APPLIED_TEXT);
    expect(mock().state.files.get('notes/new.md')).toBe(MOCK_NEW_FILE_CONTENT);
    expect(useTabs.getState().tabs.map((t) => t.relPath)).toEqual(['notes/new.md']);
  });
});

function user() {
  return userEvent.setup();
}

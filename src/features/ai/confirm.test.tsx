// Rule 2 of the AI integration principles: confirmation before large work, usage visible, and a
// way to stop that is always at hand.

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../ipc/defaults';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { MOCK_PROVIDER_NAME } from '../../ipc/mock/mockAi';
import { useAiProvider } from '../../stores/aiProvider';
import { useAiConversation } from '../../stores/aiConversation';
import { startEventBridge } from '../../stores/eventBridge';
import { useSettings } from '../../stores/settings';
import { useTabs } from '../../stores/tabs';
import { useWorkspace } from '../../stores/workspace';
import { AiActivityItem } from './AiActivityItem';
import { useAiPanel } from '../../stores/aiPanel';
import { AiPanel } from './AiPanel';
import { ConfirmCard } from './ConfirmCard';
import { UsageLine } from './UsageLine';
import { resetAiStores } from '../../test/resetAi';
import { confirmSummary, usageText } from './usageFormat';

let stop: () => void = () => undefined;
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};
const starts = () => mock().state.ai.starts;

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  useAiPanel.setState({ open: false, rect: null, draft: '' });
  resetAiStores();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await useSettings.getState().load();
  useTabs.setState({ tabs: [], activeId: null });
  stop = await startEventBridge();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
  await useAiProvider.getState().checkStatus();
});

afterEach(async () => {
  stop();
  useAiConversation.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

describe('the confirmation gate in send', () => {
  it('shows the card for a large estimate and starts nothing until Start', async () => {
    useTabs.getState().openCode('logs/huge.log');
    await useAiConversation.getState().send('summarize this');
    const pending = useAiConversation.getState().pendingConfirm;
    expect(pending?.estimate.bucket).toBe('large');
    expect(pending?.documents.map((d) => d.path)).toContain('logs/huge.log');
    expect(starts()).toEqual([]);
    expect(useAiConversation.getState().starting).toBe(false);

    await useAiConversation.getState().confirmStart();
    expect(starts()).toEqual(['chatMessage']);
    expect(mock().state.ai.lastRequest?.context.map((d) => d.path)).toContain('logs/huge.log');
    expect(useAiConversation.getState().pendingConfirm).toBeNull();
  });

  it('starts nothing when the card is cancelled', async () => {
    useTabs.getState().openCode('logs/huge.log');
    await useAiConversation.getState().send('summarize this');
    useAiConversation.getState().cancelConfirm();
    expect(useAiConversation.getState().pendingConfirm).toBeNull();
    expect(starts()).toEqual([]);
    expect(useAiConversation.getState().items.at(-1)).toMatchObject({ kind: 'notice' });
  });

  it('does not show it for a small message, and never with "never"', async () => {
    await useAiConversation.getState().send('hello');
    expect(useAiConversation.getState().pendingConfirm).toBeNull();
    expect(starts()).toEqual(['chatMessage']);
    await vi.waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });

    await useSettings.getState().update({ ai: { confirmFrom: 'never' } });
    useTabs.getState().openCode('logs/huge.log');
    await useAiConversation.getState().send('again');
    expect(useAiConversation.getState().pendingConfirm).toBeNull();
    expect(starts()).toEqual(['chatMessage', 'chatMessage']);
  });

  it('asks from a medium estimate when so configured', async () => {
    await useSettings.getState().update({ ai: { confirmFrom: 'medium' } });
    mock().writeFiles({ 'notes/long.md': `# Long\n${'word '.repeat(20_000)}\n` });
    await vi.waitFor(() => {
      expect(useWorkspace.getState().index.markdownFiles).toBeGreaterThan(0);
    });
    useTabs.getState().openDocument('notes/long.md');
    await useAiConversation.getState().send('read it');
    expect(useAiConversation.getState().pendingConfirm?.estimate.bucket).toBe('medium');
    expect(starts()).toEqual([]);
  });
});

describe('the confirmation card in the chat', () => {
  it('starts on Start, cancels on Cancel and on Escape', async () => {
    useAiPanel.setState({ open: true });
    useTabs.getState().openCode('logs/huge.log');
    render(
      <Tooltip.Provider>
        <AiPanel />
      </Tooltip.Provider>,
    );
    const box = await screen.findByRole('textbox', { name: 'Message' });
    await userEvent.type(box, 'summarize{Enter}');
    const card = await screen.findByRole('group', { name: /Confirm/ });
    expect(card).toHaveTextContent(MOCK_PROVIDER_NAME);
    expect(card).toHaveTextContent('Large');
    expect(starts()).toEqual([]);

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: /Confirm/ })).toBeNull();
    });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(starts()).toEqual([]);

    await userEvent.type(box, 'again{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /^Start/ }));
    await waitFor(() => {
      expect(starts()).toEqual(['chatMessage']);
    });
    expect(await screen.findByText(/1\s200 in · 80 out · \$0\.003 · 4\.2 s/)).toBeInTheDocument();
  });

  it('is props only: Start and Cancel call back, Escape cancels', async () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();
    render(
      <Tooltip.Provider>
        <ConfirmCard
          title="Quiz"
          provider="Acme AI"
          model="sonnet"
          documents={[{ path: 'a.md', bytes: 2048 }]}
          images={1}
          estimate={{
            bytes: 2048,
            approxTokens: 21_000,
            bucket: 'medium',
            documents: 1,
            images: 1,
          }}
          onStart={onStart}
          onCancel={onCancel}
        />
      </Tooltip.Provider>,
    );
    expect(
      screen.getByText('Acme AI (sonnet) will read 1 document (2.0 KB) and 1 image.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /^Start/ }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe('usage', () => {
  it('formats the usage line and hides an unreported cost', () => {
    expect(
      usageText({ inputTokens: 1200, outputTokens: 80, costUsd: 0.0031, durationMs: 4200 }),
    ).toBe('1 200 in · 80 out · $0.003 · 4.2 s');
    expect(usageText({ inputTokens: 5, outputTokens: 1, costUsd: null, durationMs: 0 })).toBe(
      '5 in · 1 out',
    );
    render(<UsageLine inputTokens={5} outputTokens={1} costUsd={null} />);
    expect(screen.getByText('5 in · 1 out')).toHaveClass('ai-usage');
    expect(confirmSummary({ provider: 'P', model: '', documents: [], images: 0 })).toBe(
      'P will receive your message.',
    );
  });
});

describe('the running indicator', () => {
  it('shows in the status bar when the chat is closed, stops the operation and reopens the chat', async () => {
    render(<AiActivityItem />);
    expect(screen.queryByText(/is working/)).toBeNull();
    mock().state.ai.stepMs = 40;
    useAiPanel.setState({ open: true });
    await useAiConversation.getState().send('a slow answer');
    expect(screen.queryByText(/is working/)).toBeNull();

    act(() => {
      useAiPanel.getState().setOpen(false);
    });
    expect(await screen.findByText(`${MOCK_PROVIDER_NAME} is working…`)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /is working/ }));
    expect(useAiPanel.getState().open).toBe(true);
    act(() => {
      useAiPanel.getState().setOpen(false);
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });
    expect(screen.queryByText(/is working/)).toBeNull();
    expect(
      useAiConversation.getState().items.some((i) => i.kind === 'notice' && i.text === 'Stopped.'),
    ).toBe(true);
  });
});

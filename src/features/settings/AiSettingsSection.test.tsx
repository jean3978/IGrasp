import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tooltip } from 'radix-ui';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backend } from '../../ipc/client';
import { DEFAULT_SETTINGS } from '../../ipc/defaults';
import { FIXTURE_ROOT } from '../../ipc/mock/fixture';
import { useSettings } from '../../stores/settings';
import { useWorkspace } from '../../stores/workspace';
import { resetAiStores } from '../../test/resetAi';
import { AiSettingsSection } from './AiSettingsSection';

const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};

beforeEach(async () => {
  mock().reset();
  resetAiStores();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await useSettings.getState().load();
  await useWorkspace.getState().openRoot(FIXTURE_ROOT);
});

afterEach(async () => {
  await useWorkspace.getState().closeRoot();
});

const renderSection = () =>
  render(
    <Tooltip.Provider>
      <AiSettingsSection />
    </Tooltip.Provider>,
  );

describe('Settings → AI', () => {
  it('shows the status and the single provider, named by its display name', async () => {
    renderSection();
    expect(await screen.findByText(/Mock AI 1\.0-mock/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check again/ })).toBeInTheDocument();
    expect(await screen.findByText('Mock AI is the only provider for now.')).toBeInTheDocument();
    const provider = screen.getByRole('radiogroup', { name: 'AI provider' });
    expect(within(provider).getByRole('radio', { name: 'Mock AI' })).toBeDisabled();
    expect(screen.getByLabelText('Default model')).toHaveValue('mock-fast');
    expect(mock().state.ai.starts).toEqual([]);
  });

  it('changes the permission defaults, warns on risky Allow, and resets them', async () => {
    const user = userEvent.setup();
    renderSection();
    const commands = screen.getByRole('radiogroup', { name: 'Commands' });
    await user.click(within(commands).getByRole('radio', { name: 'Allow' }));
    await waitFor(async () => {
      expect((await backend.getSettings()).ai.permissions.commands).toBe('allow');
    });
    expect(screen.getByText('Runs without asking you')).toBeInTheDocument();

    // Allow for markdown edits is reviewed in the diff anyway: no warning.
    const markdown = screen.getByRole('radiogroup', { name: 'Markdown edits' });
    await user.click(within(markdown).getByRole('radio', { name: 'Deny' }));
    await waitFor(async () => {
      expect((await backend.getSettings()).ai.permissions.markdownEdits).toBe('deny');
    });
    await user.click(within(markdown).getByRole('radio', { name: 'Allow' }));
    expect(screen.getAllByText('Runs without asking you')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    await waitFor(async () => {
      expect((await backend.getSettings()).ai.permissions).toEqual(DEFAULT_SETTINGS.ai.permissions);
    });
    expect(screen.queryByText('Runs without asking you')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
  });

  it('sets the confirmation threshold and the history limit', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Confirm before sending' })).getByRole(
        'radio',
        {
          name: 'From medium',
        },
      ),
    );
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Conversations kept per folder' })).getByRole(
        'radio',
        { name: '25' },
      ),
    );
    await waitFor(async () => {
      const { ai } = await backend.getSettings();
      expect(ai.confirmFrom).toBe('medium');
      expect(ai.historyLimit).toBe(25);
    });
    expect(mock().state.ai.starts).toEqual([]);
  });

  it("forgets this folder's conversations after a confirmation", async () => {
    const user = userEvent.setup();
    await backend.saveConversation({
      id: 'c1',
      title: 'hello',
      createdMs: 1,
      updatedMs: 2,
      providerId: 'mock',
      model: '',
      resumeId: null,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: null },
      items: [],
    });
    renderSection();
    await user.click(screen.getByRole('button', { name: 'Forget conversations…' }));
    await user.click(screen.getByRole('button', { name: 'Keep them' }));
    expect(await backend.listConversations()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Forget conversations…' }));
    await user.click(screen.getByRole('button', { name: 'Forget them' }));
    await waitFor(async () => {
      expect(await backend.listConversations()).toEqual([]);
    });
    expect(await screen.findByText('Forgotten.')).toBeInTheDocument();
    expect(mock().state.ai.starts).toEqual([]);
  });
});

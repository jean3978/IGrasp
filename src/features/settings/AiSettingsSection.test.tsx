import { render, screen, waitFor } from '@testing-library/react';
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

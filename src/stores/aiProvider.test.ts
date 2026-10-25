import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../ipc/client';
import { DEFAULT_SETTINGS } from '../ipc/defaults';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { MOCK_PROVIDER_ID } from '../ipc/mock/mockAi';
import { MODEL_SAVE_DELAY_MS, useAiProvider } from './aiProvider';
import { useAiConversation } from './aiConversation';
import { startEventBridge } from './eventBridge';
import { useSettings } from './settings';
import { resetAiStores } from '../test/resetAi';
import { useWorkspace } from './workspace';

let stop: () => void = () => undefined;
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};

function resetAi() {
  resetAiStores();
}

beforeEach(async () => {
  mock().reset();
  mock().state.ai.stepMs = 1;
  resetAi();
  useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
  await useSettings.getState().load();
  stop = await startEventBridge();
});

afterEach(async () => {
  stop();
  useAiConversation.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

describe('AI provider store', () => {
  it('remembers the chosen model in the settings, across a restart', async () => {
    await useAiProvider.getState().checkStatus();
    expect(useAiProvider.getState().model).toBe('mock-fast');
    useAiProvider.getState().setModel('mock-text');
    useAiProvider.getState().setModel(' mock-smart ');
    expect(useAiProvider.getState().model).toBe('mock-smart');
    await vi.waitFor(
      async () => {
        expect((await backend.getSettings()).ai.model).toBe('mock-smart');
      },
      { timeout: MODEL_SAVE_DELAY_MS * 4 },
    );
    expect(useSettings.getState().settings.ai.model).toBe('mock-smart');

    // A restart: fresh stores, settings read again from the backend.
    resetAi();
    useSettings.setState({ settings: DEFAULT_SETTINGS, loaded: false });
    await useSettings.getState().load();
    await useAiProvider.getState().checkStatus();
    expect(useAiProvider.getState().model).toBe('mock-smart');
    expect(mock().state.ai.starts).toEqual([]);
  });

  it('reuses a recent status check unless forced', async () => {
    await useAiProvider.getState().checkStatus();
    await useAiProvider.getState().checkStatus();
    expect(mock().state.ai.statusChecks).toBe(1);
    mock().state.ai.loggedIn = false;
    await useAiProvider.getState().checkStatus(true);
    expect(mock().state.ai.statusChecks).toBe(2);
    expect(useAiProvider.getState().status?.loggedIn).toBe(false);
  });

  it('lists the providers and refuses a switch while an operation runs', async () => {
    await useAiProvider.getState().loadProviders();
    expect(useAiProvider.getState().providers).toEqual([
      { id: MOCK_PROVIDER_ID, displayName: 'Mock AI' },
    ]);
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAiProvider.getState().checkStatus();
    await useAiConversation.getState().send('a slow answer');
    expect(useAiConversation.getState().operationId).not.toBeNull();
    await expect(useAiProvider.getState().setProvider(MOCK_PROVIDER_ID)).rejects.toThrow(
      /cannot change while an operation runs/,
    );
    await useAiConversation.getState().cancel();
    await vi.waitFor(() => {
      expect(useAiConversation.getState().operationId).toBeNull();
    });
    await useAiProvider.getState().setProvider(MOCK_PROVIDER_ID);
    expect(useSettings.getState().settings.ai.provider).toBe(MOCK_PROVIDER_ID);
    await expect(useAiProvider.getState().setProvider('elsewhere')).rejects.toThrow(/Unknown/);
  });

  it('declares per-model image input', async () => {
    const caps = await backend.aiCapabilities();
    expect(caps.imageInput).toBe(true);
    expect(caps.models.find((m) => m.id === 'mock-text')?.imageInput).toBe(false);
    expect(caps.models.find((m) => m.id === 'mock-fast')?.imageInput).toBe(true);
  });

  it('brings the remembered model back once the real list arrives', async () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, ai: { ...s.settings.ai, model: 'mock-smart' } },
    }));
    const real = await backend.aiCapabilities();
    // First check: the provider has not listed its models yet (only its default).
    const placeholder = {
      ...real,
      models: [{ id: 'default', label: 'Default', description: null, imageInput: true }],
    };
    const spy = vi.spyOn(backend, 'aiCapabilities').mockResolvedValueOnce(placeholder);
    await useAiProvider.getState().checkStatus();
    expect(useAiProvider.getState().model).toBe('default');

    await useAiProvider.getState().checkStatus(true);
    expect(useAiProvider.getState().model).toBe('mock-smart');
    expect(useAiProvider.getState().defaultModel).toBe('mock-smart');

    // A model the user picks stays, check after check.
    useAiProvider.getState().setModel('mock-fast');
    await useAiProvider.getState().checkStatus(true);
    expect(useAiProvider.getState().model).toBe('mock-fast');
    spy.mockRestore();
  });

  it('only picks a model the provider offers', async () => {
    useSettings.setState((s) => ({
      settings: { ...s.settings, ai: { ...s.settings.ai, model: 'no-longer-offered' } },
    }));
    await useAiProvider.getState().checkStatus();
    expect(useAiProvider.getState().model).toBe('mock-fast');

    useSettings.setState((s) => ({
      settings: { ...s.settings, ai: { ...s.settings.ai, model: 'mock-smart' } },
    }));
    useAiProvider.setState({ model: '', defaultModel: '' });
    await useAiProvider.getState().checkStatus(true);
    expect(useAiProvider.getState().model).toBe('mock-smart');
  });
});

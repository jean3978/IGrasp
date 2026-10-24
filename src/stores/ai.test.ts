import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backend } from '../ipc/client';
import { DEFAULT_SETTINGS } from '../ipc/defaults';
import { FIXTURE_ROOT } from '../ipc/mock/fixture';
import { MOCK_PROVIDER_ID } from '../ipc/mock/mockAi';
import { MODEL_SAVE_DELAY_MS, useAi } from './ai';
import { startEventBridge } from './eventBridge';
import { useSettings } from './settings';
import { useWorkspace } from './workspace';

let stop: () => void = () => undefined;
const mock = () => {
  const m = window.__igraspMock;
  if (!m) throw new Error('mock backend missing');
  return m;
};

function resetAi() {
  useAi.setState({
    status: null,
    capabilities: null,
    checking: false,
    providers: null,
    model: '',
    resumeId: null,
    operationId: null,
    starting: false,
    buffered: [],
    items: [],
    permissions: [],
  });
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
  useAi.getState().newConversation();
  await useWorkspace.getState().closeRoot();
});

describe('AI provider store', () => {
  it('remembers the chosen model in the settings, across a restart', async () => {
    await useAi.getState().checkStatus();
    expect(useAi.getState().model).toBe('mock-fast');
    useAi.getState().setModel('mock-text');
    useAi.getState().setModel(' mock-smart ');
    expect(useAi.getState().model).toBe('mock-smart');
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
    await useAi.getState().checkStatus();
    expect(useAi.getState().model).toBe('mock-smart');
    expect(mock().state.ai.starts).toEqual([]);
  });

  it('reuses a recent status check unless forced', async () => {
    await useAi.getState().checkStatus();
    await useAi.getState().checkStatus();
    expect(mock().state.ai.statusChecks).toBe(1);
    mock().state.ai.loggedIn = false;
    await useAi.getState().checkStatus(true);
    expect(mock().state.ai.statusChecks).toBe(2);
    expect(useAi.getState().status?.loggedIn).toBe(false);
  });

  it('lists the providers and refuses a switch while an operation runs', async () => {
    await useAi.getState().loadProviders();
    expect(useAi.getState().providers).toEqual([{ id: MOCK_PROVIDER_ID, displayName: 'Mock AI' }]);
    await useWorkspace.getState().openRoot(FIXTURE_ROOT);
    await useAi.getState().checkStatus();
    await useAi.getState().send('a slow answer');
    expect(useAi.getState().operationId).not.toBeNull();
    await expect(useAi.getState().setProvider(MOCK_PROVIDER_ID)).rejects.toThrow(
      /cannot change while an operation runs/,
    );
    await useAi.getState().cancel();
    await vi.waitFor(() => {
      expect(useAi.getState().operationId).toBeNull();
    });
    await useAi.getState().setProvider(MOCK_PROVIDER_ID);
    expect(useSettings.getState().settings.ai.provider).toBe(MOCK_PROVIDER_ID);
    await expect(useAi.getState().setProvider('elsewhere')).rejects.toThrow(/Unknown/);
  });

  it('declares per-model image input', async () => {
    const caps = await backend.aiCapabilities();
    expect(caps.imageInput).toBe(true);
    expect(caps.models.find((m) => m.id === 'mock-text')?.imageInput).toBe(false);
    expect(caps.models.find((m) => m.id === 'mock-fast')?.imageInput).toBe(true);
  });
});

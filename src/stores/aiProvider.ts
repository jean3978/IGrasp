// The AI provider as the app sees it: status, capabilities, the providers the setting offers and
// the model picked for the next messages. Provider-neutral: the backend's gateway decides which
// provider runs (ADR 0015). Checking the status runs the provider's probes, never a model.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import { BackendError } from '../ipc/types';
import type { AiCapabilities, AiProviderInfo, AiProviderStatus } from '../ipc/types';
import { useSettings } from './settings';
import { useToasts } from './toasts';

interface AiProviderState {
  status: AiProviderStatus | null;
  capabilities: AiCapabilities | null;
  checking: boolean;
  /** The providers the "AI provider" setting offers; null until loaded. */
  providers: AiProviderInfo[] | null;
  /**
   * Model id or alias for the next message; empty for the provider's default. Starts on
   * `settings.ai.model` and is written back there when the user picks one.
   */
  model: string;
  /** The model new conversations start with: the last one the user picked. */
  defaultModel: string;
  /**
   * `model` / `defaultModel` are only the provider's first model, put there because the remembered
   * one was not offered (yet: the list may still be a placeholder). A later check with the real
   * list brings the remembered model back; a model the user picks is never replaced.
   */
  modelIsFallback: boolean;
  defaultIsFallback: boolean;

  /** Checks the provider; a check younger than a minute is reused unless `force`. */
  checkStatus: (force?: boolean) => Promise<void>;
  /** Picks the model and remembers it in the settings (debounced). */
  setModel: (model: string) => void;
  /** Shows a model without remembering it (a loaded conversation keeps its own). */
  showModel: (model: string) => void;
  /** Back to the remembered model (a new conversation). */
  showRememberedModel: () => void;
  loadProviders: () => Promise<void>;
  /** Switches the provider (refused by the backend while an operation runs). */
  setProvider: (id: string) => Promise<void>;
}

/** How long the model picker waits before remembering a choice. */
export const MODEL_SAVE_DELAY_MS = 400;
let modelSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const selectUsable = (s: AiProviderState) =>
  s.status !== null && s.status.installed && s.status.loggedIn && s.status.problem === null;
export const selectProviderName = (s: AiProviderState) => s.status?.displayName ?? 'AI';

export function errorMessage(err: unknown): string {
  if (err instanceof BackendError || err instanceof Error) return err.message;
  return String(err);
}

export const useAiProvider = create<AiProviderState>()((set, get) => ({
  status: null,
  capabilities: null,
  checking: false,
  providers: null,
  model: '',
  defaultModel: '',
  modelIsFallback: false,
  defaultIsFallback: false,

  async checkStatus(force = false) {
    if (get().checking) return;
    set({ checking: true });
    try {
      // The status check also asks the provider which models it offers: the capabilities are
      // read after it.
      const status = await backend.aiStatus(force);
      const capabilities = await backend.aiCapabilities();
      // The picker starts on the last model chosen (remembered in the settings), if the provider
      // still offers it; otherwise on its first model.
      const offered = (id: string) => capabilities.models.some((m) => m.id === id);
      const remembered = useSettings.getState().settings.ai.model;
      set((s) => {
        const keepDefault = !s.defaultIsFallback && offered(s.defaultModel);
        const defaultModel = keepDefault
          ? s.defaultModel
          : offered(remembered)
            ? remembered
            : (capabilities.models[0]?.id ?? '');
        const defaultIsFallback = !keepDefault && !offered(remembered);
        const keepModel = !s.modelIsFallback && offered(s.model);
        return {
          status,
          capabilities,
          defaultModel,
          defaultIsFallback,
          model: keepModel ? s.model : defaultModel,
          modelIsFallback: keepModel ? false : defaultIsFallback,
        };
      });
    } catch (err) {
      set({
        status: {
          providerId: 'unknown',
          displayName: 'AI',
          installed: false,
          loggedIn: false,
          version: null,
          account: null,
          plan: null,
          problem: errorMessage(err),
          help: null,
        },
      });
    } finally {
      set({ checking: false });
    }
  },

  setModel(model) {
    const next = model.trim();
    set({ model: next, defaultModel: next, modelIsFallback: false, defaultIsFallback: false });
    // Remembered for the next conversations and the next start (debounced: a custom id is
    // typed character by character).
    if (modelSaveTimer) clearTimeout(modelSaveTimer);
    modelSaveTimer = setTimeout(() => {
      modelSaveTimer = null;
      if (useSettings.getState().settings.ai.model === next) return;
      useSettings
        .getState()
        .update({ ai: { model: next } })
        .catch((err: unknown) => {
          useToasts.getState().notify('error', `Cannot remember the model: ${errorMessage(err)}`);
        });
    }, MODEL_SAVE_DELAY_MS);
  },

  showModel(model) {
    if (model) set({ model, modelIsFallback: false });
  },

  showRememberedModel() {
    set((s) =>
      s.defaultModel
        ? { model: s.defaultModel, modelIsFallback: s.defaultIsFallback }
        : { model: s.model },
    );
  },

  async loadProviders() {
    try {
      set({ providers: await backend.aiProviders() });
    } catch (err) {
      useToasts.getState().notify('error', `Cannot list the AI providers: ${errorMessage(err)}`);
    }
  },

  async setProvider(id) {
    const settings = await backend.aiSetProvider(id);
    useSettings.setState({ settings });
    // Another provider: its status and capabilities are checked again when needed.
    if (get().status?.providerId !== id) {
      set({
        status: null,
        capabilities: null,
        model: '',
        defaultModel: '',
        modelIsFallback: false,
        defaultIsFallback: false,
      });
    }
  },
}));

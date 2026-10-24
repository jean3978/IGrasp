// The model picker: the provider's models and a custom id. The choice is remembered in the
// settings (debounced) and is the default of the next conversations.

import { useState } from 'react';
import { useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import './ai.css';

/** Like the provider's own check: letters, digits and `.-_:/`. */
export const VALID_MODEL_ID = /^[A-Za-z0-9._:/-]*$/;

export function ModelPicker({ label = 'Model' }: { label?: string }) {
  const model = useAiProvider((s) => s.model);
  const setModel = useAiProvider((s) => s.setModel);
  const capabilities = useAiProvider((s) => s.capabilities);
  const models = capabilities?.models ?? [];
  const running = useAiConversation(selectBusy);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  const busy = running || confirming;
  const isPreset = models.some((m) => m.id === model);
  const [custom, setCustom] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const showCustom = custom || (!isPreset && model !== '');
  return (
    <span className="ai-model">
      <select
        className="ai-select"
        aria-label={label}
        value={showCustom ? 'custom' : model}
        disabled={busy}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setCustom(true);
          } else {
            setCustom(false);
            setInvalid(false);
            setModel(e.target.value);
          }
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
        <option value="custom">custom…</option>
      </select>
      {showCustom && (
        <input
          className="text-input ai-model-input"
          aria-label={`${label} id`}
          aria-invalid={invalid}
          title={invalid ? 'Letters, digits and . - _ : / only' : undefined}
          placeholder="model id"
          defaultValue={isPreset ? '' : model}
          disabled={busy}
          onBlur={(e) => {
            const value = e.target.value.trim();
            const ok = VALID_MODEL_ID.test(value);
            setInvalid(!ok);
            if (ok) setModel(value);
          }}
        />
      )}
    </span>
  );
}

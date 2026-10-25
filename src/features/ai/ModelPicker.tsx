// The model picker: exactly the models the provider offers (the provider lists them; for a CLI,
// the models it reports for the user's account). The choice is remembered in the settings
// (debounced) and is the default of the next conversations.

import { useAiProvider } from '../../stores/aiProvider';
import { selectBusy, useAiConversation } from '../../stores/aiConversation';
import type { AiModel } from '../../ipc/types';
import './ai.css';

/** One stable empty list, so the store selector does not re-render forever. */
const NO_MODELS: AiModel[] = [];

export function ModelPicker({ label = 'Model' }: { label?: string }) {
  const model = useAiProvider((s) => s.model);
  const setModel = useAiProvider((s) => s.setModel);
  const models = useAiProvider((s) => s.capabilities?.models ?? NO_MODELS);
  const running = useAiConversation(selectBusy);
  const confirming = useAiConversation((s) => s.pendingConfirm !== null);
  const selected = models.find((m) => m.id === model);
  return (
    <span className="ai-model">
      <select
        className="ai-select"
        aria-label={label}
        title={selected ? (selected.description ?? selected.label) : undefined}
        value={selected ? model : ''}
        disabled={running || confirming || models.length === 0}
        onChange={(e) => {
          setModel(e.target.value);
        }}
      >
        {!selected && <option value="" disabled />}
        {models.map((m) => (
          <option key={m.id} value={m.id} title={m.description ?? undefined}>
            {m.label}
          </option>
        ))}
      </select>
    </span>
  );
}

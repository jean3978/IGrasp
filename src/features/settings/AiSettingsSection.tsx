// Settings → AI: the provider, the default model, the permission defaults, the confirmation
// threshold, the history, and the provider's status. Every control here changes settings or app
// data only; none reaches a model (checking the status runs the provider's probes). Help texts
// name the provider through its display name.

import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { DEFAULT_AI_SETTINGS } from '../../ipc/defaults';
import type { ConfirmFrom, PermissionRule } from '../../ipc/types';
import { useAiConversation } from '../../stores/aiConversation';
import { useAiProvider } from '../../stores/aiProvider';
import { useSettings } from '../../stores/settings';
import { useToasts } from '../../stores/toasts';
import { useWorkspace } from '../../stores/workspace';
import { ModelPicker } from '../ai/ModelPicker';
import { PERMISSION_CATEGORIES } from '../ai/permissionKinds';
import { StatusLine } from '../ai/StatusLine';
import { Field, Segmented } from './fields';
import { save } from './saveSetting';

const RULES: { value: PermissionRule; label: string }[] = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
];

const THRESHOLDS: { value: ConfirmFrom; label: string }[] = [
  { value: 'medium', label: 'From medium' },
  { value: 'large', label: 'From large' },
  { value: 'never', label: 'Never' },
];

const HISTORY_LIMITS = ['25', '100', '500'] as const;
type HistoryLimit = (typeof HISTORY_LIMITS)[number];

/** The provider's display name for help texts: from the provider list, else its status. */
function useProviderName(): string {
  const id = useSettings((s) => s.settings.ai.provider);
  const providers = useAiProvider((s) => s.providers);
  const status = useAiProvider((s) => s.status);
  return (
    providers?.find((p) => p.id === id)?.displayName ?? status?.displayName ?? 'the AI provider'
  );
}

function ProviderField({ name }: { name: string }) {
  const id = useSettings((s) => s.settings.ai.provider);
  const providers = useAiProvider((s) => s.providers);
  const setProvider = useAiProvider((s) => s.setProvider);
  const options = (providers ?? []).map((p) => ({ value: p.id, label: p.displayName }));
  return (
    <Field
      label="AI provider"
      description={
        options.length <= 1
          ? `${name} is the only provider for now.`
          : 'Which AI the chat talks to. It cannot change while an answer is running.'
      }
    >
      <Segmented<string>
        label="AI provider"
        value={id}
        options={options.length > 0 ? options : [{ value: id, label: name }]}
        disabled={options.length <= 1}
        onChange={(next) => {
          setProvider(next).catch((err: unknown) => {
            useToasts.getState().notify('error', `Cannot change the provider: ${String(err)}`);
          });
        }}
      />
    </Field>
  );
}

function PermissionRows({ name }: { name: string }) {
  const permissions = useSettings((s) => s.settings.ai.permissions);
  const isDefault = PERMISSION_CATEGORIES.every(
    (c) => permissions[c.key] === DEFAULT_AI_SETTINGS.permissions[c.key],
  );
  return (
    <div className="settings-subsection" role="group" aria-labelledby="settings-ai-permissions">
      <h3 id="settings-ai-permissions">Permissions</h3>
      <p className="settings-description">
        What happens when {name} asks to do something. Reading files inside the folder never asks. A
        change applies from the next message.
      </p>
      {PERMISSION_CATEGORIES.map((c) => {
        const value = permissions[c.key];
        return (
          <Field
            key={c.key}
            label={c.label}
            description={c.description.replace('{provider}', name)}
          >
            <Segmented<PermissionRule>
              label={c.label}
              value={value}
              options={RULES}
              onChange={(rule) => {
                save({ ai: { permissions: { [c.key]: rule } } });
              }}
            />
            {c.risky && value === 'allow' && (
              <span className="settings-warning" role="note">
                <TriangleAlert aria-hidden /> Runs without asking you
              </span>
            )}
          </Field>
        );
      })}
      <Field label="Reset permissions" description="Back to Ask for every category.">
        <Button
          disabled={isDefault}
          onClick={() => {
            save({ ai: { permissions: { ...DEFAULT_AI_SETTINGS.permissions } } });
          }}
        >
          Reset to defaults
        </Button>
      </Field>
    </div>
  );
}

function ForgetConversations() {
  const root = useWorkspace((s) => s.root);
  const forgetAll = useAiConversation((s) => s.forgetAll);
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Field
      label="Forget this folder's conversations"
      description={
        root
          ? `Deletes the chat history kept for ${root.name} in the app data folder. The files of the folder are not touched.`
          : 'Open a folder to forget its conversations.'
      }
    >
      {confirming ? (
        <>
          <Button
            variant="primary"
            onClick={() => {
              setConfirming(false);
              void forgetAll().then(() => {
                setDone(true);
              });
            }}
          >
            Forget them
          </Button>
          <Button
            onClick={() => {
              setConfirming(false);
            }}
          >
            Keep them
          </Button>
        </>
      ) : (
        <Button
          disabled={!root}
          onClick={() => {
            setDone(false);
            setConfirming(true);
          }}
        >
          Forget conversations…
        </Button>
      )}
      {done && (
        <span className="settings-value" role="status">
          Forgotten.
        </span>
      )}
    </Field>
  );
}

export function AiSettingsSection() {
  const ai = useSettings((s) => s.settings.ai);
  const providers = useAiProvider((s) => s.providers);
  const loadProviders = useAiProvider((s) => s.loadProviders);
  const checkStatus = useAiProvider((s) => s.checkStatus);
  const name = useProviderName();
  const limit = HISTORY_LIMITS.find((l) => Number(l) === ai.historyLimit);

  // The status check is free (a minute's cache, probes only); no model is called.
  useEffect(() => {
    if (providers === null) void loadProviders();
    void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page is shown
  }, []);

  return (
    <section aria-labelledby="settings-ai" className="settings-ai">
      <h2 id="settings-ai">AI</h2>
      <Field label="Status" description={`Whether ${name} is installed and signed in.`}>
        <StatusLine showSession={false} showCheckAgain />
      </Field>
      <ProviderField name={name} />
      <Field
        label="Default model"
        description={`The model new conversations use with ${name}; the chat's picker changes it too. A conversation reopened from the history keeps its own.`}
      >
        <ModelPicker label="Default model" />
      </Field>
      <PermissionRows name={name} />
      <Field
        label="Confirm before sending"
        description={`Shows what will be sent to ${name} and its estimated size, and waits for Start, when a message is at least this large.`}
      >
        <Segmented<ConfirmFrom>
          label="Confirm before sending"
          value={ai.confirmFrom}
          options={THRESHOLDS}
          onChange={(confirmFrom) => {
            save({ ai: { confirmFrom } });
          }}
        />
      </Field>
      <Field
        label="Conversations kept per folder"
        description="The oldest ones are forgotten beyond this number (app data only)."
      >
        <Segmented<HistoryLimit | ''>
          label="Conversations kept per folder"
          value={limit ?? ''}
          options={HISTORY_LIMITS.map((l) => ({ value: l, label: l }))}
          onChange={(v) => {
            if (v) save({ ai: { historyLimit: Number(v) } });
          }}
        />
      </Field>
      <ForgetConversations />
    </section>
  );
}

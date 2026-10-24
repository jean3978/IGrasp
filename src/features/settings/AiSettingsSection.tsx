// Settings → AI. Every control here changes app data only; none reaches a provider.

import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { useAiConversation } from '../../stores/aiConversation';
import { useWorkspace } from '../../stores/workspace';
import { Field } from './fields';

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
  return (
    <section aria-labelledby="settings-ai">
      <h2 id="settings-ai">AI</h2>
      <ForgetConversations />
    </section>
  );
}

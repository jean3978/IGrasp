// Correcting the project profile: remove a detected kind, engine or framework (×), add one
// (suggestions or free text), write a note the generators receive verbatim ("this is also a
// dedicated server"), or reset to what was detected. Saved per folder in app data.

import { Dialog } from 'radix-ui';
import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import type { Detected, ProfileCorrections, ProjectKind, ProjectProfile } from '../../ipc/types';
import {
  ADDABLE_KINDS,
  BY_YOU,
  EMPTY_CORRECTIONS,
  ENGINE_SUGGESTIONS,
  FRAMEWORK_SUGGESTIONS,
  KIND_LABELS,
} from './labels';
import './profile.css';

/** What was detected (the profile without the user's additions, with the removed items back). */
function detectedValues<T>(items: Detected<T>[], removed: T[]): T[] {
  const kept = items.filter((d) => !d.evidence.includes(BY_YOU)).map((d) => d.value);
  return [...kept, ...removed.filter((r) => !kept.includes(r))];
}

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

interface ListEditorProps<T> {
  title: string;
  detected: T[];
  add: T[];
  remove: T[];
  label: (v: T) => string;
  same: (a: T, b: T) => boolean;
  onChange: (add: T[], remove: T[]) => void;
}

function ListEditor<T>({
  title,
  detected,
  add,
  remove,
  label,
  same,
  onChange,
}: ListEditorProps<T>) {
  const shown = [
    ...add,
    ...detected.filter((d) => !remove.some((r) => same(r, d)) && !add.some((a) => same(a, d))),
  ];
  const removedDetected = detected.filter((d) => remove.some((r) => same(r, d)));
  return (
    <ul className="profile-chips profile-edit-chips" aria-label={title}>
      {shown.map((v) => {
        const mine = add.some((a) => same(a, v));
        return (
          <li key={label(v)}>
            <span className={mine ? 'profile-chip profile-chip-you' : 'profile-chip'}>
              {label(v)}
              {mine && <span className="profile-chip-badge">you</span>}
              <button
                type="button"
                className="profile-chip-remove"
                aria-label={`Remove ${label(v)}`}
                onClick={() => {
                  if (mine)
                    onChange(
                      add.filter((a) => !same(a, v)),
                      remove,
                    );
                  else onChange(add, [...remove, v]);
                }}
              >
                <X aria-hidden />
              </button>
            </span>
          </li>
        );
      })}
      {removedDetected.map((v) => (
        <li key={`removed-${label(v)}`}>
          <button
            type="button"
            className="profile-chip profile-chip-removed"
            title="Removed by you: click to restore"
            aria-label={`Restore ${label(v)}`}
            onClick={() => {
              onChange(
                add,
                remove.filter((r) => !same(r, v)),
              );
            }}
          >
            {label(v)}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TextAdder({
  label,
  suggestions,
  onAdd,
}: {
  label: string;
  suggestions: string[];
  onAdd: (value: string) => void;
}) {
  const [text, setText] = useState('');
  const listId = useId();
  const submit = () => {
    const value = text.trim();
    if (value) onAdd(value);
    setText('');
  };
  return (
    <span className="profile-adder">
      <input
        className="profile-input"
        aria-label={label}
        placeholder={label}
        list={listId}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <Button onClick={submit} disabled={text.trim() === ''} aria-label={`Add ${label}`}>
        <Plus aria-hidden /> Add
      </Button>
    </span>
  );
}

export interface ProfileEditDialogProps {
  open: boolean;
  profile: ProjectProfile;
  onOpenChange: (open: boolean) => void;
  onSave: (corrections: ProfileCorrections) => Promise<void>;
}

export function ProfileEditDialog({ open, profile, onOpenChange, onSave }: ProfileEditDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        {open && <EditorContent profile={profile} onOpenChange={onOpenChange} onSave={onSave} />}
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditorContent({ profile, onOpenChange, onSave }: Omit<ProfileEditDialogProps, 'open'>) {
  const [c, setC] = useState<ProfileCorrections>(() => structuredClone(profile.corrections));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesId = useId();
  const kindSelectId = useId();
  const saved = profile.corrections;
  const detectedKinds = detectedValues(profile.kinds, saved.removeKinds).filter(
    (k) => k !== 'unknown',
  );
  const detectedEngines = detectedValues(profile.engines, saved.removeEngines);
  const detectedFrameworks = detectedValues(profile.frameworks, saved.removeFrameworks);
  const kindOptions = ADDABLE_KINDS.filter(
    (k) => !c.addKinds.includes(k) && (!detectedKinds.includes(k) || c.removeKinds.includes(k)),
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(c);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Content className="dialog profile-dialog" aria-describedby={undefined}>
      <Dialog.Close className="dialog-close" aria-label="Close">
        <X aria-hidden />
      </Dialog.Close>
      <Dialog.Title className="profile-dialog-title">Edit the project profile</Dialog.Title>
      <p className="profile-dialog-intro">
        What IGrasp detected in the folder, without AI. Every quiz and tutorial is written for this
        profile, so correct what is wrong; your changes are kept for this folder.
      </p>

      <h3 className="profile-dialog-heading">Kind</h3>
      <ListEditor<ProjectKind>
        title="Kinds"
        detected={detectedKinds}
        add={c.addKinds}
        remove={c.removeKinds}
        label={(k) => KIND_LABELS[k]}
        same={(a, b) => a === b}
        onChange={(addKinds, removeKinds) => {
          setC({ ...c, addKinds, removeKinds });
        }}
      />
      <span className="profile-adder">
        <select
          id={kindSelectId}
          className="profile-input"
          aria-label="Add a kind"
          value=""
          onChange={(e) => {
            const kind = ADDABLE_KINDS.find((k) => k === e.target.value);
            if (!kind) return;
            setC({
              ...c,
              addKinds: c.removeKinds.includes(kind) ? c.addKinds : [...c.addKinds, kind],
              removeKinds: c.removeKinds.filter((k) => k !== kind),
            });
          }}
        >
          <option value="">Add a kind…</option>
          {kindOptions.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </span>

      <h3 className="profile-dialog-heading">Engine</h3>
      <ListEditor<string>
        title="Engines"
        detected={detectedEngines}
        add={c.addEngines}
        remove={c.removeEngines}
        label={(e) => e}
        same={sameText}
        onChange={(addEngines, removeEngines) => {
          setC({ ...c, addEngines, removeEngines });
        }}
      />
      <TextAdder
        label="engine"
        suggestions={ENGINE_SUGGESTIONS}
        onAdd={(v) => {
          if (!c.addEngines.some((e) => sameText(e, v))) {
            setC({
              ...c,
              addEngines: [...c.addEngines, v],
              removeEngines: c.removeEngines.filter((e) => !sameText(e, v)),
            });
          }
        }}
      />

      <h3 className="profile-dialog-heading">Frameworks</h3>
      <ListEditor<string>
        title="Frameworks"
        detected={detectedFrameworks}
        add={c.addFrameworks}
        remove={c.removeFrameworks}
        label={(f) => f}
        same={sameText}
        onChange={(addFrameworks, removeFrameworks) => {
          setC({ ...c, addFrameworks, removeFrameworks });
        }}
      />
      <TextAdder
        label="framework"
        suggestions={FRAMEWORK_SUGGESTIONS}
        onAdd={(v) => {
          if (!c.addFrameworks.some((f) => sameText(f, v))) {
            setC({
              ...c,
              addFrameworks: [...c.addFrameworks, v],
              removeFrameworks: c.removeFrameworks.filter((f) => !sameText(f, v)),
            });
          }
        }}
      />

      <h3 className="profile-dialog-heading">
        <label htmlFor={notesId}>Notes for the generators</label>
      </h3>
      <textarea
        id={notesId}
        className="profile-notes-input"
        rows={3}
        maxLength={1000}
        placeholder="For example: this is also a dedicated server; the web client lives in another repository."
        value={c.notes}
        onChange={(e) => {
          setC({ ...c, notes: e.target.value });
        }}
      />

      {error && (
        <p className="profile-error" role="alert">
          {error}
        </p>
      )}
      <footer className="profile-dialog-actions">
        <Button
          variant="ghost"
          onClick={() => {
            setC(structuredClone(EMPTY_CORRECTIONS));
          }}
        >
          Reset to detected
        </Button>
        <span className="profile-dialog-spacer" />
        <Button
          onClick={() => {
            onOpenChange(false);
          }}
        >
          Cancel
        </Button>
        <Button variant="primary" disabled={saving} onClick={() => void save()}>
          Save
        </Button>
      </footer>
    </Dialog.Content>
  );
}

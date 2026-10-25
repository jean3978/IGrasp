import { useEffect, useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { backend } from '../../ipc/client';
import { DEFAULT_SETTINGS, MAX_FONT_SIZE, MIN_FONT_SIZE } from '../../ipc/defaults';
import type { AppInfo, ReadingWidth, Theme, WindowFrame } from '../../ipc/types';
import { useSettings } from '../../stores/settings';
import { useToasts } from '../../stores/toasts';
import { useTree } from '../../stores/tree';
import { useWorkspace } from '../../stores/workspace';
import { THEME_OPTIONS } from '../titlebar/menuActions';
import { AiSettingsSection } from './AiSettingsSection';
import { Field, Segmented, Toggle } from './fields';
import { save } from './saveSetting';
import './settings.css';

const READING_WIDTHS: { value: ReadingWidth; label: string }[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
  { value: 'full', label: 'Full' },
];

const FRAMES: { value: WindowFrame; label: string }[] = [
  { value: 'custom', label: 'Custom' },
  { value: 'native', label: 'Native' },
];

/** Re-mounted (through its key) when the saved patterns change, e.g. after a reset. */
function IgnorePatterns({ saved }: { saved: string[] }) {
  const [text, setText] = useState(saved.join('\n'));
  const id = useId();
  const dirty =
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n') !== saved.join('\n');

  const apply = async () => {
    const patterns = text.split('\n');
    await useSettings.getState().update({ ignorePatterns: patterns });
    if (useWorkspace.getState().root) await useTree.getState().refresh();
  };

  return (
    <Field
      label="Extra ignore patterns"
      htmlFor={id}
      description="One gitignore-style pattern per line (for example drafts/ or *.generated.md). They apply in every mode, even when ignored files are shown."
    >
      <textarea
        id={id}
        className="settings-textarea"
        rows={5}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
      />
      <Button
        variant="primary"
        disabled={!dirty}
        onClick={() => {
          apply().catch((err: unknown) => {
            useToasts.getState().notify('error', `Cannot apply the patterns: ${String(err)}`);
          });
        }}
      >
        Apply
      </Button>
    </Field>
  );
}

export function SettingsTab() {
  const settings = useSettings((s) => s.settings);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const ids = {
    fontSize: useId(),
    muted: useId(),
    dotfiles: useId(),
    ignored: useId(),
  };

  useEffect(() => {
    void backend.getAppInfo().then(setInfo);
  }, []);

  return (
    <div className="document-scroll" tabIndex={0} aria-label="Settings">
      <div className="settings">
        <h1>Settings</h1>

        <section aria-labelledby="settings-appearance">
          <h2 id="settings-appearance">Appearance</h2>
          <Field label="Theme">
            <Segmented<Theme>
              label="Theme"
              value={settings.theme}
              options={THEME_OPTIONS}
              onChange={(theme) => {
                save({ theme });
              }}
            />
          </Field>
          <Field
            label="Font size"
            htmlFor={ids.fontSize}
            description="Size of the document text (Ctrl+= and Ctrl+- also change it)."
          >
            <input
              id={ids.fontSize}
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              step={1}
              value={settings.fontSize}
              aria-valuetext={`${String(settings.fontSize)} pixels`}
              onChange={(e) => {
                save({ fontSize: Number(e.target.value) });
              }}
            />
            <span className="settings-value">{settings.fontSize}px</span>
            <p className="settings-sample" style={{ fontSize: settings.fontSize }}>
              The quick brown fox reads the documentation.
            </p>
          </Field>
          <Field label="Reading width" description="Maximum width of the document text.">
            <Segmented<ReadingWidth>
              label="Reading width"
              value={settings.readingWidth}
              options={READING_WIDTHS}
              onChange={(readingWidth) => {
                save({ readingWidth });
              }}
            />
          </Field>
          <Field
            label="Window frame"
            description="Native uses the system title bar and borders, if the custom frame misbehaves with your window manager."
          >
            <Segmented<WindowFrame>
              label="Window frame"
              value={settings.windowFrame}
              options={FRAMES}
              onChange={(windowFrame) => {
                save({ windowFrame });
              }}
            />
          </Field>
        </section>

        <section aria-labelledby="settings-notifications">
          <h2 id="settings-notifications">Notifications</h2>
          <Field
            label="Mute notifications"
            htmlFor={ids.muted}
            description="Files still reload live; only the toasts are hidden."
          >
            <Toggle
              id={ids.muted}
              checked={settings.toastsMuted}
              onChange={(toastsMuted) => {
                save({ toastsMuted });
              }}
            />
          </Field>
        </section>

        <section aria-labelledby="settings-files">
          <h2 id="settings-files">Files</h2>
          <IgnorePatterns
            key={settings.ignorePatterns.join('\n')}
            saved={settings.ignorePatterns}
          />
          <Field
            label="Show dotfiles by default"
            htmlFor={ids.dotfiles}
            description="For folders opened for the first time; each folder remembers its own choice."
          >
            <Toggle
              id={ids.dotfiles}
              checked={settings.showDotfiles}
              onChange={(showDotfiles) => {
                save({ showDotfiles });
              }}
            />
          </Field>
          <Field label="Show ignored files by default" htmlFor={ids.ignored}>
            <Toggle
              id={ids.ignored}
              checked={settings.showIgnored}
              onChange={(showIgnored) => {
                save({ showIgnored });
              }}
            />
          </Field>
        </section>

        <AiSettingsSection />

        <section aria-labelledby="settings-data">
          <h2 id="settings-data">Data</h2>
          <Field
            label="App data folder"
            description="Settings, recent folders and sessions. IGrasp never writes inside the folders you open."
          >
            <code className="settings-path">{info?.appDataDir ?? '…'}</code>
            <Button
              onClick={() => {
                backend.openAppDataDir().catch((err: unknown) => {
                  useToasts.getState().notify('error', `Cannot open the folder: ${String(err)}`);
                });
              }}
            >
              Open folder
            </Button>
          </Field>
          <Field label="Reset settings" description="Restore every setting to its default value.">
            <Button
              onClick={() => {
                const { version, ...defaults } = DEFAULT_SETTINGS;
                save(defaults);
              }}
            >
              Reset settings
            </Button>
          </Field>
        </section>

        <section aria-labelledby="settings-about">
          <h2 id="settings-about">About</h2>
          <p className="settings-about">
            IGrasp {info?.version} · Tauri {info?.tauriVersion} · {info?.os}
          </p>
        </section>
      </div>
    </div>
  );
}

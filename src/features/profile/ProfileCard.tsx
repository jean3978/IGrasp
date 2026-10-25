// The project profile as a card: the summary line, the detected kinds, engines and frameworks
// (a low-confidence chip is dotted; its tooltip lists the evidence, and a click opens the first
// file), the languages as a bar, the main modules, build, tests and CI. Shared by the quiz home
// and, later, the tutorials. Everything here is local: no AI.

import { clsx } from 'clsx';
import { Pencil, RefreshCw } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import type { Detected, ProjectProfile } from '../../ipc/types';
import { openSourceFile } from '../../stores/tabs';
import { formatSize } from '../code/codeLines';
import { BY_YOU, KIND_LABELS } from './labels';
import './profile.css';

/** Colors of the language bar, cycled (theme tokens). */
const BAR_COLORS = 6;

function Chip<T>({ item, label }: { item: Detected<T>; label: string }) {
  const byYou = item.evidence.includes(BY_YOU);
  const evidence = item.evidence.filter((e) => e !== BY_YOU);
  const title = byYou
    ? `${label}: corrected by you`
    : `${label} (${item.confidence} confidence)${evidence.length > 0 ? `\nEvidence: ${evidence.join(', ')}` : ''}`;
  const first = evidence[0];
  return (
    <li>
      <button
        type="button"
        className={clsx('profile-chip', `profile-chip-${item.confidence}`, {
          'profile-chip-you': byYou,
        })}
        title={title}
        aria-label={title.replace('\n', '. ')}
        disabled={first === undefined}
        onClick={() => {
          if (first !== undefined) openSourceFile(first);
        }}
      >
        {label}
        {byYou && <span className="profile-chip-badge">you</span>}
      </button>
    </li>
  );
}

function ChipRow<T>({
  title,
  items,
  label,
}: {
  title: string;
  items: Detected<T>[];
  label: (value: T) => string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="profile-row">
      <span className="profile-row-title">{title}</span>
      <ul className="profile-chips" aria-label={title}>
        {items.map((item) => (
          <Chip key={label(item.value)} item={item} label={label(item.value)} />
        ))}
      </ul>
    </div>
  );
}

function Tools({ title, items }: { title: string; items: Detected<string>[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <dt>{title}</dt>
      <dd>{items.map((i) => i.value).join(', ')}</dd>
    </>
  );
}

export interface ProfileCardProps {
  profile: ProjectProfile;
  onEdit: () => void;
  /** Rebuilds the profile from the folder (a local walk). */
  onRebuild?: () => void;
  /** Hides the modules and tools (a compact card). */
  compact?: boolean;
}

export function ProfileCard({ profile, onEdit, onRebuild, compact = false }: ProfileCardProps) {
  const languages = profile.languages.filter((l) => l.percent >= 1).slice(0, 8);
  return (
    <section className="profile-card" aria-label="Project profile">
      <header className="profile-header">
        <h2 className="profile-title">Project profile</h2>
        {onRebuild && (
          <Button variant="ghost" onClick={onRebuild} title="Detect again from the folder">
            <RefreshCw aria-hidden /> Detect again
          </Button>
        )}
        <Button onClick={onEdit}>
          <Pencil aria-hidden /> Edit
        </Button>
      </header>
      <p className="profile-summary">{profile.summary}</p>
      {profile.corrections.notes && (
        <p className="profile-notes">
          <span className="profile-notes-label">Your note:</span> {profile.corrections.notes}
        </p>
      )}
      <ChipRow title="Kind" items={profile.kinds} label={(k) => KIND_LABELS[k]} />
      <ChipRow title="Engine" items={profile.engines} label={(e) => e} />
      <ChipRow title="Frameworks" items={profile.frameworks} label={(f) => f} />
      {languages.length > 0 && (
        <div className="profile-row">
          <span className="profile-row-title">Languages</span>
          <div className="profile-languages">
            <div
              className="profile-bar"
              role="img"
              aria-label={languages.map((l) => `${l.name} ${String(l.percent)}%`).join(', ')}
            >
              {languages.map((l, i) => (
                <span
                  key={l.name}
                  className={`profile-bar-part profile-bar-${String(i % BAR_COLORS)}`}
                  style={{ flexGrow: l.percent }}
                  title={`${l.name}: ${String(l.percent)}% (${String(l.files)} files)`}
                />
              ))}
            </div>
            <ul className="profile-legend" aria-hidden>
              {languages.map((l, i) => (
                <li key={l.name}>
                  <span className={`profile-dot profile-bar-${String(i % BAR_COLORS)}`} />
                  {l.name} <span className="profile-muted">{l.percent}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!compact && profile.modules.length > 0 && (
        <div className="profile-row">
          <span className="profile-row-title">Modules</span>
          <ul className="profile-modules" aria-label="Modules">
            {profile.modules.slice(0, 12).map((m) => (
              <li
                key={m.path}
                title={`${m.path}: ${String(m.files)} files, ${formatSize(m.bytes)}`}
              >
                <span className="profile-module-name">{m.path}</span>
                {m.role && <span className="profile-module-role">{m.role}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!compact && (
        <dl className="profile-tools">
          <Tools title="Build" items={profile.build} />
          <Tools title="Tests" items={profile.tests} />
          <Tools title="CI" items={profile.ci} />
        </dl>
      )}
      <footer className="profile-footer">
        {profile.filesSeen} files seen in {profile.builtMs} ms
        {profile.truncated && ' (the folder is large: the profile says what it saw)'} · detected
        locally, no AI
      </footer>
    </section>
  );
}

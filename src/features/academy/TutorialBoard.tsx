// The blackboard of the Academy's hub: the tutorials of this folder, one concise line each (a
// progress ring, the title, who it is for and its subject, its difficulty as bars, a mark when
// it needs attention; each mark explains itself in a tooltip) and compact actions. "Details"
// opens a card with the rest: progress, where it lives, freshness, verification, length.
// Many tutorials scroll inside.

import {
  AlertTriangle,
  BadgeCheck,
  CircleCheck,
  CircleDashed,
  Download,
  GraduationCap,
  Info,
  ListChecks,
  Lock,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Popover, Tooltip } from 'radix-ui';
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import type { Familiarity, TutorialSummary } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { useTutorialWrite } from '../../stores/tutorialWrite';
import { formatWhen } from '../quiz/quizFormat';
import { badgeShort } from './freshnessView';
import { FAMILIARITIES, FAMILIARITY_LABEL, LENGTH_LABEL } from './labels';

export function Blackboard({
  tutorials,
  titleId,
}: {
  tutorials: TutorialSummary[];
  titleId: string;
}) {
  return (
    <div className="academy-board">
      <div className="academy-board-head">
        <h2 className="academy-board-title" id={titleId}>
          Your tutorials
        </h2>
        {tutorials.length > 0 && <span className="academy-board-count">{tutorials.length}</span>}
      </div>
      {tutorials.length === 0 ? (
        <div className="academy-board-empty">
          <p>No tutorial on the board yet.</p>
          <p>
            Press <strong>New tutorial</strong> to write the first one. Tutorials stay private (in
            the app&apos;s data, never in the project) until you share one.
          </p>
        </div>
      ) : (
        <ul className="academy-library-list academy-board-list" aria-label="Tutorials">
          {tutorials.map((t) => (
            <BoardRow key={keyOf(t)} t={t} />
          ))}
        </ul>
      )}
      <div className="academy-board-ledge" aria-hidden>
        <span className="academy-chalk-piece" />
        <span className="academy-chalk-piece" data-tone="accent" />
      </div>
    </div>
  );
}

const keyOf = (t: TutorialSummary) =>
  t.reference.type === 'private' ? t.reference.id : t.reference.relPath;

/** What needs the reader's attention: an outdated source, steps changed since read. */
function attention(t: TutorialSummary): string | null {
  const parts: string[] = [];
  if (t.freshness && t.freshness.badge !== 'upToDate') parts.push(badgeShort(t.freshness));
  const updated = t.progress?.updated ?? 0;
  if (updated > 0)
    parts.push(`${String(updated)} ${updated === 1 ? 'step' : 'steps'} updated since you read it`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function BoardRow({ t }: { t: TutorialSummary }) {
  const openTutorial = useAcademy((s) => s.openTutorial);
  const reviewOutline = useAcademy((s) => s.reviewOutline);
  const deleteTutorial = useAcademy((s) => s.deleteTutorial);
  const prepareWrite = useTutorialWrite((s) => s.prepare);
  const busy = useAcademy(selectAcademyBusy);
  const [confirming, setConfirming] = useState(false);
  const key = keyOf(t);
  const written = t.chaptersWritten;
  const isPrivate = t.reference.type === 'private';
  const warn = attention(t);

  return (
    <li className="academy-row">
      <button
        type="button"
        className="academy-row-main"
        onClick={() => {
          if (written === 0 && isPrivate) void reviewOutline(key);
          else openTutorial(t.reference);
        }}
        disabled={busy && written === 0}
      >
        {/* The title first for assistive technologies; the grid shows the ring on the left. */}
        <span className="academy-row-title">{t.title}</span>
        <span className="academy-row-sub">
          {t.role ?? 'Developer'} · {t.subject}
        </span>
        <span className="academy-row-icon">
          <ProgressRing t={t} />
          <SharingBadge t={t} />
        </span>
        <span className="academy-row-marks">
          {warn && (
            <Hint text={`Needs attention: ${warn}`}>
              <AlertTriangle
                className="academy-row-warn"
                role="img"
                aria-label={`Needs attention: ${warn}`}
              />
            </Hint>
          )}
          <DifficultyBars familiarity={t.familiarity} />
        </span>
      </button>

      <span className="academy-row-actions">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className="academy-details-button"
              aria-label={`Details of ${t.title}`}
            >
              <Info aria-hidden /> Details
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="academy-details-popover"
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              aria-label={`Details of ${t.title}`}
            >
              <TutorialDetails t={t} warn={warn} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        {written === 0 && isPrivate && (
          <IconButton label="Review the outline" onClick={() => void reviewOutline(key)}>
            <ListChecks aria-hidden />
          </IconButton>
        )}
        {isPrivate && written > 0 && (
          <>
            <IconButton
              label={
                t.sharedAs
                  ? `Update the shared copy of ${t.title} (${t.sharedAs})`
                  : `Share ${t.title} with the project`
              }
              onClick={() => void prepareWrite({ type: 'share', id: key }, t.title)}
            >
              <Share2 aria-hidden />
            </IconButton>
            <IconButton
              label={`Save ${t.title} as…`}
              onClick={() => void prepareWrite({ type: 'export', id: key }, t.title)}
            >
              <Download aria-hidden />
            </IconButton>
          </>
        )}
        {isPrivate &&
          (confirming ? (
            <span className="academy-row-confirm" role="group" aria-label="Delete this tutorial?">
              <Button
                variant="primary"
                onClick={() => {
                  setConfirming(false);
                  void deleteTutorial(key);
                }}
              >
                Delete
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Keep
              </Button>
            </span>
          ) : (
            <IconButton
              label={`Delete ${t.title}`}
              disabled={busy}
              onClick={() => {
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden />
            </IconButton>
          ))}
      </span>
    </li>
  );
}

/** A mark of the row that explains itself on hover (its image keeps the same text as its name). */
function Hint({ text, children }: { text: string; children: ReactElement }) {
  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>
        <span className="academy-hint">{children}</span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={4}>
          {text}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Where the tutorial lives, in words: private (the app's data) or shared with the project. */
const sharingText = (t: TutorialSummary) =>
  t.reference.type === 'shared'
    ? `Shared in the project: ${t.reference.relPath}`
    : t.sharedAs
      ? `Private, also shared as ${t.sharedAs}`
      : "Private, in the app's data";

/** A small badge on the progress ring: a lock for a private tutorial, people for a shared one. */
function SharingBadge({ t }: { t: TutorialSummary }) {
  const shared = t.reference.type === 'shared' || t.sharedAs !== null;
  const text = sharingText(t);
  const Icon = shared ? Users : Lock;
  return (
    <Hint text={text}>
      <span className="academy-sharing-badge" data-shared={shared ? 'true' : undefined}>
        <Icon role="img" aria-label={text} />
      </span>
    </Hint>
  );
}

const progressText = (t: TutorialSummary) => {
  if (t.progress?.graduated) return 'Graduated';
  if (t.chaptersWritten === 0) return 'Outline only, no chapter written yet';
  return `${String(t.progress?.stepsDone ?? 0)} of ${String(t.stepsTotal)} steps done`;
};

/** Progress at a glance: a ring of the steps done, a cap once graduated, a list for an outline. */
function ProgressRing({ t }: { t: TutorialSummary }) {
  const text = progressText(t);
  if (t.progress?.graduated) {
    return (
      <Hint text={text}>
        <span className="academy-progress-icon" data-done="true">
          <GraduationCap role="img" aria-label={text} />
        </span>
      </Hint>
    );
  }
  if (t.chaptersWritten === 0) {
    return (
      <Hint text={text}>
        <span className="academy-progress-icon">
          <ListChecks role="img" aria-label={text} />
        </span>
      </Hint>
    );
  }
  const done = t.progress?.stepsDone ?? 0;
  const fraction = t.stepsTotal > 0 ? Math.min(1, done / t.stepsTotal) : 0;
  const r = 8;
  const length = 2 * Math.PI * r;
  return (
    <Hint text={text}>
      <span className="academy-progress-icon">
        <svg viewBox="0 0 22 22" role="img" aria-label={text}>
          <circle className="academy-ring-track" cx="11" cy="11" r={r} />
          {fraction > 0 && (
            <circle
              className="academy-ring-value"
              cx="11"
              cy="11"
              r={r}
              strokeDasharray={`${String(fraction * length)} ${String(length)}`}
              transform="rotate(-90 11 11)"
            />
          )}
        </svg>
      </span>
    </Hint>
  );
}

/** The difficulty (how well the reader knew the project) as one to three bars. */
function DifficultyBars({ familiarity }: { familiarity: Familiarity }) {
  const level = FAMILIARITIES.indexOf(familiarity) + 1;
  const text = `Difficulty ${String(level)} of 3: ${FAMILIARITY_LABEL[familiarity]}`;
  return (
    <Hint text={text}>
      <svg className="academy-difficulty" viewBox="0 0 14 14" role="img" aria-label={text}>
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={1 + i * 4.5}
            y={10 - i * 4}
            width="3"
            height={3 + i * 4}
            rx="1"
            data-on={i < level ? 'true' : undefined}
          />
        ))}
      </svg>
    </Hint>
  );
}

/** One status of the card: an icon and its words; `tone` colors the icon only. */
function Status({
  icon: Icon,
  tone,
  children,
}: {
  icon: LucideIcon;
  tone?: 'good' | 'warn';
  children: string;
}) {
  return (
    <li className="academy-details-status" data-tone={tone}>
      <Icon aria-hidden />
      <span>{children}</span>
    </li>
  );
}

/** Everything the board leaves out, in the card behind "Details". */
function TutorialDetails({ t, warn }: { t: TutorialSummary; warn: string | null }) {
  const p = t.progress;
  const written = t.chaptersWritten;
  const fraction = p && t.stepsTotal > 0 ? Math.min(1, p.stepsDone / t.stepsTotal) : 0;
  const facts: [string, string][] = [
    ['Level', FAMILIARITY_LABEL[t.familiarity]],
    ['Length', `${LENGTH_LABEL[t.length].name} · ${LENGTH_LABEL[t.length].detail}`],
    ...(t.domainGap ? [['New to', t.domainGap] as [string, string]] : []),
    [
      'Chapters',
      written === t.chapters
        ? String(t.chapters)
        : written === 0
          ? `outline only (${String(t.chapters)} planned)`
          : `${String(written)} of ${String(t.chapters)} written`,
    ],
    ['Changed', formatWhen(t.updatedMs)],
  ];
  return (
    <div className="academy-details">
      <header className="academy-details-head">
        <p className="academy-details-title">{t.title}</p>
        <p className="academy-details-sub">
          {t.role ?? 'Developer'} · {t.subject}
        </p>
      </header>

      <div className="academy-details-progress">
        <div
          className="academy-details-bar"
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={t.stepsTotal}
          aria-valuenow={p?.stepsDone ?? 0}
        >
          <span style={{ width: `${String(Math.round(fraction * 100))}%` }} />
        </div>
        <span className="academy-details-progress-text">
          {p
            ? `${String(p.stepsDone)} of ${String(t.stepsTotal)} steps · ${String(p.xp)} XP${p.graduated ? ' · graduated' : ''}`
            : 'Not started'}
        </span>
      </div>

      <ul className="academy-details-statuses">
        <Status icon={t.reference.type === 'shared' || t.sharedAs !== null ? Users : Lock}>
          {sharingText(t)}
        </Status>
        {warn ? (
          <Status icon={AlertTriangle} tone="warn">
            {warn}
          </Status>
        ) : (
          <Status icon={CircleCheck} tone="good">
            Sources up to date
          </Status>
        )}
        {t.verified ? (
          <Status
            icon={BadgeCheck}
            tone="good"
          >{`Verified on ${t.verified.date.slice(0, 10)}`}</Status>
        ) : (
          <Status icon={CircleDashed}>Not verified yet</Status>
        )}
      </ul>

      <dl className="academy-details-facts">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

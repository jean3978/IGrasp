// The blackboard of the Academy's hub: the tutorials of this folder, one concise line each (a
// progress ring, the title, who it is for and its subject, its difficulty as bars, a mark when
// it needs attention) and compact actions. Hovering or focusing a tutorial shows the rest: where
// it lives, sharing, freshness, verification, length, progress. Many tutorials scroll inside.

import { AlertTriangle, Download, GraduationCap, ListChecks, Share2, Trash2 } from 'lucide-react';
import { Tooltip } from 'radix-ui';
import { useState } from 'react';
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
        {tutorials.length > 0 && (
          <span className="academy-board-hint">Hover a tutorial for its details</span>
        )}
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
      <Tooltip.Root delayDuration={300}>
        <Tooltip.Trigger asChild>
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
            <ProgressRing t={t} />
            <span className="academy-row-marks">
              {warn && (
                <AlertTriangle
                  className="academy-row-warn"
                  role="img"
                  aria-label={`Needs attention: ${warn}`}
                />
              )}
              <DifficultyBars familiarity={t.familiarity} />
            </span>
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="tooltip academy-row-card"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
          >
            <TutorialDetails t={t} warn={warn} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>

      <span className="academy-row-actions">
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

/** Progress at a glance: a ring of the steps done, a cap once graduated, a list for an outline. */
function ProgressRing({ t }: { t: TutorialSummary }) {
  const done = t.progress?.stepsDone ?? 0;
  if (t.progress?.graduated) {
    return (
      <span className="academy-progress-icon" data-done="true">
        <GraduationCap role="img" aria-label="Graduated" />
      </span>
    );
  }
  if (t.chaptersWritten === 0) {
    return (
      <span className="academy-progress-icon">
        <ListChecks role="img" aria-label="Outline only, no chapter written yet" />
      </span>
    );
  }
  const fraction = t.stepsTotal > 0 ? Math.min(1, done / t.stepsTotal) : 0;
  const r = 8;
  const length = 2 * Math.PI * r;
  return (
    <span className="academy-progress-icon">
      <svg
        viewBox="0 0 22 22"
        role="img"
        aria-label={`${String(done)} of ${String(t.stepsTotal)} steps done`}
      >
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
  );
}

/** The difficulty (how well the reader knew the project) as one to three bars. */
function DifficultyBars({ familiarity }: { familiarity: Familiarity }) {
  const level = FAMILIARITIES.indexOf(familiarity) + 1;
  return (
    <svg
      className="academy-difficulty"
      viewBox="0 0 14 14"
      role="img"
      aria-label={`Difficulty ${String(level)} of 3: ${FAMILIARITY_LABEL[familiarity]}`}
    >
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
  );
}

/** Everything the board leaves out, shown on hover or focus. */
function TutorialDetails({ t, warn }: { t: TutorialSummary; warn: string | null }) {
  const p = t.progress;
  const written = t.chaptersWritten;
  const rows: [string, string][] = [
    ['Subject', t.subject],
    ['For', t.role ?? 'A developer'],
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
    [
      'Progress',
      p
        ? `${String(p.stepsDone)} of ${String(t.stepsTotal)} steps · ${String(p.xp)} XP${p.graduated ? ' · graduated' : ''}`
        : 'not started',
    ],
    [
      'Where',
      t.reference.type === 'shared'
        ? `shared in the project: ${t.reference.relPath}`
        : t.sharedAs
          ? `private, shared as ${t.sharedAs}`
          : "private (the app's data)",
    ],
    ['Sources', warn ?? 'up to date'],
    ['Verified', t.verified ? `on ${t.verified.date.slice(0, 10)}` : 'not yet'],
    ['Changed', formatWhen(t.updatedMs)],
  ];
  return (
    <div className="academy-details">
      <p className="academy-details-title">{t.title}</p>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

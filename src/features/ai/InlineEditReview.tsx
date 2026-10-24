// Review mode of a document tab (plan §6.9): the markdown edit the AI proposes, rendered in place
// as a diff of the current and the proposed content. Each change unit (a hunk, or a block group
// of a rewrite) gets Accept / Reject; the ReviewBar answers for the whole edit. The answer goes
// to the provider through the conversation store; nothing here writes a file.

import { Check, MessageSquare, Undo2, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { useAiConversation } from '../../stores/aiConversation';
import type { PendingReview } from '../../stores/aiConversation';
import { useAiPanel } from '../../stores/aiPanel';
import { selectProviderName, useAiProvider } from '../../stores/aiProvider';
import { useWorkspace } from '../../stores/workspace';
import type { ChangeUnit, Review } from '../diff/changes';
import { RenderedDiff } from '../diff/RenderedDiff';
import type { ChangeSlot, ChangeState } from '../diff/RenderedDiff';
import type { UnitDecision } from './editReview';
import './review.css';

const FLASH_MS = 900;

interface Props {
  pending: PendingReview & { review: Review };
  getScrollContainer: () => HTMLElement | null;
}

function ChangeToolbar({
  unit,
  number,
  decision,
  onDecide,
}: {
  unit: ChangeUnit;
  number: number;
  decision: UnitDecision | undefined;
  onDecide: (decision: UnitDecision | null) => void;
}) {
  const several = unit.hunks.length > 1;
  return (
    <span className="review-toolbar" role="toolbar" aria-label={`Change ${String(number)}`}>
      {several && <span className="review-toolbar-note">{unit.label}</span>}
      {decision === undefined ? (
        <>
          <Button
            variant="ghost"
            className="review-accept"
            aria-label={`Accept change ${String(number)}`}
            title="Accept (A)"
            onClick={() => {
              onDecide('accepted');
            }}
          >
            <Check aria-hidden /> Accept
          </Button>
          <Button
            variant="ghost"
            className="review-reject"
            aria-label={`Reject change ${String(number)}`}
            title="Reject (R)"
            onClick={() => {
              onDecide('rejected');
            }}
          >
            <X aria-hidden /> Reject
          </Button>
        </>
      ) : (
        <>
          <span className={`review-state review-state--${decision}`}>
            {decision === 'accepted' ? <Check aria-hidden /> : <X aria-hidden />}
            {decision === 'accepted' ? 'Accepted' : 'Rejected'}
          </span>
          <Button
            variant="ghost"
            aria-label={`Undo the decision on change ${String(number)}`}
            title="Undo"
            onClick={() => {
              onDecide(null);
            }}
          >
            <Undo2 aria-hidden />
          </Button>
        </>
      )}
    </span>
  );
}

export function InlineEditReview({ pending, getScrollContainer }: Props) {
  const { review, decisions } = pending;
  const providerName = useAiProvider(selectProviderName);
  const rootPath = useWorkspace((s) => s.root?.path ?? '');
  const decideUnit = useAiConversation((s) => s.decideUnit);
  const acceptAll = useAiConversation((s) => s.acceptAllChanges);
  const rejectAll = useAiConversation((s) => s.rejectAllChanges);
  const apply = useAiConversation((s) => s.applyReview);
  const [announcement, setAnnouncement] = useState('');
  const [flash, setFlash] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Units in document order are numbered 1..n; units with no visible change come last.
  const units = review.units;
  const numberOf = useMemo(() => new Map(units.map((u, i) => [u.id, i + 1])), [units]);
  const unitOfGroup = useMemo(() => {
    const map = new Map<number, ChangeUnit>();
    for (const unit of units) for (const g of unit.groups) map.set(g, unit);
    return map;
  }, [units]);
  const invisible = units.filter((u) => u.groups.length === 0);

  const states = useMemo<(ChangeState | undefined)[]>(
    () =>
      review.diff.changes.map((_, g) => {
        const unit = unitOfGroup.get(g);
        return unit ? decisions[unit.id] : undefined;
      }),
    [review, unitOfGroup, decisions],
  );

  const decidedCount = units.filter((u) => u.id in decisions).length;
  const acceptedCount = units.filter((u) => decisions[u.id] === 'accepted').length;
  const total = units.length;
  const canApply = decidedCount === total && acceptedCount > 0;

  useEffect(() => {
    if (flash === null) return;
    const timer = setTimeout(() => {
      setFlash(null);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flash]);

  // The change toolbars stick below the review bar, whatever its height.
  useLayoutEffect(() => {
    const bar = barRef.current;
    const root = rootRef.current;
    if (!bar || !root) return;
    const update = () => {
      root.style.setProperty('--review-bar-height', `${String(bar.offsetHeight)}px`);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => {
      observer.disconnect();
    };
  }, []);

  const decide = useCallback(
    (unit: ChangeUnit, decision: UnitDecision | null) => {
      decideUnit(unit.id, decision);
      const n = String(numberOf.get(unit.id) ?? 0);
      setAnnouncement(
        decision === null
          ? `Change ${n}: decision undone.`
          : `Change ${n} ${decision}. ${String(
              units.filter((u) => u.id === unit.id || u.id in decisions).length,
            )} of ${String(total)} decided.`,
      );
      if (decision !== null && unit.groups[0] !== undefined) setFlash(unit.groups[0]);
    },
    [decideUnit, numberOf, units, decisions, total],
  );

  const renderToolbar = (slot: ChangeSlot) => {
    const unit = unitOfGroup.get(slot.index);
    // A unit spanning several groups shows its controls once, on its first group.
    if (!unit || unit.groups[0] !== slot.index) return null;
    return (
      <ChangeToolbar
        unit={unit}
        number={numberOf.get(unit.id) ?? 0}
        decision={decisions[unit.id]}
        onDecide={(d) => {
          decide(unit, d);
        }}
      />
    );
  };

  const onGroupKeyDown = (e: KeyboardEvent<HTMLElement>, slot: ChangeSlot) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'a' && key !== 'r') return;
    const unit = unitOfGroup.get(slot.index);
    if (!unit) return;
    e.preventDefault();
    e.stopPropagation();
    decide(unit, key === 'a' ? 'accepted' : 'rejected');
  };

  const ariaLabel = (slot: ChangeSlot) => {
    const unit = unitOfGroup.get(slot.index);
    if (!unit) return undefined;
    const state = decisions[unit.id];
    return `Change ${String(numberOf.get(unit.id) ?? 0)} of ${String(total)}: ${unit.label}${
      state ? `, ${state}` : ''
    }`;
  };

  const title = pending.isNew
    ? `${providerName} proposes a new file ${pending.path}`
    : `${providerName} proposes ${total === 1 ? '1 change' : `${String(total)} changes`} to ${
        pending.path
      }`;

  return (
    <div className="inline-review" ref={rootRef}>
      <div className="review-bar" ref={barRef} role="region" aria-label="Proposed edit">
        <span className="review-bar-title">{title}</span>
        <span className="review-bar-count">
          {String(decidedCount)} of {String(total)} decided
        </span>
        <span className="review-bar-actions">
          <Button
            variant={canApply ? 'secondary' : 'primary'}
            title="Accepts every undecided change and applies (Alt+Shift+A)"
            onClick={() => {
              void acceptAll();
            }}
          >
            <Check aria-hidden /> Accept all
          </Button>
          <Button
            title="Leaves the file unchanged (Alt+Shift+R)"
            onClick={() => {
              void rejectAll();
            }}
          >
            <X aria-hidden /> Reject all
          </Button>
          <Button
            variant="ghost"
            title="Shows the conversation"
            onClick={() => {
              useAiPanel.getState().setOpen(true);
            }}
          >
            <MessageSquare aria-hidden /> Open in chat
          </Button>
          <Button
            variant={canApply ? 'primary' : 'secondary'}
            disabled={!canApply}
            title={
              canApply
                ? `Applies the ${String(acceptedCount)} accepted change${acceptedCount === 1 ? '' : 's'}`
                : 'Decide every change, and accept at least one, to apply'
            }
            onClick={() => {
              void apply();
            }}
          >
            Apply
          </Button>
        </span>
      </div>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
      {invisible.length > 0 && (
        <div className="review-invisible">
          {invisible.map((unit) => (
            <div
              key={unit.id}
              className="review-invisible-unit"
              role="group"
              tabIndex={0}
              aria-label={`Change ${String(numberOf.get(unit.id) ?? 0)} of ${String(total)}: ${
                unit.label
              } with no visible change (whitespace)`}
              onKeyDown={(e) => {
                const key = e.key.toLowerCase();
                if (e.ctrlKey || e.altKey || e.metaKey || (key !== 'a' && key !== 'r')) return;
                e.preventDefault();
                decide(unit, key === 'a' ? 'accepted' : 'rejected');
              }}
            >
              <span>An edit with no visible change (whitespace or formatting only).</span>
              <ChangeToolbar
                unit={unit}
                number={numberOf.get(unit.id) ?? 0}
                decision={decisions[unit.id]}
                onDecide={(d) => {
                  decide(unit, d);
                }}
              />
            </div>
          ))}
        </div>
      )}
      <RenderedDiff
        oldText={pending.oldContent}
        newText={review.newText}
        diff={review.diff}
        states={states}
        ariaLabel={ariaLabel}
        renderToolbar={renderToolbar}
        onGroupKeyDown={onGroupKeyDown}
        flashIndex={flash}
        relPath={pending.path}
        rootPath={rootPath}
        getScrollContainer={getScrollContainer}
      />
    </div>
  );
}

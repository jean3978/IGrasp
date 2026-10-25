// The outline review: the planned chapters, which the user can reorder (drag, or Shift+Up/Down),
// rename, remove, and tick to write now. Every change is saved privately at once; writing the
// ticked chapters is one operation, behind its confirmation card. When the project lacks material,
// the outline says so and offers the subjects the AI suggested instead.

import {
  ArrowDown,
  ArrowUp,
  FileText,
  GripVertical,
  Home,
  Info,
  PenLine,
  Trash2,
} from 'lucide-react';
import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { AiMark } from '../../components/AiMark';
import { Button } from '../../components/ui/Button';
import type { Chapter } from '../../ipc/types';
import { selectAcademyBusy, useAcademy } from '../../stores/academy';
import { Hoot } from '../hoot/Hoot';
import { pickLine } from '../hoot/hootLines';

export function OutlineReview() {
  const tutorial = useAcademy((s) => s.tutorial);
  const failure = useAcademy((s) => s.failure);
  const editOutline = useAcademy((s) => s.editOutline);
  const prepareChapters = useAcademy((s) => s.prepareChapters);
  const startAgain = useAcademy((s) => s.startAgain);
  const backHome = useAcademy((s) => s.backHome);
  const openTutorial = useAcademy((s) => s.openTutorial);
  const busy = useAcademy(selectAcademyBusy);
  // Every unwritten chapter is ticked unless the user unticks it (by title).
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  const [line] = useState(() => pickLine('outline'));
  const [dragging, setDragging] = useState<number | null>(null);
  const listId = useId();
  const chapters = tutorial?.chapters ?? [];

  if (!tutorial) return null;
  const save = (next: Chapter[]) => void editOutline(next);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= chapters.length || from === to) return;
    const next = [...chapters];
    const [c] = next.splice(from, 1);
    if (c) next.splice(to, 0, c);
    save(next);
  };
  const indices = chapters
    .map((c, i) => (!unticked.has(c.title) && c.steps.length === 0 ? i : -1))
    .filter((i) => i >= 0);
  const written = chapters.filter((c) => c.steps.length > 0).length;

  return (
    <div className="academy-outline">
      <div className="academy-outline-head">
        <div>
          <p className="academy-eyebrow">Outline</p>
          <h1 className="quiz-title">{tutorial.title}</h1>
          <p className="quiz-lead">{tutorial.intro}</p>
        </div>
        <Hoot state="explaining" size={110} line={line} />
      </div>

      {failure && (
        <section className="quiz-panel quiz-failure" role="alert">
          <p>{failure.message}</p>
        </section>
      )}
      {tutorial.materialNote && (
        <section className="quiz-panel academy-material" role="note">
          <p className="quiz-note">
            <Info aria-hidden /> {tutorial.materialNote}
          </p>
          <Button
            onClick={() => {
              startAgain();
            }}
          >
            Start again with another subject
          </Button>
        </section>
      )}
      {tutorial.docsNote && (
        <p className="quiz-note quiz-docs-note">
          <FileText aria-hidden className="quiz-docs-note-icon" /> {tutorial.docsNote}
        </p>
      )}

      <ol className="academy-outline-list" id={listId} aria-label="Chapters">
        {chapters.map((c, i) => (
          <OutlineChapter
            key={`${c.id}-${c.title}`}
            chapter={c}
            index={i}
            count={chapters.length}
            ticked={!unticked.has(c.title)}
            dragging={dragging === i}
            onTick={(on) => {
              setUnticked((s) => {
                const n = new Set(s);
                if (on) n.delete(c.title);
                else n.add(c.title);
                return n;
              });
            }}
            onRename={(title) => {
              const next = chapters.map((x, j) => (j === i ? { ...x, title } : x));
              setUnticked((s) => {
                const n = new Set(s);
                if (n.delete(c.title)) n.add(title);
                return n;
              });
              save(next);
            }}
            onRemove={() => {
              save(chapters.filter((_, j) => j !== i));
            }}
            onMove={(to) => {
              move(i, to);
            }}
            onDragStart={() => {
              setDragging(i);
            }}
            onDragOver={() => {
              if (dragging !== null && dragging !== i) {
                move(dragging, i);
                setDragging(i);
              }
            }}
            onDragEnd={() => {
              setDragging(null);
            }}
          />
        ))}
      </ol>

      <div className="academy-actions">
        <Button
          variant="primary"
          disabled={busy || indices.length === 0}
          onClick={() => void prepareChapters(indices)}
        >
          <PenLine aria-hidden />{' '}
          {indices.length === 1 ? 'Write 1 chapter' : `Write ${String(indices.length)} chapters`}{' '}
          <AiMark />
        </Button>
        {indices.length > 1 && indices[0] !== undefined && (
          <Button disabled={busy} onClick={() => void prepareChapters([indices[0] ?? 0])}>
            Chapter {indices[0] + 1} only <AiMark />
          </Button>
        )}
        {written > 0 && (
          <Button
            onClick={() => {
              openTutorial({ type: 'private', id: tutorial.id });
            }}
          >
            Read the {written} written
          </Button>
        )}
        <Button variant="ghost" onClick={backHome}>
          <Home aria-hidden /> Back to the Academy
        </Button>
      </div>
      <p className="quiz-muted">
        The outline is saved privately: you can come back to it from the library.
      </p>
    </div>
  );
}

interface ChapterProps {
  chapter: Chapter;
  index: number;
  count: number;
  ticked: boolean;
  dragging: boolean;
  onTick: (on: boolean) => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
}

function OutlineChapter(p: ChapterProps) {
  const { chapter: c, index: i } = p;
  const [title, setTitle] = useState(c.title);
  const tickId = useId();
  const written = c.steps.length > 0;
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (!e.shiftKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    p.onMove(e.key === 'ArrowUp' ? i - 1 : i + 1);
  };
  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    p.onDragStart();
  };
  const onPointerMove = (e: PointerEvent<HTMLSpanElement>) => {
    if (!p.dragging) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-outline-index]');
    const target = el ? Number(el.getAttribute('data-outline-index')) : NaN;
    if (!Number.isNaN(target) && target !== i) p.onDragOver();
  };
  return (
    <li
      className="academy-outline-chapter"
      data-outline-index={i}
      data-dragging={p.dragging ? 'true' : undefined}
      data-written={written ? 'true' : undefined}
      onKeyDown={onKeyDown}
      onPointerEnter={() => {
        if (document.querySelector('[data-dragging="true"]')) p.onDragOver();
      }}
    >
      <span
        className="academy-grip"
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={p.onDragEnd}
      >
        <GripVertical />
      </span>
      <input
        id={tickId}
        type="checkbox"
        checked={p.ticked && !written}
        disabled={written}
        onChange={(e) => {
          p.onTick(e.target.checked);
        }}
        aria-label={written ? `${c.title} is written` : `Write ${c.title} now`}
      />
      <div className="academy-outline-body">
        <span className="academy-outline-number">{i + 1}</span>
        <input
          className="academy-outline-title"
          value={title}
          maxLength={80}
          aria-label={`Title of chapter ${String(i + 1)}`}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          onBlur={() => {
            const t = title.trim();
            if (t !== '' && t !== c.title) p.onRename(t);
            else setTitle(c.title);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <p className="quiz-muted">
          {c.goal} · {c.minutes} min{written ? ' · written' : ''}
        </p>
      </div>
      <span className="academy-outline-tools">
        <Button
          variant="ghost"
          aria-label={`Move ${c.title} up`}
          disabled={i === 0}
          onClick={() => {
            p.onMove(i - 1);
          }}
        >
          <ArrowUp aria-hidden />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Move ${c.title} down`}
          disabled={i === p.count - 1}
          onClick={() => {
            p.onMove(i + 1);
          }}
        >
          <ArrowDown aria-hidden />
        </Button>
        <Button
          variant="ghost"
          aria-label={`Remove ${c.title}`}
          disabled={p.count <= 1 || written}
          onClick={p.onRemove}
        >
          <Trash2 aria-hidden />
        </Button>
      </span>
    </li>
  );
}

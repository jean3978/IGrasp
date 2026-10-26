// Hoot's Academy (plan §6.2): the home (profile, cards, library), the options of a new tutorial,
// the confirmation card, and the generations: the outline, the chapters as one staged operation,
// a chapter written again or for a missing topic, and "Suggest more subjects". `start` is the
// only place the Academy spends tokens (`backend.aiStart`), always reached from a confirmation
// card's Start; everything else is local: the cards, the library, the outline edits, reading.

import { create } from 'zustand';
import { backend } from '../ipc/client';
import type {
  AiEventEnvelope,
  AiSizeEstimate,
  AiUserAction,
  Chapter,
  ChapterResult,
  Familiarity,
  Length,
  OutlineResult,
  SuggestResult,
  Tutorial,
  TutorialRef,
  TutorialRequest,
  TutorialReview,
  TutorialSubject,
  TutorialSubjects,
  TutorialSummary,
} from '../ipc/types';
import { errorMessage, useAiProvider } from './aiProvider';
import { useProjectProfile } from './projectProfile';
import { useSettings } from './settings';
import { useToasts } from './toasts';

/**
 * `home` is the hub (the classroom, the tutorials on the blackboard); a new tutorial is a wizard:
 * `create` (the subject), `options`, then `confirm` (the outline's confirmation card).
 */
export type AcademyScreen =
  | 'home'
  | 'role'
  | 'create'
  | 'options'
  | 'confirm'
  | 'generating'
  | 'outline'
  | 'tutorial'
  | 'review';

/** Tool summaries kept for the activity line. */
const ACTIVITY_LINES = 4;

export interface TutorialSetup {
  /** What to learn: a card's title or typed text. */
  subject: string;
  /** The card it came from (`null`: typed). */
  subjectId: string | null;
  /** The pick of a card that needs one (Deep Dive, Trace It). */
  picks: string[];
  familiarity: Familiarity;
  /** "I'm new to …" (empty: none). */
  domainGap: string;
  length: Length;
  /** Who reads it, chosen first (empty: a developer); it ranks the subject cards. */
  role: string;
}

export type GenerationKind = 'outline' | 'chapters' | 'suggest' | 'review';

/** A review ("Check with the AI") of a tutorial, accepted proposal by proposal. */
export interface ReviewState {
  reference: TutorialRef;
  /** The tutorial as it was reviewed. */
  tutorial: Tutorial;
  result: TutorialReview;
}

/** `"<chapter index>:<step index>"`: a proposal of a review. */
export const proposalKey = (chapter: number, step: number) => `${String(chapter)}:${String(step)}`;

/** The tutorial with the accepted proposals' replacements (others left as they were). */
export function withProposals(
  t: Tutorial,
  review: TutorialReview,
  accepted: Set<string>,
): Tutorial {
  const chapters = t.chapters.map((c, ci) => {
    const r = review.chapters.find((x) => x.index === ci);
    if (!r) return c;
    const steps = c.steps.map((step, si) => {
      const p = r.proposals.find((x) => x.step === si);
      return p && accepted.has(proposalKey(ci, si)) ? p.replacement : step;
    });
    return { ...c, steps };
  });
  return { ...t, chapters };
}

export interface PendingConfirm {
  kind: GenerationKind;
  action: AiUserAction;
  request: TutorialRequest;
  /** The card's title: "Write the outline", "Write 3 chapters". */
  title: string;
  estimate: AiSizeEstimate;
  /** The chapters a "write chapters" operation writes (titles). */
  chapters: string[];
}

export interface GenerationProgress {
  kind: GenerationKind;
  startedMs: number;
  activity: string[];
  filesRead: number;
  attempt: { number: number; of: number; reason: string } | null;
  /** The chapter being written (a staged run). */
  stage: { number: number; of: number; label: string } | null;
  /** Chapters accepted in this operation (ids). */
  written: string[];
}

export interface AcademyFailure {
  message: string;
  suggestedSubjects: string[];
}

interface AcademyState {
  screen: AcademyScreen;
  subjects: TutorialSubjects | null;
  library: TutorialSummary[];
  setup: TutorialSetup;
  pending: PendingConfirm | null;
  operationId: number | null;
  /** Between Start and the operation id: its events are buffered. */
  starting: boolean;
  buffered: AiEventEnvelope[];
  generation: GenerationProgress | null;
  failure: AcademyFailure | null;
  /** The tutorial being planned or written (saved privately as it goes). */
  tutorial: Tutorial | null;
  /** The tutorial open in the reader (the course map and the chapters). */
  open: TutorialRef | null;
  /** The review shown on the review screen. */
  review: ReviewState | null;
  /**
   * The Academy tab was just opened (it was not open; `eventBridge` watches the tabs): Hoot
   * welcomes the reader for a moment before the hub shows. Cleared when the welcome ends or is
   * skipped.
   */
  welcome: boolean;

  endWelcome: () => void;
  /** "New tutorial": the wizard's first step, the role (the setup chosen so far is kept). */
  startNew: () => void;
  /** The role chosen: the subject step, its cards ranked for the role. */
  chooseRole: (role: string) => void;
  /** Back from the subject to the role. */
  editRole: () => void;
  /** Back from the options to the subject. */
  editSubject: () => void;
  /** Loads what the home shows: the profile, the cards, the library (all local). */
  openHome: (root: string) => Promise<void>;
  refreshLibrary: () => Promise<void>;
  refreshSubjects: () => Promise<void>;
  setSetup: (patch: Partial<TutorialSetup>) => void;
  /** A subject card (and its pick) chosen: the options screen. */
  chooseCard: (card: TutorialSubject, pick?: string) => void;
  /** Typed text on "What do you want to learn?": the options screen. */
  chooseText: (subject: string) => void;
  backHome: () => void;
  /** Estimates the outline and shows the confirmation card (spends nothing). */
  prepareOutline: () => Promise<void>;
  /** Estimates writing `indices` of the planned tutorial (spends nothing). */
  prepareChapters: (indices: number[]) => Promise<void>;
  /** Estimates writing one chapter again, or a chapter for a missing topic (`goal`). */
  prepareChapter: (tutorialId: string, index: number, goal?: string) => Promise<void>;
  /** Estimates "Find subjects for <the role>" (spends nothing). */
  prepareSuggest: () => Promise<void>;
  /** Estimates "Check with the AI" of a tutorial (spends nothing). */
  prepareReview: (ref: TutorialRef) => Promise<void>;
  /**
   * Applies the accepted proposals: a private tutorial is saved; for a shared one, resolves to
   * the new version, which the caller hands to the write confirmation (nothing written here).
   */
  applyReview: (accepted: string[]) => Promise<Tutorial | null>;
  closeReview: () => void;
  cancelConfirm: () => void;
  /** Start on the confirmation card: the operation it describes (the user action). */
  confirmStart: () => Promise<void>;
  cancel: () => Promise<void>;
  owns: (operationId: number) => boolean;
  onEvent: (envelope: AiEventEnvelope) => void;
  /** Changes the planned outline (order, titles, removed chapters) and saves it. */
  editOutline: (chapters: Chapter[]) => Promise<void>;
  /** Plans a new tutorial from a suggested subject of the outline. */
  startAgain: (subject?: string) => void;
  /** Opens a tutorial in the reader. */
  openTutorial: (ref: TutorialRef) => void;
  /**
   * Opens a shared README from the preview as the board lists it: the private tutorial it is the
   * unchanged shared copy of (not listed on its own), else the shared tutorial.
   */
  openSharedFile: (readme: string) => Promise<void>;
  /** Opens the outline review of a private tutorial that has unwritten chapters. */
  reviewOutline: (id: string) => Promise<void>;
  deleteTutorial: (id: string) => Promise<void>;
  /** Settings → "Forget tutorials": private tutorials, progress and suggestions of the folder. */
  forgetTutorials: () => Promise<boolean>;
  /** Called when a tutorial was saved elsewhere (the reader, a review): refreshes the library. */
  onSaved: (t: Tutorial) => void;
  leaveFolder: () => void;
}

const setupFromSettings = (): TutorialSetup => {
  const learning = useSettings.getState().settings.learning;
  return {
    subject: '',
    subjectId: null,
    picks: [],
    familiarity: learning.tutorialFamiliarity,
    domainGap: '',
    length: learning.tutorialLength,
    role: '',
  };
};

/** Renumbers the chapters positionally (`c1`, `c2`, …), as the shared format stores them. */
export const renumbered = (chapters: Chapter[]): Chapter[] =>
  chapters.map((c, i) => ({ ...c, id: `c${String(i + 1)}` }));

/** A private tutorial planned from an outline (the backend gives it its id and hashes). */
export function tutorialFromOutline(
  outline: OutlineResult,
  setup: TutorialSetup,
  project: string,
  model: string,
): Tutorial {
  const opt = <K extends string>(key: K, value: string | null) =>
    (value !== null && value.trim() !== '' ? { [key]: value.trim() } : {}) as Partial<
      Record<K, string>
    >;
  return {
    id: '',
    title: outline.title,
    intro: outline.intro,
    project,
    subject: setup.subject.trim() || outline.title,
    familiarity: setup.familiarity,
    length: setup.length,
    generated: '',
    provider: '',
    model,
    chapters: outline.chapters,
    sources: [],
    ...opt('domainGap', setup.domainGap),
    ...opt('role', setup.role),
    ...opt('materialNote', outline.materialNote),
    ...opt('docsNote', outline.docsNote),
  };
}

/** `t` with the chapter of `result` written (replacing its outline entry, or added). */
export function withChapter(t: Tutorial, result: ChapterResult): Tutorial {
  const chapters = [...t.chapters];
  const at = chapters.findIndex((c) => c.id === result.chapter.id);
  // A rewritten chapter keeps the questions readers saved on steps it still has.
  const kept = (chapters[at]?.questions ?? []).filter((q) => q.step < result.chapter.steps.length);
  if (at >= 0) chapters[at] = { ...result.chapter, questions: kept };
  else chapters.push(result.chapter);
  const docsNote = t.docsNote ?? result.docsNote ?? undefined;
  return { ...t, chapters, ...(docsNote === undefined ? {} : { docsNote }) };
}

export const useAcademy = create<AcademyState>()((set, get) => {
  /** What the running operation produced so far. */
  let run: {
    kind: GenerationKind;
    model: string | null;
    outline: OutlineResult | null;
    suggest: SuggestResult | null;
    review: TutorialReview | null;
    /** The tutorial a review is about. */
    reviewing: TutorialRef | null;
    error: string | null;
    /** Saves of accepted chapters still in flight (the next one waits for the previous). */
    saving: Promise<void>;
  } | null = null;

  /** Listings of the library asked so far: only the last one's answer is kept. */
  let libraryRequests = 0;

  const notifyError = (what: string, err: unknown) => {
    useToasts.getState().notify('error', `${what}: ${errorMessage(err)}`);
  };

  const estimateOf = (request: TutorialRequest) =>
    backend.aiEstimate({ promptBytes: 0, contextPaths: [], images: 0, tutorial: request });

  const prepare = async (
    kind: GenerationKind,
    action: AiUserAction,
    request: TutorialRequest,
    title: string,
    chapters: string[] = [],
  ) => {
    if (get().operationId !== null || get().starting) return;
    try {
      const estimate = await estimateOf(request);
      set({
        pending: { kind, action, request, title, estimate, chapters },
        screen: 'confirm',
        failure: null,
      });
    } catch (err) {
      set({ failure: { message: errorMessage(err), suggestedSubjects: [] } });
    }
  };

  /** The one call that spends tokens. */
  const start = async (pending: PendingConfirm) => {
    if (get().operationId !== null || get().starting) return;
    run = {
      kind: pending.kind,
      model: null,
      outline: null,
      suggest: null,
      review: null,
      reviewing: pending.request.kind === 'review' ? pending.request.tutorial : null,
      error: null,
      saving: Promise.resolve(),
    };
    set({
      screen: pending.kind === 'suggest' ? 'create' : 'generating',
      starting: true,
      buffered: [],
      failure: null,
      pending: null,
      generation: {
        kind: pending.kind,
        startedMs: Date.now(),
        activity: [],
        filesRead: 0,
        attempt: null,
        stage: null,
        written: [],
      },
    });
    const model = useAiProvider.getState().model;
    try {
      const operationId = await backend.aiStart(pending.action, {
        prompt: '',
        contextPaths: [],
        images: [],
        policy: 'readOnly',
        tutorial: pending.request,
        ...(model ? { model } : {}),
      });
      const buffered = get().buffered;
      set({ operationId, starting: false, buffered: [] });
      for (const e of buffered) if (e.operationId === operationId) get().onEvent(e);
    } catch (err) {
      run = null;
      set({
        starting: false,
        buffered: [],
        generation: null,
        screen:
          pending.kind === 'review'
            ? 'tutorial'
            : pending.kind === 'chapters' && get().tutorial
              ? 'outline'
              : 'create',
        failure: { message: errorMessage(err), suggestedSubjects: [] },
      });
    }
  };

  /** Saves a private tutorial and keeps the store, the library and the reader in step. */
  const save = async (t: Tutorial): Promise<Tutorial> => {
    const stored = await backend.saveTutorial(t);
    get().onSaved(stored.tutorial);
    return stored.tutorial;
  };

  /** An accepted outline: saved privately at once, then reviewed. */
  const applyOutline = async (outline: OutlineResult, model: string | null) => {
    if (outline.chapters.length === 0) {
      set({
        screen: 'create',
        failure: {
          message:
            outline.materialNote ?? 'Hoot found nothing in this project to build that tutorial on.',
          suggestedSubjects: outline.suggestedSubjects,
        },
      });
      return;
    }
    const project = useProjectProfile.getState().profile?.name ?? 'project';
    const planned = tutorialFromOutline(
      outline,
      get().setup,
      project,
      model ?? useAiProvider.getState().model,
    );
    try {
      const saved = await save(planned);
      set({ tutorial: saved, screen: 'outline' });
    } catch (err) {
      set({ screen: 'create', failure: { message: errorMessage(err), suggestedSubjects: [] } });
    }
  };

  /** An accepted chapter: merged and saved at once, so it can be read while the next one is written. */
  const applyChapter = (result: ChapterResult) => {
    const r = run;
    if (!r) return;
    r.saving = r.saving.then(async () => {
      const t = get().tutorial;
      if (!t) return;
      try {
        await save(withChapter(t, result));
      } catch (err) {
        notifyError('Cannot save the chapter', err);
      }
    });
    const generation = get().generation;
    if (generation)
      set({ generation: { ...generation, written: [...generation.written, result.chapter.id] } });
  };

  const applySuggestions = async (result: SuggestResult) => {
    try {
      await backend.saveSuggestedSubjects(result.subjects);
      await get().refreshSubjects();
      useToasts
        .getState()
        .notify(
          'info',
          result.subjects.length === 1
            ? 'Hoot suggested 1 more subject.'
            : `Hoot suggested ${String(result.subjects.length)} more subjects.`,
        );
    } catch (err) {
      notifyError('Cannot keep the suggestions', err);
    }
  };

  /** An accepted review: the tutorial as reviewed, then the review screen. */
  const showReview = async (reference: TutorialRef, result: TutorialReview) => {
    try {
      const tutorial = await backend.getTutorial(reference);
      set({ review: { reference, tutorial, result }, screen: 'review', generation: null });
    } catch (err) {
      set({
        generation: null,
        screen: 'home',
        failure: { message: errorMessage(err), suggestedSubjects: [] },
      });
    }
  };

  return {
    screen: 'home',
    subjects: null,
    library: [],
    setup: setupFromSettings(),
    pending: null,
    operationId: null,
    starting: false,
    buffered: [],
    generation: null,
    failure: null,
    tutorial: null,
    open: null,
    review: null,
    welcome: false,

    endWelcome() {
      if (get().welcome) set({ welcome: false });
    },

    startNew() {
      if (get().operationId !== null || get().starting) return;
      set({ screen: 'role', failure: null, pending: null, open: null });
    },

    chooseRole(role) {
      const text = role.trim();
      if (text === '') return;
      set((s) => ({ screen: 'create', failure: null, setup: { ...s.setup, role: text } }));
    },

    editRole() {
      set({ screen: 'role', failure: null });
    },

    editSubject() {
      set({ screen: 'create', failure: null, pending: null });
    },

    async openHome(root) {
      await useProjectProfile.getState().load(root);
      await Promise.all([get().refreshSubjects(), get().refreshLibrary()]);
    },

    async refreshLibrary() {
      // The latest listing wins: an older one answering late (before the graph was ready, so
      // without the shared tutorials) must not overwrite it.
      const asked = ++libraryRequests;
      try {
        const library = await backend.listTutorials();
        if (asked === libraryRequests) set({ library });
      } catch {
        if (asked === libraryRequests) set({ library: [] });
      }
    },

    async refreshSubjects() {
      try {
        set({ subjects: await backend.listTutorialSubjects() });
      } catch (err) {
        set({ subjects: { cards: [], domains: [], tooThin: false } });
        notifyError('Cannot list the subjects', err);
      }
    },

    setSetup(patch) {
      set((s) => ({ setup: { ...s.setup, ...patch } }));
    },

    chooseCard(card, pick) {
      set((s) => ({
        screen: 'options',
        failure: null,
        setup: {
          ...s.setup,
          subject: pick ? `${card.title}: ${pick}` : card.title,
          subjectId: card.id,
          picks: pick ? [pick] : [],
          domainGap: card.domain ?? s.setup.domainGap,
        },
      }));
    },

    chooseText(subject) {
      const text = subject.trim();
      if (text === '') return;
      set((s) => ({
        screen: 'options',
        failure: null,
        setup: { ...s.setup, subject: text, subjectId: null, picks: [] },
      }));
    },

    backHome() {
      if (get().operationId !== null || get().starting) return;
      set({ screen: 'home', pending: null, open: null });
      void get().refreshLibrary();
    },

    async prepareOutline() {
      const { setup } = get();
      if (setup.subject.trim() === '') return;
      await prepare(
        'outline',
        'tutorialGeneration',
        {
          kind: 'outline',
          input: {
            subject: setup.subject.trim(),
            subjectId: setup.subjectId,
            picks: setup.picks,
            familiarity: setup.familiarity,
            domainGap: setup.domainGap.trim() || null,
            length: setup.length,
            role: setup.role.trim() || null,
          },
        },
        'Write the outline of a tutorial',
      );
    },

    async prepareChapters(indices) {
      const t = get().tutorial;
      if (!t || indices.length === 0) return;
      const titles = indices.map((i) => t.chapters[i]?.title ?? '');
      await prepare(
        'chapters',
        'tutorialGeneration',
        { kind: 'chapters', id: t.id, indices },
        indices.length === 1 ? 'Write 1 chapter' : `Write ${String(indices.length)} chapters`,
        titles,
      );
    },

    async prepareChapter(tutorialId, index, goal) {
      try {
        const t = await backend.getTutorial({ type: 'private', id: tutorialId });
        set({ tutorial: t });
        await prepare(
          'chapters',
          'tutorialGeneration',
          { kind: 'chapter', id: tutorialId, index, goal: goal ?? null },
          goal ? 'Write a chapter for a missing topic' : 'Rewrite this chapter',
          [goal ?? t.chapters[index]?.title ?? ''],
        );
      } catch (err) {
        notifyError('Cannot prepare the chapter', err);
      }
    },

    async prepareSuggest() {
      // For the role of the wizard's first step (a developer when none was chosen).
      const role = get().setup.role.trim();
      await prepare(
        'suggest',
        'subjectSuggestion',
        role ? { kind: 'suggest', role } : { kind: 'suggest' },
        role ? `Find subjects for ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}` : 'Find subjects',
      );
    },

    async prepareReview(ref) {
      await prepare(
        'review',
        'tutorialReview',
        { kind: 'review', tutorial: ref },
        'Check this tutorial',
      );
    },

    async applyReview(accepted) {
      const review = get().review;
      if (!review) return null;
      const next = withProposals(review.tutorial, review.result, new Set(accepted));
      const ref = review.reference;
      if (ref.type === 'shared') {
        set({ review: null, screen: 'tutorial', open: ref });
        return accepted.length > 0 ? next : null;
      }
      try {
        if (accepted.length > 0) await save(next);
        set({ review: null, screen: 'tutorial', open: ref });
      } catch (err) {
        notifyError('Cannot save the accepted changes', err);
      }
      return null;
    },

    closeReview() {
      const review = get().review;
      set({
        review: null,
        screen: review ? 'tutorial' : 'home',
        open: review?.reference ?? get().open,
      });
    },

    cancelConfirm() {
      const pending = get().pending;
      set({
        pending: null,
        screen:
          pending?.kind === 'outline'
            ? 'options'
            : pending?.kind === 'chapters' && get().open === null
              ? 'outline'
              : pending?.kind === 'chapters' || pending?.kind === 'review'
                ? 'tutorial'
                : pending?.kind === 'suggest'
                  ? 'create'
                  : 'home',
      });
    },

    async confirmStart() {
      const pending = get().pending;
      if (pending) await start(pending);
    },

    async cancel() {
      const { operationId } = get();
      if (operationId === null) return;
      try {
        await backend.aiCancel(operationId);
      } catch (err) {
        notifyError('Cannot stop the generation', err);
      }
    },

    owns(operationId) {
      const s = get();
      return s.operationId === operationId || (s.starting && s.operationId === null);
    },

    onEvent(envelope) {
      const s = get();
      if (envelope.operationId !== s.operationId) {
        if (s.starting) set({ buffered: [...s.buffered, envelope] });
        return;
      }
      const r = run;
      const generation = s.generation;
      if (!r || !generation) return;
      const { event } = envelope;
      switch (event.type) {
        case 'session':
          if (event.model) r.model = event.model;
          return;
        case 'toolUse':
          set({
            generation: {
              ...generation,
              activity: [...generation.activity, event.summary].slice(-ACTIVITY_LINES),
              filesRead: generation.filesRead + (/^(?:read|view|open)/i.test(event.tool) ? 1 : 0),
            },
          });
          return;
        case 'attempt':
          set({
            generation: {
              ...generation,
              attempt: { number: event.number, of: event.of, reason: event.reason },
            },
          });
          return;
        case 'stage':
          set({
            generation: {
              ...generation,
              attempt: null,
              stage: { number: event.number, of: event.of, label: event.label },
            },
          });
          return;
        case 'structuredOutput':
          if (r.kind === 'outline') r.outline = event.value as unknown as OutlineResult;
          else if (r.kind === 'suggest') r.suggest = event.value as unknown as SuggestResult;
          else if (r.kind === 'review') r.review = event.value as unknown as TutorialReview;
          else applyChapter(event.value as unknown as ChapterResult);
          return;
        case 'error':
          r.error = event.message;
          return;
        case 'done': {
          set({ operationId: null });
          run = null;
          const failure =
            event.outcome === 'Completed'
              ? null
              : event.outcome === 'Cancelled'
                ? null
                : {
                    message: r.error ?? event.detail ?? 'The generation failed.',
                    suggestedSubjects: r.outline?.suggestedSubjects ?? [],
                  };
          if (r.kind === 'outline') {
            set({ generation: null });
            if (event.outcome === 'Completed' && r.outline) void applyOutline(r.outline, r.model);
            else set({ screen: 'options', failure });
          } else if (r.kind === 'review') {
            if (event.outcome === 'Completed' && r.review && r.reviewing)
              void showReview(r.reviewing, r.review);
            else set({ generation: null, screen: 'tutorial', failure });
          } else if (r.kind === 'suggest') {
            set({ generation: null });
            if (event.outcome === 'Completed' && r.suggest) void applySuggestions(r.suggest);
            else if (failure) set({ failure });
          } else {
            // The chapters accepted so far are saved; the reader shows them.
            void r.saving.then(() => {
              const t = get().tutorial;
              set({ generation: null, failure });
              if (t && get().screen === 'generating')
                get().openTutorial({ type: 'private', id: t.id });
            });
          }
          return;
        }
        default:
          return;
      }
    },

    async editOutline(chapters) {
      const t = get().tutorial;
      if (!t) return;
      try {
        await save({ ...t, chapters: renumbered(chapters) });
      } catch (err) {
        notifyError('Cannot save the outline', err);
      }
    },

    startAgain(subject) {
      if (get().operationId !== null) return;
      if (subject) get().chooseText(subject);
      else set({ screen: 'create', tutorial: null });
    },

    openTutorial(ref) {
      set({ open: ref, screen: 'tutorial', failure: get().failure, pending: null });
    },

    async openSharedFile(readme) {
      await get().refreshLibrary();
      const { library } = get();
      const listed = library.some(
        (s) => s.reference.type === 'shared' && s.reference.relPath === readme,
      );
      const own = listed
        ? undefined
        : library.find((s) => s.reference.type === 'private' && s.sharedAs === readme);
      get().openTutorial(own?.reference ?? { type: 'shared', relPath: readme });
    },

    async reviewOutline(id) {
      try {
        const t = await backend.getTutorial({ type: 'private', id });
        set({ tutorial: t, screen: 'outline', open: null });
      } catch (err) {
        notifyError('Cannot open the outline', err);
      }
    },

    async forgetTutorials() {
      try {
        await backend.forgetTutorials();
        set({ tutorial: null, review: null, open: null, screen: 'home' });
        await Promise.all([get().refreshLibrary(), get().refreshSubjects()]);
        return true;
      } catch (err) {
        notifyError('Cannot forget the tutorials', err);
        return false;
      }
    },

    async deleteTutorial(id) {
      try {
        await backend.deleteTutorial(id);
        set((s) => ({
          tutorial: s.tutorial?.id === id ? null : s.tutorial,
          open: s.open?.type === 'private' && s.open.id === id ? null : s.open,
        }));
        await get().refreshLibrary();
      } catch (err) {
        notifyError('Cannot delete the tutorial', err);
      }
    },

    onSaved(t) {
      if (get().tutorial?.id === t.id || get().tutorial?.id === '') set({ tutorial: t });
      void get().refreshLibrary();
      listeners.forEach((l) => {
        l(t);
      });
    },

    leaveFolder() {
      const { operationId } = get();
      if (operationId !== null) void backend.aiCancel(operationId).catch(() => undefined);
      run = null;
      set({
        review: null,
        screen: 'home',
        subjects: null,
        library: [],
        setup: setupFromSettings(),
        pending: null,
        operationId: null,
        starting: false,
        buffered: [],
        generation: null,
        failure: null,
        tutorial: null,
        open: null,
      });
    },
  };
});

/** Listeners of saved tutorials (the reader refreshes the tutorial it shows). */
const listeners = new Set<(t: Tutorial) => void>();
export function onTutorialSaved(l: (t: Tutorial) => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const selectAcademyBusy = (s: AcademyState) => s.operationId !== null || s.starting;

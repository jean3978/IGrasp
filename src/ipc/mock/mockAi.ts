// The mock AI provider: a scripted stand-in behind the same provider-neutral events the Rust
// gateway emits. It powers the browser dev mode and the tests, and keeps the abstraction honest
// as a second implementation. Words of the prompt pick the script (with the fixture project):
//
// - `edit README.md`: one `Edit` hunk (kind `markdownEdit`); any mentioned markdown file of the
//   fixture gets the same single-hunk edit;
// - `edit twice README.md`: `MultiEdit` with two hunks in different paragraphs;
// - `rewrite README.md`: `Write` of a new whole content changing three blocks;
// - `create notes/new.md`: `Write` of a file that does not exist;
// - `edit src/main.ts`: an edit of a code file (kind `fileEdit`);
// - `command`: runs a shell command (kind `command`); `fetch`: fetches a URL (kind `web`);
// - `image`: acknowledges the attached images with their byte size;
// - `slow`: ten deltas over two seconds; `crash`: the provider stops without finishing;
// - a resume id the mock never issued: the "No conversation found" error;
// - anything else: a streamed text answer.

import { BackendError } from '../types';
import { collectContext, contextDocuments, estimateSize, requestFrom } from './mockContext';
import type { FileLookup } from './mockContext';
import { summaryOf, upsert } from './mockConversations';
import {
  MOCK_MAX_RETRIES,
  MOCK_QUIZ_SCHEMA,
  MockQuizValidator,
  composeMockQuiz,
  jsonOfText,
  scriptedAnswer,
} from './mockQuiz';
import type { MockQuizComposed, MockQuizScript } from './mockQuiz';
import {
  MOCK_TUTORIAL_RULES_BYTES,
  MOCK_TUTORIAL_SCHEMA,
  MockChapterValidator,
  MockOutlineValidator,
  MockSuggestValidator,
  composeMockChapters,
  composeMockSuggest,
  scriptedSuggest,
  composeMockOutline,
  costHint,
  scriptedChapter,
  scriptedOutline,
} from './mockTutorial';
import type {
  MockChapterStage,
  MockOutlineComposed,
  MockSuggestComposed,
  MockTutorialScript,
  MockVerdict,
} from './mockTutorial';
import type {
  AiCapabilities,
  AiEvent,
  AiEventEnvelope,
  AiOutcome,
  AiPermissionKind,
  AiPermissionSettings,
  AiModel,
  AiPolicy,
  AiProviderInfo,
  AiProviderStatus,
  AiContextDocument,
  AiEstimateInput,
  AiRequest,
  AiSizeEstimate,
  AiStartRequest,
  AiUserAction,
  BackendEvents,
  Conversation,
  ConversationSummary,
  EditHunk,
  EventName,
  JsonValue,
  PermissionDecision,
  ProposedEdit,
  ProjectProfile,
  QuizGenerationInput,
  Subject,
  Settings,
  ChapterResult,
  Length,
  Tutorial,
  TutorialRequest,
  TutorialSubject,
  TutorialUsage,
} from '../types';

export interface MockAiState {
  installed: boolean;
  loggedIn: boolean;
  /** Delay between the scripted events, in milliseconds. */
  stepMs: number;
  /** Operations started so far, with the user action that started each. */
  starts: AiUserAction[];
  /** The request the provider received last (context with contents, capture, images). */
  lastRequest: AiRequest | null;
  /** Status checks that ran the provider's probes (not served from the cache). */
  statusChecks: number;
  /** Saved conversations by root path, newest first (the app's history copy). */
  conversations: Map<string, Conversation[]>;
  /** What the mock AI answers to a quiz generation (`mockQuiz.ts`). */
  quizScript: MockQuizScript;
  /** What the mock AI answers to a tutorial outline or chapter (`mockTutorial.ts`). */
  tutorialScript: MockTutorialScript;
}

export const DEFAULT_MOCK_AI: MockAiState = {
  installed: true,
  loggedIn: true,
  stepMs: 30,
  starts: [],
  lastRequest: null,
  statusChecks: 0,
  conversations: new Map(),
  quizScript: 'valid',
  tutorialScript: 'valid',
};

export const MOCK_PROVIDER_ID = 'mock';
/** Like the Rust gateway: a status check is reused for a minute unless forced. */
export const MOCK_STATUS_CACHE_MS = 60_000;
/** The mock's models; the last one does not accept images. */
export const MOCK_MODELS: AiModel[] = [
  {
    id: 'mock-fast',
    label: 'Mock Fast (default)',
    description: 'Quick answers',
    imageInput: true,
  },
  { id: 'mock-smart', label: 'Mock Smart', description: 'Careful answers', imageInput: true },
  { id: 'mock-text', label: 'Mock Text (no images)', description: null, imageInput: false },
];
/** The instruction files the mock provider declares. */
export const MOCK_CONTEXT_FILE_NAMES = ['AGENTS.md'];
export const MOCK_PROVIDER_NAME = 'Mock AI';
export const MOCK_PROVIDER_VERSION = '1.0-mock';
export const MOCK_NOT_INSTALLED = 'The Mock AI command was not found.';
export const MOCK_NOT_INSTALLED_HELP =
  'Install Mock AI and make sure `mock-ai` runs in a terminal.';
export const MOCK_NOT_LOGGED_IN = 'You are not logged in to Mock AI.';
export const MOCK_NOT_LOGGED_IN_HELP = 'Run `mock-ai login` in a terminal, then check again.';
export const MOCK_LATE_LOGIN_ERROR = 'Not logged in · Please log in again';
export const MOCK_REJECTED_TEXT = 'Understood, I left the file unchanged.';
export const MOCK_APPLIED_TEXT = 'Done.';
export const MOCK_CRASH_DETAIL = 'exit code 3\nThe mock provider crashed.';
export const MOCK_NO_CONVERSATION = 'No conversation found with session ID:';
export const MOCK_EDIT_SUFFIX = ' (edited by the AI)';
export const MOCK_NEW_FILE_CONTENT = '# New note\n\nWritten by the AI on request.\n';
/** What the model is told when the user rejects a tool call (same as Rust). */
export const MOCK_REJECTED_BY_USER = 'The user rejected this in IGrasp.';
/** Delay between the deltas of the `slow` script: ten of them take two seconds. */
export const MOCK_SLOW_STEP_MS = 200;
/** Delay between the file reads of the `slow` quiz script. */
export const MOCK_QUIZ_SLOW_STEP_MS = 1000;
/** Bytes of the fixed blocks of the real quiz prompt (audience, rules, voice), for estimates. */
export const MOCK_QUIZ_RULES_BYTES = 9000;
// The gateway's policy texts, the same as in Rust (`ai/policy.rs`).
export const DENIED_BY_SETTINGS = "Denied by the user's IGrasp settings.";
export const DENIED_READ_ONLY =
  'This is a read-only operation: IGrasp does not allow changing files, running commands or browsing during it.';
export const REASON_ALLOWED_BY_SETTINGS = 'allowed by your settings';
export const REASON_DENIED_BY_SETTINGS = 'denied by your settings';
export const REASON_READ_ONLY = 'read-only operation';

type Emit = <E extends EventName>(event: E, payload: BackendEvents[E]) => void;

interface Deps {
  emit: Emit;
  ai: () => MockAiState;
  settings: () => Settings;
  /** The open folder's path, or null. */
  rootPath: () => string | null;
  /** A file of the fake disk with its size. */
  file: FileLookup;
  fileContent: (relPath: string) => string | undefined;
  writeFiles: (files: Record<string, string>) => void;
  /** Every file of the fake disk (the quiz corpus). */
  files: () => Map<string, string>;
  /** The project profile and the subjects of the open folder (`mockProfile`, `mockSubjects`). */
  profile: () => ProjectProfile;
  subjects: () => Subject[];
  /** A private tutorial of the open folder, and the Academy's cards (`mockTutorialStore`). */
  tutorial: (id: string) => Tutorial | undefined;
  tutorialCards: () => TutorialSubject[];
  tutorialUsage: () => TutorialUsage[];
  recordUsage: (usage: TutorialUsage) => void;
}

/** Like the Rust gateway: a markdown edit is reviewed only with its edit, inside the folder. */
function effectiveKind(kind: AiPermissionKind, edit: ProposedEdit | null): AiPermissionKind {
  if (kind !== 'markdownEdit') return kind;
  const inside =
    edit !== null &&
    edit.isMarkdown &&
    !/^\/|\\|:/.test(edit.path) &&
    edit.path.split('/').every((s) => s !== '' && s !== '.' && s !== '..');
  return inside ? kind : 'other';
}

const RULE_OF: Record<AiPermissionKind, keyof AiPermissionSettings> = {
  markdownEdit: 'markdownEdits',
  fileEdit: 'fileEdits',
  command: 'commands',
  web: 'web',
  other: 'other',
};

/** Like the Rust gateway: the answer given without asking, or null when the user must answer. */
function answerAutomatically(
  policy: AiPolicy,
  kind: AiPermissionKind,
  permissions: AiPermissionSettings,
): { decision: PermissionDecision; reason: string } | null {
  if (policy === 'readOnly') {
    return { decision: { behavior: 'deny', message: DENIED_READ_ONLY }, reason: REASON_READ_ONLY };
  }
  switch (permissions[RULE_OF[kind]]) {
    case 'ask':
      return null;
    case 'allow':
      return {
        decision: { behavior: 'allow', updatedEdit: null },
        reason: REASON_ALLOWED_BY_SETTINGS,
      };
    case 'deny':
      return {
        decision: { behavior: 'deny', message: DENIED_BY_SETTINGS },
        reason: REASON_DENIED_BY_SETTINGS,
      };
  }
}

/** A step of the script; returning `'wait'` pauses it until the permission is answered. */
type Step = ((op: ScriptedOperation) => unknown) & { delayMs?: number };

/** A step that runs `delayMs` after the previous one instead of the usual step delay. */
const after = (delayMs: number, step: (op: ScriptedOperation) => unknown): Step =>
  Object.assign(step, { delayMs });

/** Runs the steps of one operation with a delay between them. */
class ScriptedOperation {
  private steps: Step[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiting: {
    requestId: string;
    onDecision: (decision: PermissionDecision) => void;
  } | null = null;
  done = false;

  constructor(
    readonly id: number,
    readonly resumeId: string,
    private readonly stepMs: () => number,
    readonly policy: AiPolicy,
    /** The permission settings when the operation started (a later change does not apply). */
    readonly permissions: AiPermissionSettings,
  ) {}

  start(steps: Step[]) {
    this.steps = steps;
    this.schedule();
  }

  /** Adds steps after the current ones (a validated run's next attempt). */
  extend(steps: Step[]) {
    this.steps.push(...steps);
  }

  private readonly next = () => {
    this.timer = null;
    if (this.done) return;
    const step = this.steps.shift();
    if (!step) return;
    if (step(this) === 'wait') return;
    this.schedule();
  };

  private schedule() {
    if (this.done) return;
    this.timer = setTimeout(this.next, this.steps[0]?.delayMs ?? this.stepMs());
  }

  wait(requestId: string, onDecision: (decision: PermissionDecision) => void) {
    this.waiting = { requestId, onDecision };
  }

  /** Answers the pending permission request and resumes the script. */
  answer(requestId: string, decision: PermissionDecision): boolean {
    if (!this.waiting || this.waiting.requestId !== requestId) return false;
    const { onDecision } = this.waiting;
    this.waiting = null;
    onDecision(decision);
    this.schedule();
    return true;
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = null;
    this.done = true;
  }
}

const isMarkdownPath = (path: string) => /\.(?:md|markdown)$/i.test(path);

/** The kind the Rust provider gives a file tool on a path inside the folder. */
const editKind = (path: string): AiPermissionKind =>
  isMarkdownPath(path) ? 'markdownEdit' : 'fileEdit';

/** Bytes of a base64 payload. */
function base64Bytes(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

/** Applies hunks like the provider's tools: each replaces the first occurrence of its text. */
function applyHunks(content: string, hunks: EditHunk[]): string {
  return hunks.reduce((text, h) => text.replace(h.oldText, h.newText), content);
}

/**
 * The hunks an answer lets the tool apply, like the Rust provider maps them: the proposed edit
 * when accepted as is, the accepted subset (which must come from the proposal for a
 * multi-hunk edit), or null when nothing can be applied (treated as a rejection).
 */
function acceptedHunks(proposed: ProposedEdit, decision: PermissionDecision): EditHunk[] | null {
  if (decision.behavior !== 'allow') return null;
  const updated = decision.updatedEdit;
  if (updated === null) return proposed.hunks;
  if (updated.hunks.length === 0) return null;
  if (proposed.wholeFile || proposed.hunks.length === 1) {
    return updated.hunks.length === 1 ? updated.hunks : null;
  }
  const left = [...proposed.hunks];
  for (const h of updated.hunks) {
    const at = left.findIndex((p) => p.oldText === h.oldText && p.newText === h.newText);
    if (at < 0) return null;
    left.splice(at, 1);
  }
  return proposed.hunks.filter((p) => !left.includes(p));
}

export function createMockAi({
  emit,
  ai,
  settings,
  rootPath,
  file,
  fileContent,
  writeFiles,
  files,
  profile,
  subjects,
  tutorial,
  tutorialCards,
  tutorialUsage,
  recordUsage,
}: Deps) {
  let nextId = 0;
  let sessions = 0;
  let counter = 0;
  let running: ScriptedOperation | null = null;
  /** Resume ids this mock issued: resuming any other fails like a lost provider session. */
  const issued = new Set<string>();
  const uid = (prefix: string) => `${prefix}_${String(++counter).padStart(4, '0')}`;

  const requireRoot = (): string => {
    const root = rootPath();
    if (root === null) throw new BackendError('NoRootOpen', 'No folder is open.');
    return root;
  };
  const conversationsOf = (root: string) => ai().conversations.get(root) ?? [];

  const send = (op: ScriptedOperation, event: AiEvent) => {
    const envelope: AiEventEnvelope = { operationId: op.id, event };
    emit('ai://event', envelope);
  };

  const end = (op: ScriptedOperation, outcome: AiOutcome, detail: string | null) => {
    if (running !== op) return;
    op.stop();
    running = null;
    send(op, { type: 'done', outcome, detail });
  };

  /** A streamed text answer: two deltas, then the complete text. */
  const text = (content: () => string): Step[] => [
    (op) => {
      const full = content();
      send(op, { type: 'textDelta', text: full.slice(0, Math.ceil(full.length / 2)) });
    },
    (op) => {
      const full = content();
      send(op, { type: 'textDelta', text: full.slice(Math.ceil(full.length / 2)) });
    },
    (op) => {
      send(op, { type: 'text', text: content() });
    },
  ];

  const finish =
    (isError: boolean): Step =>
    (op) => {
      send(op, {
        type: 'usage',
        inputTokens: isError ? 0 : 1200,
        outputTokens: isError ? 0 : 80,
        costUsd: isError ? null : 0.0031,
        durationMs: isError ? 0 : 4200,
      });
      end(op, 'Completed', isError ? 'exit code 1' : null);
    };

  interface ToolCall {
    tool: string;
    kind: AiPermissionKind;
    input: Record<string, JsonValue>;
    description: string;
    proposedEdit: ProposedEdit | null;
    /** Runs the tool once allowed and returns its result, or null to refuse the answer. */
    run: (decision: PermissionDecision) => string | null;
  }

  /** A tool call that needs a permission: the request, then the tool's result. */
  const permission = (call: ToolCall): Step[] => {
    const toolId = uid('tool');
    const summary = `${call.tool} ${call.description}`;
    return [
      (op) => {
        send(op, { type: 'toolUse', toolId, tool: call.tool, summary, input: call.input });
      },
      (op) => {
        const requestId = uid('req');
        const onDecision = (decision: PermissionDecision) => {
          const result = decision.behavior === 'allow' ? call.run(decision) : null;
          send(op, {
            type: 'toolResult',
            toolId,
            content:
              result ?? (decision.behavior === 'deny' ? decision.message : MOCK_REJECTED_BY_USER),
            isError: result === null,
          });
        };
        // The gateway's policy step, like Rust: some requests never reach the user.
        const kind = effectiveKind(call.kind, call.proposedEdit);
        const automatic = answerAutomatically(op.policy, kind, op.permissions);
        if (automatic) {
          send(op, {
            type: 'permissionDecided',
            tool: call.tool,
            kind,
            description: call.description,
            allowed: automatic.decision.behavior === 'allow',
            reason: automatic.reason,
          });
          onDecision(automatic.decision);
          return undefined;
        }
        op.wait(requestId, onDecision);
        send(op, {
          type: 'permissionRequest',
          requestId,
          tool: call.tool,
          kind,
          description: call.description,
          input: call.input,
          proposedEdit: call.proposedEdit,
        });
        return 'wait';
      },
    ];
  };

  /** A file edit proposed by the AI; `applied` tells the closing text what happened. */
  const fileEdit = (
    tool: 'Edit' | 'MultiEdit' | 'Write',
    path: string,
    before: string | undefined,
    edit: Omit<ProposedEdit, 'path' | 'isMarkdown'>,
    input: Record<string, JsonValue>,
  ): Step[] => {
    let applied = false;
    const proposedEdit: ProposedEdit = { path, isMarkdown: isMarkdownPath(path), ...edit };
    return [
      ...text(() => `I'll update ${path} as asked.`),
      ...permission({
        tool,
        kind: editKind(path),
        input: { file_path: `/mock/${path}`, ...input },
        description: path,
        proposedEdit,
        run: (decision) => {
          const hunks = acceptedHunks(proposedEdit, decision);
          if (hunks === null) return null;
          const next = edit.wholeFile ? (hunks[0]?.newText ?? '') : applyHunks(before ?? '', hunks);
          applied = true;
          writeFiles({ [path]: next });
          return `The file ${path} has been updated successfully.`;
        },
      }),
      ...text(() => (applied ? MOCK_APPLIED_TEXT : MOCK_REJECTED_TEXT)),
    ];
  };

  const singleEdit = (path: string, content: string): Step[] => {
    const firstLine = content.split('\n')[0] ?? '';
    const edited = `${firstLine}${MOCK_EDIT_SUFFIX}`;
    return fileEdit(
      'Edit',
      path,
      content,
      { wholeFile: false, hunks: [{ oldText: firstLine, newText: edited }] },
      { old_string: firstLine, new_string: edited },
    );
  };

  /** Two hunks in different paragraphs: the first and the last plain paragraph lines. */
  const twoEdits = (path: string, content: string): Step[] => {
    const plain = content.split('\n').filter((l) => /^[A-Za-z]/.test(l));
    const lines = [plain[0] ?? '', plain[plain.length - 1] ?? ''];
    const hunks = lines.map((l) => ({ oldText: l, newText: `${l}${MOCK_EDIT_SUFFIX}` }));
    return fileEdit(
      'MultiEdit',
      path,
      content,
      { wholeFile: false, hunks },
      { edits: hunks.map((h) => ({ old_string: h.oldText, new_string: h.newText })) },
    );
  };

  /** A whole new content changing three blocks: the title, a paragraph, and a new ending. */
  const rewrite = (path: string, content: string): Step[] => {
    const lines = content.split('\n');
    const title = lines.findIndex((l) => l.startsWith('#'));
    const paragraph = lines.findIndex((l) => /^[A-Za-z]/.test(l));
    const next = lines.map((l, i) =>
      i === title ? `${l} (rewritten)` : i === paragraph ? 'A paragraph rewritten by the AI.' : l,
    );
    const whole = `${next.join('\n').trimEnd()}\n\nA closing paragraph added by the AI.\n`;
    return fileEdit(
      'Write',
      path,
      content,
      { wholeFile: true, hunks: [{ oldText: '', newText: whole }] },
      { content: whole },
    );
  };

  const create = (path: string): Step[] =>
    fileEdit(
      'Write',
      path,
      undefined,
      { wholeFile: true, hunks: [{ oldText: '', newText: MOCK_NEW_FILE_CONTENT }] },
      { content: MOCK_NEW_FILE_CONTENT },
    );

  const shell = (): Step[] => [
    ...permission({
      tool: 'Bash',
      kind: 'command',
      input: { command: 'git log --oneline -5' },
      description: 'git log --oneline -5',
      proposedEdit: null,
      run: () => '52b0b8e Merge branch phase-2-navigation',
    }),
    ...text(() => 'Here is what I found.'),
  ];

  const fetch = (): Step[] => [
    ...permission({
      tool: 'WebFetch',
      kind: 'web',
      input: { url: 'https://example.com/' },
      description: 'https://example.com/',
      proposedEdit: null,
      run: () => 'Example Domain',
    }),
    ...text(() => 'The page says "Example Domain".'),
  ];

  /** The script of a logged-in provider for `request`. */
  const steps = (request: AiRequest): Step[] => {
    const prompt = request.prompt;
    const word = (w: string) => new RegExp(`\\b${w}\\b`, 'i').test(prompt);
    const target = (verb: string) =>
      new RegExp(`\\b${verb}\\s+([\\w./-]+\\.\\w+)`, 'i').exec(prompt)?.[1];

    if (word('slow')) {
      const words = 'This answer takes its time to arrive, word by word.'.split(' ');
      return [
        ...words.map((w, i) =>
          after(MOCK_SLOW_STEP_MS, (op) => {
            send(op, { type: 'textDelta', text: i === 0 ? w : ` ${w}` });
          }),
        ),
        (op) => {
          send(op, { type: 'text', text: words.join(' ') });
        },
        finish(false),
      ];
    }
    if (word('crash')) {
      return [
        (op) => {
          send(op, { type: 'textDelta', text: 'Let me look' });
        },
        (op) => {
          end(op, 'Failed', MOCK_CRASH_DETAIL);
        },
      ];
    }
    if (word('image')) {
      const bytes = request.images.reduce((n, img) => n + base64Bytes(img.dataBase64), 0);
      const n = request.images.length;
      return [
        ...text(() =>
          n === 0
            ? 'There is no image attached.'
            : `I see ${String(n)} attached image${n === 1 ? '' : 's'} (${String(bytes)} bytes).`,
        ),
        finish(false),
      ];
    }
    const created = target('create');
    if (created !== undefined && fileContent(created) === undefined) {
      return [...create(created), finish(false)];
    }
    const rewritten = target('rewrite');
    const rewrittenContent = rewritten === undefined ? undefined : fileContent(rewritten);
    if (rewritten !== undefined && rewrittenContent !== undefined) {
      return [...rewrite(rewritten, rewrittenContent), finish(false)];
    }
    const twice = target('edit twice');
    const twiceContent = twice === undefined ? undefined : fileContent(twice);
    if (twice !== undefined && twiceContent !== undefined) {
      return [...twoEdits(twice, twiceContent), finish(false)];
    }
    const edited = target('edit');
    const editedContent = edited === undefined ? undefined : fileContent(edited);
    if (edited !== undefined && editedContent !== undefined && !isMarkdownPath(edited)) {
      return [...singleEdit(edited, editedContent), finish(false)];
    }
    const mentioned = /[\w./-]+\.(?:md|markdown)\b/.exec(prompt)?.[0];
    const content = mentioned === undefined ? undefined : fileContent(mentioned);
    if (mentioned !== undefined && content !== undefined) {
      return [...singleEdit(mentioned, content), finish(false)];
    }
    if (word('command')) return [...shell(), finish(false)];
    if (word('fetch')) return [...fetch(), finish(false)];
    return [
      ...text(() => `You said: "${prompt}". This is the mock AI, running in the browser.`),
      finish(false),
    ];
  };

  const script = (request: AiRequest): Step[] => {
    const session: Step = (op) => {
      send(op, { type: 'session', resumeId: op.resumeId, model: request.model ?? 'mock-default' });
    };
    if (!ai().loggedIn) {
      return [
        session,
        (op) => {
          send(op, { type: 'error', message: MOCK_LATE_LOGIN_ERROR });
        },
        finish(true),
      ];
    }
    const resumeId = request.resumeId;
    if (resumeId !== undefined && !issued.has(resumeId)) {
      return [
        (op) => {
          send(op, { type: 'error', message: `${MOCK_NO_CONVERSATION} ${resumeId}` });
        },
        finish(true),
      ];
    }
    return [session, ...steps(request)];
  };

  /** Composes a quiz generation (throws a `BackendError` for a subject no longer proposed). */
  const compose = (input: QuizGenerationInput, resumeId: string | undefined): MockQuizComposed => {
    try {
      return composeMockQuiz(
        {
          files: files(),
          profile: profile(),
          subjects: subjects(),
          agentNames: MOCK_CONTEXT_FILE_NAMES,
        },
        input,
        resumeId,
      );
    } catch (err) {
      throw new BackendError('Ai', err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * A quiz generation, like a validated run of the gateway: the attempts of the chosen script,
   * each checked by the quiz validator, at most `1 + MOCK_MAX_RETRIES`, each retry announced.
   */
  const quizScript = (request: AiRequest, composed: MockQuizComposed): Step[] => {
    const session: Step = (op) => {
      send(op, { type: 'session', resumeId: op.resumeId, model: request.model ?? 'mock-default' });
    };
    if (!ai().loggedIn) {
      return [
        session,
        (op) => {
          send(op, { type: 'error', message: MOCK_LATE_LOGIN_ERROR });
        },
        finish(true),
      ];
    }
    const resumeId = request.resumeId;
    if (resumeId !== undefined && !issued.has(resumeId)) {
      return [
        (op) => {
          send(op, { type: 'error', message: `${MOCK_NO_CONVERSATION} ${resumeId}` });
        },
        finish(true),
      ];
    }
    const kind = ai().quizScript;
    const validator = new MockQuizValidator(composed, profile(), MOCK_CONTEXT_FILE_NAMES);
    const reads = composed.inlined.filter((d) => !d.contextOnly).map((d) => d.path);
    const delay = kind === 'slow' ? MOCK_QUIZ_SLOW_STEP_MS : undefined;
    const read = (path: string): Step => {
      const step: Step = (op) => {
        const toolId = uid('tool');
        send(op, {
          type: 'toolUse',
          toolId,
          tool: 'Read',
          summary: `Read ${path}`,
          input: { file_path: `/mock/${path}` },
        });
        send(op, { type: 'toolResult', toolId, content: 'ok', isError: false });
      };
      return delay === undefined ? step : after(delay, step);
    };
    let attempt = 0;
    const attemptSteps = (): Step[] => {
      attempt += 1;
      const n = attempt;
      const steps: Step[] =
        n === 1
          ? (kind === 'slow' ? [...reads, ...reads, ...reads] : reads).slice(0, 5).map(read)
          : [];
      steps.push((op) => {
        const output = scriptedAnswer(kind, composed, n);
        let value: unknown = output;
        if (kind === 'textOnly') {
          const text = `Here is the quiz:\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``;
          send(op, { type: 'text', text });
          value = jsonOfText(text);
        }
        send(op, {
          type: 'usage',
          inputTokens: n === 1 ? 24000 : 6000,
          outputTokens: 2400,
          costUsd: n === 1 ? 0.12 : 0.04,
          durationMs: 9000,
        });
        let verdict = validator.check(value);
        if (verdict.type === 'retry' && n >= 1 + MOCK_MAX_RETRIES)
          verdict = validator.onExhausted();
        if (verdict.type === 'accept') {
          send(op, { type: 'structuredOutput', value: verdict.value as unknown as JsonValue });
          end(op, 'Completed', null);
        } else if (verdict.type === 'fail') {
          send(op, { type: 'error', message: verdict.message });
          end(op, 'Failed', null);
        } else {
          send(op, {
            type: 'attempt',
            number: n + 1,
            of: 1 + MOCK_MAX_RETRIES,
            reason: verdict.reason,
          });
          op.extend(attemptSteps());
        }
      });
      return steps;
    };
    return [session, ...attemptSteps()];
  };

  /** A composed tutorial operation, like Rust's `compose_operation`. */
  type TutorialOp =
    | { kind: 'outline'; length: Length; calls: 1; outline: MockOutlineComposed }
    | { kind: 'suggest'; length: Length; calls: 1; suggest: MockSuggestComposed }
    | {
        kind: 'chapters';
        length: Length;
        calls: number;
        stages: (accepted: ChapterResult[]) => MockChapterStage[];
      };

  const composeTutorial = (action: AiUserAction, request: TutorialRequest): TutorialOp => {
    const deps = { files: files(), profile: profile(), agentNames: MOCK_CONTEXT_FILE_NAMES };
    if (action === 'subjectSuggestion') {
      if (request.kind !== 'suggest')
        throw new BackendError('Ai', 'This tutorial request does not match its action.');
      return {
        kind: 'suggest',
        length: 'standard',
        calls: 1,
        suggest: composeMockSuggest(deps, tutorialCards()),
      };
    }
    if (action !== 'tutorialGeneration')
      throw new BackendError('Ai', 'This tutorial operation is not available yet.');
    switch (request.kind) {
      case 'outline': {
        const card =
          request.input.subjectId === null
            ? null
            : (tutorialCards().find((c) => c.id === request.input.subjectId) ?? null);
        return {
          kind: 'outline',
          length: request.input.length,
          calls: 1,
          outline: composeMockOutline(deps, request.input, card),
        };
      }
      case 'chapters':
      case 'chapter': {
        const t = tutorial(request.id);
        if (!t)
          throw new BackendError(
            'TutorialNotFound',
            `This tutorial no longer exists: ${request.id}`,
          );
        const c =
          request.kind === 'chapters'
            ? composeMockChapters(deps, t, request.indices, null)
            : composeMockChapters(deps, t, [request.index], request.goal);
        return { kind: 'chapters', length: t.length, calls: c.indices.length, stages: c.stages };
      }
      default:
        throw new BackendError('Ai', 'This tutorial request does not match its action.');
    }
  };

  /** A read action of the mock model while it plans (shown in the activity line). */
  const readStep = (path: string, delay: number | undefined): Step => {
    const step: Step = (op) => {
      const toolId = uid('tool');
      send(op, {
        type: 'toolUse',
        toolId,
        tool: 'Read',
        summary: `Read ${path}`,
        input: { file_path: `/mock/${path}` },
      });
      send(op, { type: 'toolResult', toolId, content: 'ok', isError: false });
    };
    return delay === undefined ? step : after(delay, step);
  };

  /**
   * One validated run of the mock (an outline, or one stage of a staged run): the attempts of the
   * script, each checked by `check`, at most `1 + MOCK_MAX_RETRIES`, each retry announced; then
   * `onAccept` with the accepted value, or the failure.
   */
  const validatedSteps = (
    reads: string[],
    answer: (attempt: number) => unknown,
    validator: { check: (v: unknown) => MockVerdict; onExhausted: () => MockVerdict },
    onAccept: (op: ScriptedOperation, value: unknown) => void,
    usageFor: (attempt: number) => { input: number; output: number; cost: number },
  ): Step[] => {
    const kind = ai().tutorialScript;
    const delay = kind === 'slow' ? MOCK_QUIZ_SLOW_STEP_MS : undefined;
    let attempt = 0;
    const attemptSteps = (): Step[] => {
      attempt += 1;
      const n = attempt;
      const steps: Step[] = n === 1 ? reads.slice(0, 4).map((r) => readStep(r, delay)) : [];
      steps.push((op) => {
        const output = answer(n);
        let value: unknown = output;
        if (kind === 'textOnly') {
          const text = `Here it is:\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``;
          send(op, { type: 'text', text });
          value = jsonOfText(text);
        }
        const u = usageFor(n);
        send(op, {
          type: 'usage',
          inputTokens: u.input,
          outputTokens: u.output,
          costUsd: u.cost,
          durationMs: 9000,
        });
        let verdict = validator.check(value);
        if (verdict.type === 'retry' && n >= 1 + MOCK_MAX_RETRIES)
          verdict = validator.onExhausted();
        if (verdict.type === 'accept') {
          send(op, { type: 'structuredOutput', value: verdict.value as JsonValue });
          onAccept(op, verdict.value);
        } else if (verdict.type === 'fail') {
          send(op, { type: 'error', message: verdict.message });
          end(op, 'Failed', null);
        } else {
          send(op, {
            type: 'attempt',
            number: n + 1,
            of: 1 + MOCK_MAX_RETRIES,
            reason: verdict.reason,
          });
          op.extend(attemptSteps());
        }
      });
      return steps;
    };
    return attemptSteps();
  };

  /** A tutorial operation of the mock: one validated run, or a staged run of chapters. */
  const tutorialScript = (request: AiRequest, op: TutorialOp): Step[] => {
    const session: Step = (o) => {
      send(o, { type: 'session', resumeId: o.resumeId, model: request.model ?? 'mock-default' });
    };
    if (!ai().loggedIn) {
      return [
        session,
        (o) => {
          send(o, { type: 'error', message: MOCK_LATE_LOGIN_ERROR });
        },
        finish(true),
      ];
    }
    const script = ai().tutorialScript;
    const usage = { input: 0, output: 0, cost: 0 };
    const usageFor = (n: number) => {
      const u =
        n === 1
          ? { input: 30000, output: 4000, cost: 0.25 }
          : { input: 8000, output: 3000, cost: 0.08 };
      usage.input += u.input;
      usage.output += u.output;
      usage.cost += u.cost;
      return u;
    };
    const completed = (o: ScriptedOperation) => {
      recordUsage({
        kind: op.kind,
        length: op.length,
        model: request.model ?? 'mock-default',
        inputTokens: usage.input,
        outputTokens: usage.output,
        costUsd: Math.round(usage.cost * 100) / 100,
        calls: op.calls,
        atMs: Date.now(),
      });
      end(o, 'Completed', null);
    };
    if (op.kind === 'suggest') {
      const composed = op.suggest;
      return [
        session,
        ...validatedSteps(
          composed.inlined.filter((d) => !d.contextOnly).map((d) => d.path),
          (n) => scriptedSuggest(script, n),
          new MockSuggestValidator(composed),
          (o) => {
            completed(o);
          },
          usageFor,
        ),
      ];
    }
    if (op.kind === 'outline') {
      const composed = op.outline;
      const validator = new MockOutlineValidator(composed);
      return [
        session,
        ...validatedSteps(
          composed.inlined.filter((d) => !d.contextOnly).map((d) => d.path),
          (n) => scriptedOutline(script, composed, n),
          validator,
          (o) => {
            completed(o);
          },
          usageFor,
        ),
      ];
    }
    // A staged run: one validated run per chapter, the next one built from the accepted ones.
    const accepted: ChapterResult[] = [];
    const stageSteps = (i: number): Step[] => {
      const stages = op.stages(accepted);
      const stage = stages[i];
      if (!stage) return [];
      return [
        (o) => {
          send(o, { type: 'stage', number: i + 1, of: stages.length, label: stage.chapter.title });
        },
        ...validatedSteps(
          stage.inlined.filter((d) => !d.contextOnly).map((d) => d.path),
          (n) => scriptedChapter(script, stage, i + 1, n),
          new MockChapterValidator(stage),
          (o, value) => {
            accepted.push(value as ChapterResult);
            if (i + 1 < stages.length) o.extend(stageSteps(i + 1));
            else completed(o);
          },
          usageFor,
        ),
      ];
    };
    return [session, ...stageSteps(0)];
  };

  /** The last status check, reused for a minute like the Rust gateway's. */
  let statusCache: { at: number; status: AiProviderStatus } | null = null;

  const probe = (): AiProviderStatus => {
    ai().statusChecks += 1;
    const { installed, loggedIn } = ai();
    const usable = installed && loggedIn;
    return {
      providerId: MOCK_PROVIDER_ID,
      displayName: MOCK_PROVIDER_NAME,
      installed,
      loggedIn: usable,
      version: installed ? MOCK_PROVIDER_VERSION : null,
      account: usable ? 'reader@example.com' : null,
      plan: usable ? 'max' : null,
      problem: !installed ? MOCK_NOT_INSTALLED : !loggedIn ? MOCK_NOT_LOGGED_IN : null,
      help: !installed ? MOCK_NOT_INSTALLED_HELP : !loggedIn ? MOCK_NOT_LOGGED_IN_HELP : null,
    };
  };

  return {
    aiStatus: (force = false): Promise<AiProviderStatus> => {
      if (!force && statusCache && Date.now() - statusCache.at < MOCK_STATUS_CACHE_MS) {
        return Promise.resolve(structuredClone(statusCache.status));
      }
      const status = probe();
      statusCache = { at: Date.now(), status };
      return Promise.resolve(structuredClone(status));
    },
    aiCapabilities: (): Promise<AiCapabilities> =>
      Promise.resolve({
        streaming: true,
        resume: true,
        structuredOutput: true,
        imageInput: true,
        permissionPrompts: true,
        readOnlyMode: true,
        usageReporting: true,
        costReporting: true,
        models: MOCK_MODELS.map((m) => ({ ...m })),
        contextFileNames: MOCK_CONTEXT_FILE_NAMES,
      }),
    aiProviders: (): Promise<AiProviderInfo[]> =>
      Promise.resolve([{ id: MOCK_PROVIDER_ID, displayName: MOCK_PROVIDER_NAME }]),
    aiSetProvider: (id: string): Promise<Settings> => {
      if (running) {
        return Promise.reject(
          new BackendError(
            'Ai',
            'The AI provider cannot change while an operation runs; stop it first.',
          ),
        );
      }
      if (id !== MOCK_PROVIDER_ID) {
        return Promise.reject(new BackendError('Ai', `Unknown AI provider: ${id}`));
      }
      settings().ai.provider = id;
      statusCache = null;
      return Promise.resolve(structuredClone(settings()));
    },
    // Async so the errors thrown by the helpers become rejections.
    // eslint-disable-next-line @typescript-eslint/require-await
    aiContext: async (currentPath: string | null): Promise<AiContextDocument[]> => {
      requireRoot();
      return collectContext(file, currentPath, MOCK_CONTEXT_FILE_NAMES);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    aiEstimate: async (input: AiEstimateInput): Promise<AiSizeEstimate> => {
      requireRoot();
      if (input.tutorial) {
        // Like `tutorial_estimate`: the first call's composed prompt, the calls, the cost line.
        const action: AiUserAction =
          input.tutorial.kind === 'review'
            ? 'tutorialReview'
            : input.tutorial.kind === 'suggest'
              ? 'subjectSuggestion'
              : 'tutorialGeneration';
        const op = composeTutorial(action, input.tutorial);
        const first =
          op.kind === 'outline'
            ? op.outline
            : op.kind === 'suggest'
              ? op.suggest
              : op.stages([])[0];
        const inlined = first?.inlined ?? [];
        const inlinedBytes = inlined.reduce((n, d) => n + d.bytes, 0);
        const size = estimateSize(
          MOCK_TUTORIAL_RULES_BYTES + (first?.prompt.length ?? 0) + inlinedBytes,
          [],
          0,
        );
        return {
          ...size,
          documents: inlined.length,
          inlined,
          calls: op.calls,
          costHint: costHint(tutorialUsage(), op.kind, op.length, op.calls),
        };
      }
      if (input.quiz) {
        // Like `quiz_estimate`: the composed prompt, which inlines its documents.
        const composed = compose(input.quiz, undefined);
        const inlinedBytes = composed.inlined.reduce((n, d) => n + d.bytes, 0);
        const size = estimateSize(
          MOCK_QUIZ_RULES_BYTES + composed.prompt.length + inlinedBytes,
          [],
          0,
        );
        return { ...size, documents: composed.inlined.length, inlined: composed.inlined };
      }
      const docs = contextDocuments(file, input.contextPaths, MOCK_CONTEXT_FILE_NAMES, false);
      return estimateSize(input.promptBytes, docs, input.images);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    aiStart: async (action: AiUserAction, start: AiStartRequest): Promise<number> => {
      requireRoot();
      const quiz = action === 'quizGeneration';
      if (quiz && !start.quiz) {
        throw new BackendError('Ai', "A quiz generation needs the quiz's options.");
      }
      // Like `compose_operation`: a tutorial operation is composed here, read-only.
      const learning =
        action === 'tutorialGeneration' ||
        action === 'tutorialReview' ||
        action === 'subjectSuggestion';
      let tutorialOp: TutorialOp | null = null;
      if (learning) {
        if (!start.tutorial)
          throw new BackendError('Ai', 'A tutorial operation needs what the user chose.');
        tutorialOp = composeTutorial(action, start.tutorial);
      }
      // Like `operation_request`: a quiz is composed here, read-only; what the frontend sent as a
      // prompt, context, capture, images or schema is ignored.
      let composed: MockQuizComposed | null = null;
      if (quiz && start.quiz) {
        composed = compose(start.quiz, start.resumeId);
      }
      const firstPrompt =
        tutorialOp === null
          ? ''
          : tutorialOp.kind === 'outline'
            ? tutorialOp.outline.prompt
            : tutorialOp.kind === 'suggest'
              ? tutorialOp.suggest.prompt
              : (tutorialOp.stages([])[0]?.prompt ?? '');
      const request: AiRequest = tutorialOp
        ? {
            prompt: firstPrompt,
            ...(start.model === undefined ? {} : { model: start.model }),
            context: [],
            images: [],
            policy: 'readOnly',
            outputSchema: MOCK_TUTORIAL_SCHEMA,
          }
        : composed
          ? {
              prompt: composed.prompt,
              ...(start.model === undefined ? {} : { model: start.model }),
              ...(start.resumeId === undefined ? {} : { resumeId: start.resumeId }),
              context: [],
              images: [],
              policy: 'readOnly',
              outputSchema: MOCK_QUIZ_SCHEMA,
            }
          : requestFrom(file, MOCK_CONTEXT_FILE_NAMES, start);
      if (!ai().installed) throw new BackendError('Ai', MOCK_NOT_INSTALLED);
      if (running) {
        throw new BackendError('Ai', 'An AI operation is still running; stop it first.');
      }
      ai().starts.push(action);
      ai().lastRequest = structuredClone(request);
      let resumeId = request.resumeId;
      if (resumeId === undefined) {
        resumeId = `00000000-0000-4000-8000-${String(++sessions).padStart(12, '0')}`;
        issued.add(resumeId);
      }
      const op = new ScriptedOperation(
        ++nextId,
        resumeId,
        () => ai().stepMs,
        request.policy,
        structuredClone(settings().ai.permissions),
      );
      running = op;
      op.start(
        tutorialOp
          ? tutorialScript(request, tutorialOp)
          : composed
            ? quizScript(request, composed)
            : script(request),
      );
      return op.id;
    },
    aiRespondPermission: (
      operationId: number,
      requestId: string,
      decision: PermissionDecision,
    ): Promise<void> => {
      if (running?.id !== operationId || !running.answer(requestId, decision)) {
        return Promise.reject(new BackendError('Ai', 'This AI operation is over.'));
      }
      return Promise.resolve();
    },
    aiCancel: (operationId: number): Promise<void> => {
      if (running?.id === operationId) end(running, 'Cancelled', null);
      return Promise.resolve();
    },
    // Conversations: app data, no provider involved.
    // eslint-disable-next-line @typescript-eslint/require-await
    listConversations: async (): Promise<ConversationSummary[]> =>
      conversationsOf(requireRoot()).map(summaryOf),
    // eslint-disable-next-line @typescript-eslint/require-await
    getConversation: async (id: string): Promise<Conversation> => {
      const found = conversationsOf(requireRoot()).find((c) => c.id === id);
      if (!found) throw new BackendError('NotFound', `Not found: conversation ${id}`);
      return structuredClone(found);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    saveConversation: async (conversation: Conversation): Promise<void> => {
      const root = requireRoot();
      const limit = settings().ai.historyLimit;
      ai().conversations.set(root, upsert(conversationsOf(root), conversation, limit));
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    deleteConversation: async (id: string): Promise<void> => {
      const root = requireRoot();
      ai().conversations.set(
        root,
        conversationsOf(root).filter((c) => c.id !== id),
      );
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    forgetConversations: async (): Promise<void> => {
      ai().conversations.delete(requireRoot());
    },
    /** Stops any running operation (for `reset`). */
    reset: () => {
      running?.stop();
      running = null;
      statusCache = null;
      issued.clear();
    },
  };
}

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
  Settings,
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
}

export const DEFAULT_MOCK_AI: MockAiState = {
  installed: true,
  loggedIn: true,
  stepMs: 30,
  starts: [],
  lastRequest: null,
  statusChecks: 0,
  conversations: new Map(),
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
      const docs = contextDocuments(file, input.contextPaths, MOCK_CONTEXT_FILE_NAMES, false);
      return estimateSize(input.promptBytes, docs, input.images);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    aiStart: async (action: AiUserAction, start: AiStartRequest): Promise<number> => {
      requireRoot();
      const request = requestFrom(file, MOCK_CONTEXT_FILE_NAMES, start);
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
      op.start(script(request));
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

// The mock AI provider: a scripted stand-in behind the same provider-neutral events the Rust
// gateway emits. It powers the browser dev mode and the tests, and keeps the abstraction honest
// as a second implementation. Mentioning a markdown file of the fixture proposes an edit to it
// (a permission request); mentioning "command" asks to run one; anything else gets a streamed
// text answer.

import { BackendError } from '../types';
import type {
  AiCapabilities,
  AiEvent,
  AiEventEnvelope,
  AiOutcome,
  AiProviderStatus,
  AiRequest,
  AiUserAction,
  BackendEvents,
  EventName,
  PermissionDecision,
  ProposedEdit,
} from '../types';

export interface MockAiState {
  installed: boolean;
  loggedIn: boolean;
  /** Delay between the scripted events, in milliseconds. */
  stepMs: number;
  /** Operations started so far, with the user action that started each. */
  starts: AiUserAction[];
}

export const DEFAULT_MOCK_AI: MockAiState = {
  installed: true,
  loggedIn: true,
  stepMs: 30,
  starts: [],
};

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

type Emit = <E extends EventName>(event: E, payload: BackendEvents[E]) => void;

interface Deps {
  emit: Emit;
  ai: () => MockAiState;
  fileContent: (relPath: string) => string | undefined;
  writeFiles: (files: Record<string, string>) => void;
}

/** A step of the script; returning `'wait'` pauses it until the permission is answered. */
type Step = (op: ScriptedOperation) => unknown;

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
    this.timer = setTimeout(this.next, this.stepMs());
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

export function createMockAi({ emit, ai, fileContent, writeFiles }: Deps) {
  let nextId = 0;
  let sessions = 0;
  let counter = 0;
  let running: ScriptedOperation | null = null;
  const uid = (prefix: string) => `${prefix}_${String(++counter).padStart(4, '0')}`;

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

  /** A tool call that needs a permission; `onAllow` runs the tool and returns its result. */
  const permission = (
    tool: string,
    input: Record<string, string | boolean>,
    description: string,
    proposedEdit: ProposedEdit | null,
    onAllow: () => string,
  ): Step[] => {
    const toolId = uid('tool');
    const summary = `${tool} ${description}`;
    return [
      (op) => {
        send(op, { type: 'toolUse', toolId, tool, summary, input });
      },
      (op) => {
        const requestId = uid('req');
        op.wait(requestId, (decision) => {
          const allowed = decision.behavior === 'allow';
          send(op, {
            type: 'toolResult',
            toolId,
            content: allowed ? onAllow() : decision.message,
            isError: !allowed,
          });
        });
        send(op, {
          type: 'permissionRequest',
          requestId,
          tool,
          description,
          input,
          proposedEdit,
        });
        return 'wait';
      },
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
    const prompt = request.prompt;
    const mentioned = /[\w./-]+\.(?:md|markdown)\b/.exec(prompt)?.[0];
    const content = mentioned === undefined ? undefined : fileContent(mentioned);
    if (mentioned !== undefined && content !== undefined) {
      const firstLine = content.split('\n')[0] ?? '';
      const edited = `${firstLine} (edited by the AI)`;
      let applied = false;
      return [
        session,
        ...text(() => `I'll update ${mentioned} as asked.`),
        ...permission(
          'Edit',
          { file_path: `/mock/${mentioned}`, old_string: firstLine, new_string: edited },
          mentioned,
          {
            path: mentioned,
            isMarkdown: true,
            wholeFile: false,
            hunks: [{ oldText: firstLine, newText: edited }],
          },
          () => {
            applied = true;
            writeFiles({ [mentioned]: content.replace(firstLine, edited) });
            return `The file ${mentioned} has been updated successfully.`;
          },
        ),
        ...text(() => (applied ? MOCK_APPLIED_TEXT : MOCK_REJECTED_TEXT)),
        finish(false),
      ];
    }
    if (/\bcommand\b/i.test(prompt)) {
      return [
        session,
        ...permission(
          'Bash',
          { command: 'git log --oneline -5' },
          'git log --oneline -5',
          null,
          () => '52b0b8e Merge branch phase-2-navigation',
        ),
        ...text(() => 'Here is what I found.'),
        finish(false),
      ];
    }
    return [
      session,
      ...text(() => `You said: "${prompt}". This is the mock AI, running in the browser.`),
      finish(false),
    ];
  };

  return {
    aiStatus: (): Promise<AiProviderStatus> => {
      const { installed, loggedIn } = ai();
      const usable = installed && loggedIn;
      return Promise.resolve({
        providerId: 'mock',
        displayName: MOCK_PROVIDER_NAME,
        installed,
        loggedIn: usable,
        version: installed ? MOCK_PROVIDER_VERSION : null,
        account: usable ? 'reader@example.com' : null,
        plan: usable ? 'max' : null,
        problem: !installed ? MOCK_NOT_INSTALLED : !loggedIn ? MOCK_NOT_LOGGED_IN : null,
        help: !installed ? MOCK_NOT_INSTALLED_HELP : !loggedIn ? MOCK_NOT_LOGGED_IN_HELP : null,
      });
    },
    aiCapabilities: (): Promise<AiCapabilities> =>
      Promise.resolve({
        streaming: true,
        resume: true,
        structuredOutput: true,
        imageInput: false,
        permissionPrompts: true,
        readOnlyMode: true,
        usageReporting: true,
        costReporting: true,
        models: [
          { id: 'mock-fast', label: 'Mock Fast (default)' },
          { id: 'mock-smart', label: 'Mock Smart' },
        ],
        contextFileNames: ['AGENTS.md'],
      }),
    aiStart: (action: AiUserAction, request: AiRequest): Promise<number> => {
      if (!ai().installed) return Promise.reject(new BackendError('Ai', MOCK_NOT_INSTALLED));
      if (running) {
        return Promise.reject(
          new BackendError('Ai', 'An AI operation is still running; stop it first.'),
        );
      }
      ai().starts.push(action);
      const resumeId =
        request.resumeId ?? `00000000-0000-4000-8000-${String(++sessions).padStart(12, '0')}`;
      const op = new ScriptedOperation(++nextId, resumeId, () => ai().stepMs);
      running = op;
      op.start(script(request));
      return Promise.resolve(op.id);
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
    /** Stops any running operation (for `reset`). */
    reset: () => {
      running?.stop();
      running = null;
    },
  };
}

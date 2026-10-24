// A scripted stand-in for the Claude CLI, emitting the same `stream-json` shapes the Rust side
// forwards. Mentioning a markdown file of the fixture proposes an edit to it (a permission
// request); mentioning "command" asks to run one; anything else gets a streamed text answer.

import { BackendError } from '../types';
import type {
  BackendEvents,
  ClaudePermissionDecision,
  ClaudeStatus,
  ClaudeTurnOutcome,
  ClaudeTurnRequest,
  EventName,
  JsonValue,
} from '../types';
import { FIXTURE_ROOT } from './fixture';

export interface MockClaudeState {
  installed: boolean;
  loggedIn: boolean;
  /** Delay between the scripted messages, in milliseconds. */
  stepMs: number;
}

export const DEFAULT_MOCK_CLAUDE: MockClaudeState = { installed: true, loggedIn: true, stepMs: 30 };

export const MOCK_CLAUDE_VERSION = '2.1.310';
export const MOCK_NOT_INSTALLED =
  'The Claude Code CLI was not found. Install it (see https://claude.com/claude-code), make sure `claude` works in a terminal, then check again.';
export const MOCK_NOT_LOGGED_IN =
  'You are not logged in to Claude Code. Run `claude` in a terminal and log in (or run `claude auth login`), then check again.';
export const MOCK_REJECTED_TEXT = 'Understood, I left the file unchanged.';
export const MOCK_APPLIED_TEXT = 'Done.';

type Emit = <E extends EventName>(event: E, payload: BackendEvents[E]) => void;

interface Deps {
  emit: Emit;
  claude: () => MockClaudeState;
  fileContent: (relPath: string) => string | undefined;
  writeFiles: (files: Record<string, string>) => void;
}

/** A step of the script; returning `'wait'` pauses it until the permission is answered. */
type Step = (turn: ScriptedTurn) => unknown;

/** Runs the steps of one turn with a delay between them. */
class ScriptedTurn {
  private steps: Step[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waiting: {
    requestId: string;
    onDecision: (decision: ClaudePermissionDecision) => void;
  } | null = null;
  done = false;

  constructor(
    readonly id: number,
    readonly sessionId: string,
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

  wait(requestId: string, onDecision: (decision: ClaudePermissionDecision) => void) {
    this.waiting = { requestId, onDecision };
  }

  /** Answers the pending permission request and resumes the script. */
  answer(requestId: string, decision: ClaudePermissionDecision): boolean {
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

export function createMockClaude({ emit, claude, fileContent, writeFiles }: Deps) {
  let nextTurn = 0;
  let sessions = 0;
  let counter = 0;
  let running: ScriptedTurn | null = null;
  const uid = (prefix: string) => `${prefix}_${String(++counter).padStart(4, '0')}`;

  const message = (turn: ScriptedTurn, message: JsonValue) => {
    emit('claude://message', { turnId: turn.id, message });
  };

  const end = (turn: ScriptedTurn, outcome: ClaudeTurnOutcome, exitCode: number) => {
    if (running !== turn) return;
    turn.stop();
    running = null;
    emit('claude://turn-end', { turnId: turn.id, outcome, exitCode, stderr: null });
  };

  /** A streamed text answer: start, two deltas, then the complete message. */
  const text = (content: () => string): Step[] => [
    (t) => {
      message(t, {
        type: 'stream_event',
        event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      });
    },
    (t) => {
      const full = content();
      message(t, {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: full.slice(0, Math.ceil(full.length / 2)) },
        },
      });
    },
    (t) => {
      const full = content();
      message(t, {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: full.slice(Math.ceil(full.length / 2)) },
        },
      });
    },
    (t) => {
      message(t, {
        type: 'assistant',
        message: {
          id: uid('msg'),
          role: 'assistant',
          content: [{ type: 'text', text: content() }],
        },
      });
    },
  ];

  const result =
    (isError: boolean, resultText: string): Step =>
    (t) => {
      message(t, {
        type: 'result',
        subtype: 'success',
        is_error: isError,
        result: resultText,
        session_id: t.sessionId,
        total_cost_usd: isError ? 0 : 0.0031,
        duration_ms: isError ? 0 : 4200,
        num_turns: 1,
      });
      end(t, 'Completed', isError ? 1 : 0);
    };

  /** A tool call that needs a permission; `onAllow` runs the tool and returns its result. */
  const permission = (
    toolName: string,
    input: Record<string, JsonValue>,
    description: string,
    onAllow: () => string,
  ): Step[] => {
    const toolUseId = uid('toolu');
    return [
      (t) => {
        message(t, {
          type: 'assistant',
          message: {
            id: uid('msg'),
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolUseId, name: toolName, input }],
          },
        });
      },
      (t) => {
        const requestId = uid('req');
        t.wait(requestId, (decision) => {
          const allowed = decision.behavior === 'allow';
          const content = allowed ? onAllow() : decision.message;
          message(t, {
            type: 'user',
            message: {
              role: 'user',
              content: [
                { type: 'tool_result', tool_use_id: toolUseId, content, is_error: !allowed },
              ],
            },
          });
        });
        emit('claude://permission', { turnId: t.id, requestId, toolName, input, description });
        return 'wait';
      },
    ];
  };

  const script = (request: ClaudeTurnRequest): Step[] => {
    const init: Step = (t) => {
      message(t, {
        type: 'system',
        subtype: 'init',
        session_id: t.sessionId,
        cwd: FIXTURE_ROOT,
        model: request.model ?? 'claude-sonnet-5-5',
        tools: ['Read', 'Edit', 'Write', 'Bash'],
        permissionMode: 'default',
      });
    };
    if (!claude().loggedIn) {
      const notLoggedIn = 'Not logged in · Please run /login';
      return [
        init,
        (t) => {
          message(t, {
            type: 'assistant',
            message: {
              id: uid('msg'),
              role: 'assistant',
              model: '<synthetic>',
              content: [{ type: 'text', text: notLoggedIn }],
            },
          });
        },
        result(true, notLoggedIn),
      ];
    }
    const prompt = request.prompt;
    const mentioned = /[\w./-]+\.(?:md|markdown)\b/.exec(prompt)?.[0];
    const content = mentioned === undefined ? undefined : fileContent(mentioned);
    if (mentioned !== undefined && content !== undefined) {
      const firstLine = content.split('\n')[0] ?? '';
      const edited = `${firstLine} (edited by Claude)`;
      let applied = false;
      return [
        init,
        ...text(() => `I'll update ${mentioned} as asked.`),
        ...permission(
          'Edit',
          {
            file_path: `${FIXTURE_ROOT}/${mentioned}`,
            old_string: firstLine,
            new_string: edited,
            replace_all: false,
          },
          mentioned,
          () => {
            applied = true;
            writeFiles({ [mentioned]: content.replace(firstLine, edited) });
            return `The file ${FIXTURE_ROOT}/${mentioned} has been updated successfully.`;
          },
        ),
        ...text(() => (applied ? MOCK_APPLIED_TEXT : MOCK_REJECTED_TEXT)),
        result(false, 'ok'),
      ];
    }
    if (/\bcommand\b/i.test(prompt)) {
      return [
        init,
        ...permission(
          'Bash',
          { command: 'git log --oneline -5', description: 'Recent commits' },
          'git log --oneline -5',
          () => '52b0b8e Merge branch phase-2-navigation',
        ),
        ...text(() => 'Here is what I found.'),
        result(false, 'ok'),
      ];
    }
    return [
      init,
      ...text(() => `You said: "${prompt}". This is the mock Claude, running in the browser.`),
      result(false, 'ok'),
    ];
  };

  return {
    claudeStatus: (): Promise<ClaudeStatus> => {
      const { installed, loggedIn } = claude();
      const usable = installed && loggedIn;
      return Promise.resolve({
        installed,
        path: installed ? '/mock/bin/claude' : null,
        version: installed ? MOCK_CLAUDE_VERSION : null,
        loggedIn: usable,
        email: usable ? 'reader@example.com' : null,
        subscription: usable ? 'max' : null,
        problem: !installed ? MOCK_NOT_INSTALLED : !loggedIn ? MOCK_NOT_LOGGED_IN : null,
      });
    },
    claudeStartTurn: (request: ClaudeTurnRequest): Promise<number> => {
      if (!claude().installed) {
        return Promise.reject(new BackendError('Claude', MOCK_NOT_INSTALLED));
      }
      if (running) {
        return Promise.reject(
          new BackendError('Claude', 'Claude is still answering; stop it first.'),
        );
      }
      const sessionId =
        request.resumeSessionId ??
        `00000000-0000-4000-8000-${String(++sessions).padStart(12, '0')}`;
      const turn = new ScriptedTurn(++nextTurn, sessionId, () => claude().stepMs);
      running = turn;
      turn.start(script(request));
      return Promise.resolve(turn.id);
    },
    claudeRespondPermission: (
      turnId: number,
      requestId: string,
      decision: ClaudePermissionDecision,
    ): Promise<void> => {
      if (running?.id !== turnId || !running.answer(requestId, decision)) {
        return Promise.reject(new BackendError('Claude', 'This Claude turn is over.'));
      }
      return Promise.resolve();
    },
    claudeCancel: (turnId: number): Promise<void> => {
      if (running?.id === turnId) end(running, 'Cancelled', 1);
      return Promise.resolve();
    },
    /** Stops any running turn (for `reset`). */
    reset: () => {
      running?.stop();
      running = null;
    },
  };
}

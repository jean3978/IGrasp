// A step as readable markdown, for the review's before/after diff (the reader's words, not the
// shared file format): the title, the texts, the items and the cited ranges.

import type { Citation, Step } from '../../ipc/types';
import { citationLines, stepTitle } from '../../lib/tutorial';

const cite = (c: Pick<Citation, 'path' | 'firstLine' | 'lastLine'>) => {
  const lines = citationLines(c);
  return `\`${lines ? `${c.path}:${lines}` : c.path}\``;
};

const sources = (cs: Citation[]) =>
  cs.length === 0 ? [] : [`Sources: ${cs.map((c) => cite(c)).join(', ')}`];

export function stepMarkdown(step: Step): string {
  const out: string[] = [`### ${stepTitle(step)}`];
  switch (step.type) {
    case 'explain':
      out.push(step.body, ...sources(step.sources));
      break;
    case 'conceptBridge':
      out.push(`**${step.concept}**`, step.applied, ...sources(step.sources));
      break;
    case 'codeTour':
      for (const s of step.stops) out.push(`- ${cite(s)}: ${s.annotation}`);
      break;
    case 'diagram':
      out.push(`\`\`\`mermaid\n${step.mermaid}\n\`\`\``);
      if (step.caption) out.push(step.caption);
      out.push(...sources(step.sources));
      break;
    case 'putInOrder':
      out.push(step.prompt, step.items.map((i, n) => `${String(n + 1)}. ${i}`).join('\n'));
      out.push(step.explanation, ...sources(step.sources));
      break;
    case 'match':
      out.push(step.prompt, step.pairs.map((p) => `- ${p.left} → ${p.right}`).join('\n'));
      out.push(step.explanation, ...sources(step.sources));
      break;
    case 'spotIt':
      out.push(step.prompt, `${cite(step)}, line ${String(step.answerLine)}`, step.explanation);
      break;
    case 'quickCheck':
      out.push(
        step.choices
          .map((c, i) => `- ${i === step.answer ? '**' : ''}${c}${i === step.answer ? '**' : ''}`)
          .join('\n'),
        step.explanation,
        ...sources(step.sources),
      );
      break;
    case 'tryIt':
      out.push(step.instruction);
      if (step.command) out.push(`\`\`\`\n${step.command}\n\`\`\``);
      if (step.expected) out.push(step.expected);
      out.push(...sources(step.sources));
      break;
    case 'recap':
      out.push(step.takeaways.map((t) => `- ${t}`).join('\n'), ...sources(step.sources));
      break;
  }
  return `${out.filter((p) => p.trim() !== '').join('\n\n')}\n`;
}

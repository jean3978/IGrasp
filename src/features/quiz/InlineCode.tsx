// Quiz texts written by the AI quote code with backticks (`npm test`). They show as inline code;
// everything else stays plain text (no markdown, no markup).

export function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`\n]+`)/);
  return (
    <>
      {parts.map((part, i) =>
        part.length > 2 && part.startsWith('`') && part.endsWith('`') ? (
          <code key={i} className="quiz-code">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

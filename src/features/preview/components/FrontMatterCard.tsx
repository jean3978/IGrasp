import { useState } from 'react';
import type { FrontMatter } from '../pipeline/frontmatter';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function Value({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <ul className="fm-chips">
        {value.map((v, i) => (
          <li key={i} className="fm-chip">
            {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
          </li>
        ))}
      </ul>
    );
  }
  if (isRecord(value)) {
    return (
      <details className="fm-object">
        <summary>{Object.keys(value).length} fields</summary>
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </details>
    );
  }
  if (value instanceof Date) return <>{value.toISOString().slice(0, 10)}</>;
  if (value === null || value === undefined) return <span className="fm-null">—</span>;
  if (typeof value === 'boolean') return <code>{String(value)}</code>;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') {
    return <>{String(value)}</>;
  }
  return <>{JSON.stringify(value)}</>;
}

/** The YAML front matter, as a card above the document. */
export function FrontMatterCard({ frontMatter }: { frontMatter: FrontMatter }) {
  const [raw, setRaw] = useState(false);
  const entries = isRecord(frontMatter.data) ? Object.entries(frontMatter.data) : null;
  const showRaw = raw || entries === null;

  return (
    <section className="front-matter" aria-label="Front matter">
      <header className="fm-header">
        <span className="fm-label">Front matter</span>
        {entries !== null && (
          <button
            type="button"
            className="fm-toggle"
            aria-pressed={raw}
            onClick={() => {
              setRaw(!raw);
            }}
          >
            {raw ? 'Fields' : 'YAML'}
          </button>
        )}
      </header>
      {frontMatter.error && (
        <p className="fm-error" role="alert">
          Invalid YAML: {frontMatter.error}
        </p>
      )}
      {showRaw ? (
        <pre className="fm-raw">{frontMatter.raw}</pre>
      ) : (
        <dl className="fm-grid">
          {entries.map(([key, value]) => (
            <div key={key} className="fm-row">
              <dt>{key}</dt>
              <dd>
                <Value value={value} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

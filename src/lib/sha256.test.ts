import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('matches the reference digests on block boundaries and non-ASCII input', () => {
    // Computed with Node's crypto.createHash('sha256').
    const cases: [string, string][] = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['a'.repeat(55), '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318'],
      ['a'.repeat(56), 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
      ['é—🦉\n'.repeat(40), '0a5c5123656220d20396d1c86b82f17cbce53daecb9d2dc24626d1b06917cd20'],
      ['x'.repeat(1000), '44f8354494a5ba03ba1792a8d3e9c534c47a9181980fde7a3f44b06ef2ae7c7f'],
    ];
    for (const [text, digest] of cases) expect(sha256Hex(text)).toBe(digest);
  });
});

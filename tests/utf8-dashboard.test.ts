import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/ui/Dashboard.tsx', import.meta.url));

/** Fails loudly if the file ever contains bytes that are not valid UTF-8. */
function strictDecode(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

test('Dashboard source is valid UTF-8 with no replacement characters', () => {
  const text = strictDecode(source);
  assert.ok(text.length > 0);
  assert.equal(text.includes('\uFFFD'), false, 'no mojibake replacement characters');
  // A literal `?` where an interpolation should be is the bug this guards against.
  assert.equal(/\?\{range\./.test(text), false);
});

test('the range summary interpolates both times with a real en dash', () => {
  const text = strictDecode(source);
  assert.match(text, /\$\{range\.startTime\}–\$\{range\.endTime\}/);
  // Both the primary and the fallback summary must interpolate the end time.
  assert.equal([...text.matchAll(/\$\{range\.endTime\}/g)].length >= 2, true);
});

test('the example note stays readable and marks the data as demo', () => {
  const text = strictDecode(source);
  assert.match(text, /labelled “Example · ” are demo data, not real courses/);
  assert.match(text, /room availability/);
  assert.match(text, /Personal study planning only/);
});

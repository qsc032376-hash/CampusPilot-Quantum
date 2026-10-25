import assert from 'node:assert/strict';
import test from 'node:test';
import { previewDraft, toLocalInput } from '../src/ai/assistantDraft.ts';

const windowStart = '2026-10-25';

test('an ISO instant becomes the campus local form value', () => {
  assert.equal(toLocalInput('2026-10-29T23:00:00-04:00'), '2026-10-29T23:00');
  assert.equal(toLocalInput('2026-11-02T02:00:00Z'), '2026-11-01T21:00');
});

test('a valid draft becomes a task draft through the shared validation', () => {
  const preview = previewDraft(
    [{ title: 'Calculus review', durationMinutes: 120, dueAt: '2026-10-29T23:00:00-04:00' }],
    windowStart,
  );
  assert.equal(preview.validCount, 1);
  const item = preview.items[0];
  assert.ok(item.ok);
  assert.equal(item.draft.title, 'Calculus review');
  assert.equal(item.draft.durationMinutes, 120);
  assert.equal(item.draft.dueAt, new Date('2026-10-29T23:00:00-04:00').toISOString());
});

test('an invalid draft keeps the failure message instead of dropping the task', () => {
  const preview = previewDraft(
    [
      { title: '   ', durationMinutes: 60, dueAt: '2026-10-29T23:00:00-04:00' },
      { title: 'Too long', durationMinutes: 900, dueAt: '2026-10-29T23:00:00-04:00' },
    ],
    windowStart,
  );
  assert.equal(preview.validCount, 0);
  assert.equal(preview.items.length, 2);
  assert.ok(!preview.items[0].ok);
  assert.match(preview.items[0].message, /title/i);
  assert.ok(!preview.items[1].ok);
  assert.match(preview.items[1].message, /minutes/i);
});

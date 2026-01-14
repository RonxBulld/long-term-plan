/**
 * Storage/security boundary tests.
 *
 * These are "defense in depth" guardrails: plan/task ids and resolved paths must
 * never allow escaping the configured `rootDir`.
 */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { assertSafeId, resolvePlanPath, resolvePlansDir } from '../dist/todo/storage.js';

function expectInvalidId(kind, value) {
  assert.throws(() => assertSafeId(kind, value), /Invalid (planId|taskId):/);
}

test('assertSafeId rejects invalid ids', () => {
  // Empty, whitespace, and reserved-ish characters.
  expectInvalidId('planId', '');
  expectInvalidId('planId', ' ');
  expectInvalidId('planId', 'a b');
  expectInvalidId('planId', 'a/b');
  expectInvalidId('planId', 'a..b');
  expectInvalidId('planId', '_leading_underscore');

  // Length: max is 128 chars (first char + 127).
  expectInvalidId('planId', 'a'.repeat(129));
  assert.doesNotThrow(() => assertSafeId('planId', 'a'.repeat(128)));
});

test('resolvePlansDir rejects paths that escape rootDir', () => {
  const rootDir = resolve('.tmp-root');
  assert.throws(
    () => resolvePlansDir({ rootDir, plansDir: '../escape' }),
    /escapes rootDir/
  );
});

test('resolvePlanPath rejects invalid plan ids and root escapes', () => {
  const rootDir = resolve('.tmp-root');
  assert.throws(
    () => resolvePlanPath({ rootDir, plansDir: '.long-term-plan' }, 'demo/evil'),
    /Invalid planId/
  );
  assert.throws(
    () => resolvePlanPath({ rootDir, plansDir: '../escape' }, 'demo'),
    /escapes rootDir/
  );
});

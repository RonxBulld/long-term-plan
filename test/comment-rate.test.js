/**
 * Comment density guardrail.
 *
 * Rationale: this repo intentionally keeps “explain why” context close to the
 * code because the format/edits are easy to subtly break with refactors.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

async function listFilesRecursive(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const fullPath = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRecursive(fullPath)));
      continue;
    }
    if (entry.isFile()) out.push(fullPath);
  }
  return out;
}

function countCommentAndCodeLines(text) {
  const lines = text.split(/\r?\n/);
  let comment = 0;
  let code = 0;
  let inBlock = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (inBlock) {
      comment += 1;
      if (trimmed.includes('*/')) inBlock = false;
      continue;
    }

    if (trimmed.startsWith('//')) {
      comment += 1;
      continue;
    }

    if (trimmed.startsWith('/*')) {
      comment += 1;
      if (!trimmed.includes('*/')) inBlock = true;
      continue;
    }

    code += 1;
  }

  return { comment, code };
}

test('src comment rate stays >= 15%', async () => {
  const files = (await listFilesRecursive('src')).filter((p) => p.endsWith('.ts'));
  assert.ok(files.length > 0, 'expected at least one src/*.ts file');

  let totalComment = 0;
  let totalCode = 0;

  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8');
    const counted = countCommentAndCodeLines(text);
    totalComment += counted.comment;
    totalCode += counted.code;
  }

  const nonBlank = totalComment + totalCode;
  const rate = nonBlank === 0 ? 1 : totalComment / nonBlank;

  assert.ok(
    rate >= 0.15,
    `comment rate too low: ${(rate * 100).toFixed(1)}% (comment=${totalComment}, code=${totalCode})`
  );
});


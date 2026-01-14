import { LONG_TERM_PLAN_FORMAT_HEADER } from './constants.js';
import type { Diagnostic } from './diagnostics.js';
import { errorDiagnostic, warningDiagnostic } from './diagnostics.js';
import { isSafeId } from './id.js';
import { parsePlanMarkdown, parseTaskLineStrict } from './parse.js';

/**
 * Validator for long-term-plan markdown documents.
 *
 * Compared to `parsePlanMarkdown`, validation is more "forgiving" in detection:
 * - It uses a loose regex to find candidate task lines.
 * - It then reports specific diagnostics for malformed or missing id trailers.
 *
 * The final result includes both syntactic validation errors and any parse-time
 * errors/warnings, de-duplicated by (severity, code, line, message).
 */
const TASK_LINE_LOOSE_RE = /^(\s*)-\s+\[([^\]])\]\s+(.*)$/;
const TASK_ID_TRAILER_RE =
  /<!--\s*long-term-plan:id=([A-Za-z0-9_-]+)\s*-->\s*$/;

export interface ValidatePlanResult {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/**
 * Describe the shared "safe id" requirements in a human-friendly way.
 *
 * Rationale: the parser extracts ids from markdown, but only the validator
 * enforces that ids are targetable by APIs (which rely on the same rules).
 *
 * This keeps the system consistent:
 * - reads can still parse hand-edited docs
 * - writes can refuse invalid ids until repaired
 * - tool schemas can validate ids up-front
 */
function safeIdExpectationText(): string {
  return 'expected 1..128 chars: first [A-Za-z0-9], then [A-Za-z0-9_-]';
}

/**
 * Validate a plan markdown document and return diagnostics.
 *
 * This is intended for:
 * - interactive feedback (show all issues)
 * - enforcing "safe edits" (edit functions validate their outputs)
 */
export function validatePlanMarkdown(text: string): ValidatePlanResult {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  const errorKeys = new Set<string>();
  const warningKeys = new Set<string>();

  function pushUniqueDiagnostic(
    target: Diagnostic[],
    keySet: Set<string>,
    diagnostic: Diagnostic
  ): void {
    const key = `${diagnostic.severity}:${diagnostic.code}:${diagnostic.line ?? ''}:${
      diagnostic.message
    }`;
    if (keySet.has(key)) return;
    keySet.add(key);
    target.push(diagnostic);
  }

  const lines = text.split(/\r?\n/);
  const headerLine = lines
    .slice(0, Math.min(lines.length, 30))
    .findIndex((line) => line.includes(LONG_TERM_PLAN_FORMAT_HEADER));
  if (headerLine === -1) {
    pushUniqueDiagnostic(
      errors,
      errorKeys,
      errorDiagnostic(
        'MISSING_FORMAT_HEADER',
        `Missing required header: ${LONG_TERM_PLAN_FORMAT_HEADER}`
      )
    );
  }

  const seenIds = new Set<string>();

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';

    const loose = line.match(TASK_LINE_LOOSE_RE);
    if (!loose) continue;

    const symbol = loose[2] ?? '';
    const isAllowedSymbol = symbol === ' ' || symbol === '*' || symbol === '√';
    if (!isAllowedSymbol) {
      pushUniqueDiagnostic(
        errors,
        errorKeys,
        errorDiagnostic(
          'INVALID_STATUS_SYMBOL',
          `Invalid status symbol: ${JSON.stringify(symbol)} (expected ' ', '*', or '√')`,
          lineIndex
        )
      );
      continue;
    }

    const strict = parseTaskLineStrict(line);
    if (!strict) {
      const idMatch = line.match(TASK_ID_TRAILER_RE);
      if (!idMatch) {
        pushUniqueDiagnostic(
          errors,
          errorKeys,
          errorDiagnostic(
            'MISSING_TASK_ID',
            'Task line is missing required trailing id: <!-- long-term-plan:id=... -->',
            lineIndex
          )
        );
        continue;
      }

      const id = idMatch[1] ?? '';
      if (!isSafeId(id)) {
        pushUniqueDiagnostic(
          errors,
          errorKeys,
          errorDiagnostic(
            'INVALID_TASK_ID',
            `Invalid task id: ${JSON.stringify(id)} (${safeIdExpectationText()})`,
            lineIndex
          )
        );
        continue;
      }

      pushUniqueDiagnostic(
        errors,
        errorKeys,
        errorDiagnostic(
          'MALFORMED_TASK_LINE',
          'Task line is malformed (expected: - [ ] title <!-- long-term-plan:id=... -->)',
          lineIndex
        )
      );
      continue;
    }

    if (!isSafeId(strict.id)) {
      pushUniqueDiagnostic(
        errors,
        errorKeys,
        errorDiagnostic(
          'INVALID_TASK_ID',
          `Invalid task id: ${JSON.stringify(strict.id)} (${safeIdExpectationText()})`,
          lineIndex
        )
      );
      continue;
    }

    if (seenIds.has(strict.id)) {
      pushUniqueDiagnostic(
        errors,
        errorKeys,
        errorDiagnostic(
          'DUPLICATE_TASK_ID',
          `Duplicate task id: ${strict.id}`,
          lineIndex
        )
      );
    } else {
      seenIds.add(strict.id);
    }
  }

  const parse = parsePlanMarkdown(text);
  for (const diagnostic of parse.errors) {
    pushUniqueDiagnostic(errors, errorKeys, diagnostic);
  }
  for (const diagnostic of parse.warnings) {
    pushUniqueDiagnostic(warnings, warningKeys, diagnostic);
  }

  if (errors.length === 0 && seenIds.size === 0 && headerLine !== -1) {
    pushUniqueDiagnostic(
      warnings,
      warningKeys,
      warningDiagnostic('NO_TASKS', 'No tasks found in document.')
    );
  }

  return { errors, warnings };
}

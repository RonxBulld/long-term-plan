/**
 * Diagnostics (errors/warnings) produced by parsing/validation.
 *
 * The goal is to keep all "user-facing" feedback structured:
 * - `code`: stable identifier for programmatic handling.
 * - `message`: human-readable description.
 * - `line`: 0-based line index (when applicable).
 */
export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  line?: number; // 0-based
}

/**
 * Helper for building an error diagnostic.
 */
export function errorDiagnostic(
  code: string,
  message: string,
  line?: number
): Diagnostic {
  return { severity: 'error', code, message, line };
}

/**
 * Helper for building a warning diagnostic.
 */
export function warningDiagnostic(
  code: string,
  message: string,
  line?: number
): Diagnostic {
  return { severity: 'warning', code, message, line };
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  line?: number; // 0-based
}

export function errorDiagnostic(
  code: string,
  message: string,
  line?: number
): Diagnostic {
  return { severity: 'error', code, message, line };
}

export function warningDiagnostic(
  code: string,
  message: string,
  line?: number
): Diagnostic {
  return { severity: 'warning', code, message, line };
}


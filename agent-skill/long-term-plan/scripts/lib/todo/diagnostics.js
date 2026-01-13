/**
 * Helper for building an error diagnostic.
 */
export function errorDiagnostic(code, message, line) {
    return { severity: 'error', code, message, line };
}
/**
 * Helper for building a warning diagnostic.
 */
export function warningDiagnostic(code, message, line) {
    return { severity: 'warning', code, message, line };
}
//# sourceMappingURL=diagnostics.js.map
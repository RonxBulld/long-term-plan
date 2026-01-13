/**
 * Convert a normalized task status to its markdown symbol.
 */
export function statusToSymbol(status) {
    if (status === 'todo')
        return ' ';
    if (status === 'doing')
        return '*';
    return '√';
}
/**
 * Convert a markdown status symbol into a normalized task status.
 */
export function symbolToStatus(symbol) {
    if (symbol === ' ')
        return 'todo';
    if (symbol === '*')
        return 'doing';
    return 'done';
}
//# sourceMappingURL=status.js.map
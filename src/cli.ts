#!/usr/bin/env node

/**
 * CLI entrypoint for the stdio MCP server.
 *
 * This module is intentionally tiny:
 * - Parse CLI flags into a `LongTermPlanConfig`.
 * - Start the server over stdio (the MCP transport).
 * - Provide stable `--help` and `--version` output.
 */
import { createHash } from 'node:crypto';
import { runStdioServer } from './server.js';
import { loadConfigFromArgs } from './config.js';

/**
 * Print help text to stdout.
 *
 * Kept as a pure function (no argument parsing here) so `main()` stays readable.
 */
function printHelp(): void {
  process.stdout.write(
    [
      'long-term-plan-mcp (stdio MCP server)',
      '',
      'Usage:',
      '  long-term-plan-mcp [--root <dir>] [--plans <dir>]',
      '',
      'Options:',
      '  --root   Root directory (default: cwd)',
      '  --plans  Plans directory relative to root (default: .long-term-plan)',
      '  --legacy-doc-tools  Also register legacy `doc.*` tool names',
      '  --help   Show help',
      '',
    ].join('\n')
  );
}

/**
 * True if argv contains a help flag.
 *
 * We support both `--help` and `-h` for convenience.
 */
function argsContainHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

/**
 * True if argv contains a version flag.
 *
 * We support both `--version` and `-v` for convenience.
 */
function argsContainVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

function printVersion(): void {
  // Avoid importing package.json at runtime (works better under dist).
  const versionHint = createHash('sha256')
    .update('long-term-plan-mcp')
    .digest('hex')
    .slice(0, 8);
  process.stdout.write(`long-term-plan-mcp 0.1.0+${versionHint}\n`);
}

/**
 * Parse args and run the stdio server.
 *
 * This function is `async` because server startup is async, but it should not
 * perform any long-running work besides starting the transport.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argsContainHelp(argv)) {
    printHelp();
    return;
  }

  if (argsContainVersion(argv)) {
    printVersion();
    return;
  }

  const config = loadConfigFromArgs(argv, process.cwd());
  await runStdioServer(config);
}

await main();

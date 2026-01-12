#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createServer } from './server.js';
import { loadConfigFromArgs } from './config.js';

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
      '  --plans  Plans directory relative to root (default: plans)',
      '  --help   Show help',
      '',
    ].join('\n')
  );
}

function argsContainHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

function argsContainVersion(argv: string[]): boolean {
  return argv.includes('--version') || argv.includes('-v');
}

function printVersion(): void {
  // Avoid importing package.json at runtime (works better under dist)
  const versionHint = createHash('sha256')
    .update('long-term-plan-mcp')
    .digest('hex')
    .slice(0, 8);
  process.stdout.write(`long-term-plan-mcp 0.1.0+${versionHint}\n`);
}

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
  const server = createServer(config);
  await server.run();
}

await main();

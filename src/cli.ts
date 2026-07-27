#!/usr/bin/env node
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { compareDiagnostics, type Diagnostic } from "./diagnostic.js";
import { formatGithubActions } from "./formatters/github-actions.js";
import { formatText } from "./formatters/text.js";
import { lintDirectory } from "./lint.js";

/**
 * The `--format` values line up with the formatter exports (see CONTEXT.md), so
 * the flag string is the lookup key rather than needing a switch.
 */
const formatters = {
  text: formatText,
  github: formatGithubActions,
} as const;

type Format = keyof typeof formatters;

const USAGE = `Usage: winget-manifest-lint [--format text|github] [--strict] <dir>...

Lint one or more winget manifest version directories.

Options:
  --format <text|github>  Output shape. text (default) is for humans; github
                          emits GitHub Actions annotation commands.
  --strict                Promote warnings to errors.

Exit codes:
  0  no diagnostics
  1  diagnostics found
  2  bad usage or unreadable input
`;

/**
 * The side effects `run` needs, injected so its exit-code and formatting logic
 * is testable without spawning a process or touching the real filesystem. The
 * shebang tail below wires the real `process` streams and `lintDirectory`.
 */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  lint: (directory: string) => Promise<Diagnostic[]>;
}

/**
 * Parse argv, lint each directory, render, and return the process exit code:
 * `0` clean, `1` diagnostics found, `2` bad usage or unreadable input. It never
 * calls `process.exit` — the caller owns that — so it stays pure enough to test.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  let values: { format: string; strict: boolean };
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        format: { type: "string", default: "text" },
        strict: { type: "boolean", default: false },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    return usageError(io, describe(error));
  }

  if (!isFormat(values.format)) {
    return usageError(io, `Unknown --format ${values.format}. Expected "text" or "github".`);
  }
  if (positionals.length === 0) {
    return usageError(io, "Expected at least one manifest directory.");
  }

  const diagnostics: Diagnostic[] = [];
  for (const directory of positionals) {
    try {
      diagnostics.push(...(await io.lint(directory)));
    } catch (error) {
      io.stderr(`Could not read ${directory}: ${describe(error)}\n`);
      return 2;
    }
  }

  const rendered = values.strict ? diagnostics.map(promote) : diagnostics;
  rendered.sort(compareDiagnostics);

  const output = formatters[values.format](rendered);
  io.stdout(output.endsWith("\n") || output === "" ? output : `${output}\n`);

  return diagnostics.length === 0 ? 0 : 1;
}

/** Under `--strict`, every warning is treated as an error. */
function promote(diagnostic: Diagnostic): Diagnostic {
  return diagnostic.severity === "warning" ? { ...diagnostic, severity: "error" } : diagnostic;
}

function usageError(io: CliIo, message: string): 2 {
  io.stderr(`${message}\n\n${USAGE}`);
  return 2;
}

function isFormat(value: string): value is Format {
  return value in formatters;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Only run as a CLI, not when imported by a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2), {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    lint: (directory) => lintDirectory(directory),
  }).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`${describe(error)}\n`);
      process.exitCode = 2;
    },
  );
}

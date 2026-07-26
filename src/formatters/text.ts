import { compareDiagnostics, type Diagnostic } from "../diagnostic.js";

/**
 * Render diagnostics for a terminal. Output carries no ANSI colour so it stays
 * snapshot-testable; a colour layer, if it ever exists, wraps this.
 *
 * Each diagnostic is one line:
 *
 *     file.yaml:12:5  error  message  [rule-id]
 *
 * Lines are grouped by file (blank line between groups) and the whole report
 * ends with a summary counting errors and warnings. An unpositioned diagnostic
 * — one about a file as a whole — renders without the `:line:col`.
 */
export function formatText(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return "No problems found.\n";

  const sorted = [...diagnostics].sort(compareDiagnostics);

  const groups: string[] = [];
  let currentFile: string | undefined;
  let lines: string[] = [];

  const flush = () => {
    if (lines.length > 0) groups.push(lines.join("\n"));
    lines = [];
  };

  for (const d of sorted) {
    if (d.file !== currentFile) {
      flush();
      currentFile = d.file;
    }
    const location = d.position
      ? `${d.file}:${d.position.line}:${d.position.column}`
      : d.file;
    lines.push(`${location}  ${d.severity}  ${d.message}  [${d.ruleId}]`);
  }
  flush();

  const errors = sorted.filter((d) => d.severity === "error").length;
  const warnings = sorted.length - errors;
  const summary = `${errors} ${plural(errors, "error")}, ${warnings} ${plural(warnings, "warning")}`;

  return `${groups.join("\n\n")}\n\n${summary}\n`;
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

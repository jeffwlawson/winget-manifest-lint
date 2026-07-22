/**
 * A diagnostic is the only thing a rule may produce. Rules never print, never
 * throw, and never exit — they return diagnostics and the formatter decides how
 * they surface. That keeps rules trivially testable.
 */

export type Severity = "error" | "warning";

/** 1-based, matching every editor and the `::error line=` annotation format. */
export interface Position {
  line: number;
  column: number;
}

export interface Diagnostic {
  /** Stable kebab-case id, e.g. `installer-sha256-format`. Never renamed. */
  ruleId: string;
  severity: Severity;
  message: string;
  /** File name relative to the manifest directory, e.g. `sharkdp.bat.installer.yaml`. */
  file: string;
  /**
   * Omitted when a diagnostic is about a file as a whole (a missing file, an
   * unparseable one) rather than a location inside it.
   */
  position?: Position;
}

/**
 * Diagnostics sort by file, then position. Unpositioned diagnostics sort first
 * within their file — they are usually the reason the positioned ones exist.
 */
export function compareDiagnostics(a: Diagnostic, b: Diagnostic): number {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (!a.position && !b.position) return 0;
  if (!a.position) return -1;
  if (!b.position) return 1;
  return a.position.line - b.position.line || a.position.column - b.position.column;
}

import type { Diagnostic } from "../diagnostic.js";

/**
 * Render diagnostics as GitHub Actions workflow commands so they surface as
 * inline annotations on a pull request. Errors become `::error`, warnings
 * `::warning`; a diagnostic with a position carries `line=`/`col=`, and one
 * about a file as a whole carries `file=` only.
 *
 * See https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
 */
export function formatGithubActions(diagnostics: readonly Diagnostic[]): string {
  return diagnostics.map(formatOne).join("\n");
}

function formatOne(diagnostic: Diagnostic): string {
  const properties = [`file=${escapeProperty(diagnostic.file)}`];
  if (diagnostic.position) {
    properties.push(`line=${diagnostic.position.line}`, `col=${diagnostic.position.column}`);
  }
  return `::${diagnostic.severity} ${properties.join(",")}::${escapeData(diagnostic.message)}`;
}

/**
 * Escape a command's message. The Actions runner treats `%`, CR and LF
 * specially, so they are percent-encoded; `%` goes first or it would double
 * up the encodings that follow.
 */
function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Escape a command property value. Beyond the message escapes, `:` and `,`
 * would otherwise be read as property delimiters.
 */
function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

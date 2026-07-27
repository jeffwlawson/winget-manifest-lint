import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic.js";
import { formatText } from "../../src/formatters/text.js";

const diag = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: "some-rule",
  severity: "error",
  message: "something is wrong",
  file: "Publisher.Package.yaml",
  ...over,
});

describe("formatText", () => {
  it("renders a positioned diagnostic as file:line:col  severity  message  [rule-id]", () => {
    const out = formatText([
      diag({
        file: "Publisher.Package.installer.yaml",
        position: { line: 12, column: 5 },
        severity: "error",
        message: "InstallerSha256 must be 64 hex characters",
        ruleId: "installer-sha256-format",
      }),
    ]);
    expect(out).toContain(
      "Publisher.Package.installer.yaml:12:5  error  InstallerSha256 must be 64 hex characters  [installer-sha256-format]",
    );
  });

  it("omits :line:col for an unpositioned diagnostic", () => {
    const out = formatText([
      diag({ file: "Publisher.Package.yaml", message: "file is missing", ruleId: "installers-non-empty" }),
    ]);
    expect(out).toContain("Publisher.Package.yaml  error  file is missing  [installers-non-empty]");
    expect(out).not.toContain(".yaml:");
  });

  it("groups diagnostics by file, separated by a blank line", () => {
    const out = formatText([
      diag({ file: "a.yaml", position: { line: 1, column: 1 }, ruleId: "r1" }),
      diag({ file: "b.yaml", position: { line: 2, column: 2 }, ruleId: "r2" }),
    ]);
    const lines = out.split("\n");
    const aIndex = lines.findIndex((l) => l.startsWith("a.yaml"));
    const bIndex = lines.findIndex((l) => l.startsWith("b.yaml"));
    expect(aIndex).toBeGreaterThanOrEqual(0);
    expect(bIndex).toBeGreaterThan(aIndex);
    expect(lines[aIndex + 1]).toBe("");
  });

  it("sorts diagnostics into a stable order regardless of input order", () => {
    const out = formatText([
      diag({ file: "b.yaml", position: { line: 1, column: 1 }, ruleId: "r2" }),
      diag({ file: "a.yaml", position: { line: 9, column: 1 }, ruleId: "r1" }),
      diag({ file: "a.yaml", position: { line: 1, column: 1 }, ruleId: "r0" }),
    ]);
    const files = out
      .split("\n")
      .filter((l) => l.includes("[r"))
      .map((l) => l.split(/\s+/)[0]);
    expect(files).toEqual(["a.yaml:1:1", "a.yaml:9:1", "b.yaml:1:1"]);
  });

  it("ends with a summary line counting errors and warnings", () => {
    const out = formatText([
      diag({ severity: "error" }),
      diag({ severity: "error" }),
      diag({ severity: "warning" }),
    ]);
    expect(out.trimEnd().endsWith("2 errors, 1 warning")).toBe(true);
  });

  it("pluralises the summary counts correctly", () => {
    const out = formatText([diag({ severity: "warning" })]);
    expect(out.trimEnd().endsWith("0 errors, 1 warning")).toBe(true);
  });

  it("reports a clean run when there are no diagnostics", () => {
    expect(formatText([])).toBe("No problems found.\n");
  });
});

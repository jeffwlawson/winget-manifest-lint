import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../../src/diagnostic.js";
import { formatGithubActions } from "../../src/formatters/github-actions.js";

const diagnostic = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: "installer-sha256-format",
  severity: "error",
  message: "Installers[0].InstallerSha256 is not a 64-character hex digest",
  file: "Publisher.Package.installer.yaml",
  position: { line: 5, column: 3 },
  ...over,
});

/** Strip the position — `exactOptionalPropertyTypes` forbids passing `undefined`. */
const unpositioned = (over: Partial<Diagnostic> = {}): Diagnostic => {
  const { position, ...rest } = diagnostic(over);
  void position;
  return rest;
};

describe("formatGithubActions", () => {
  it("emits ::error with file, line and col for a positioned error", () => {
    expect(formatGithubActions([diagnostic()])).toBe(
      "::error file=Publisher.Package.installer.yaml,line=5,col=3::" +
        "Installers[0].InstallerSha256 is not a 64-character hex digest",
    );
  });

  it("emits ::warning for a warning severity", () => {
    const out = formatGithubActions([diagnostic({ severity: "warning" })]);
    expect(out.startsWith("::warning ")).toBe(true);
  });

  it("emits file= only for an unpositioned diagnostic", () => {
    expect(formatGithubActions([unpositioned()])).toBe(
      "::error file=Publisher.Package.installer.yaml::" +
        "Installers[0].InstallerSha256 is not a 64-character hex digest",
    );
  });

  it("escapes %, CR and LF in the message per the Actions spec", () => {
    const out = formatGithubActions([unpositioned({ message: "100% done\r\nnext line" })]);
    expect(out).toBe("::error file=Publisher.Package.installer.yaml::100%25 done%0D%0Anext line");
  });

  it("emits one line per diagnostic", () => {
    const out = formatGithubActions([
      diagnostic(),
      unpositioned({ file: "Publisher.Package.locale.en-US.yaml" }),
    ]);
    expect(out.split("\n")).toHaveLength(2);
  });

  it("returns an empty string for no diagnostics", () => {
    expect(formatGithubActions([])).toBe("");
  });
});

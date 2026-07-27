import { describe, expect, it } from "vitest";
import type { Diagnostic } from "../src/diagnostic.js";
import { run, type CliIo } from "../src/cli.js";

/**
 * The CLI is the tool's one impure boundary: it reads directories, prints, and
 * chooses an exit code. `run` factors the decision logic out of that boundary —
 * argv in, injected `lint`/streams, exit code out — so the codes and formatting
 * are testable without spawning a process. The shebang tail wires the real
 * `lintDirectory` and `process` to it.
 */

const diagnostic = (over: Partial<Diagnostic> = {}): Diagnostic => ({
  ruleId: "example-rule",
  severity: "warning",
  message: "something",
  file: "a.yaml",
  ...over,
});

interface Captured {
  code: number;
  out: string;
  err: string;
}

const invoke = async (
  argv: string[],
  lint: CliIo["lint"] = async () => [],
): Promise<Captured> => {
  let out = "";
  let err = "";
  const code = await run(argv, {
    stdout: (text) => {
      out += text;
    },
    stderr: (text) => {
      err += text;
    },
    lint,
  });
  return { code, out, err };
};

describe("run", () => {
  it("exits 0 and reports no problems for a clean directory", async () => {
    const { code, out } = await invoke(["some/dir"], async () => []);
    expect(code).toBe(0);
    expect(out).toContain("No problems found.");
  });

  it("exits 1 when diagnostics are found", async () => {
    const { code, out } = await invoke(["some/dir"], async () => [
      diagnostic({ severity: "error", message: "bad hash" }),
    ]);
    expect(code).toBe(1);
    expect(out).toContain("bad hash");
  });

  it("lints every positional directory", async () => {
    const seen: string[] = [];
    const { code } = await invoke(["one", "two"], async (dir) => {
      seen.push(dir);
      return [];
    });
    expect(code).toBe(0);
    expect(seen).toEqual(["one", "two"]);
  });

  it("defaults to text format", async () => {
    const { out } = await invoke(["d"], async () => [
      diagnostic({ severity: "error", message: "boom" }),
    ]);
    expect(out).toContain("[example-rule]");
    expect(out).not.toContain("::error");
  });

  it("emits GitHub Actions commands with --format github", async () => {
    const { out } = await invoke(["--format", "github", "d"], async () => [
      diagnostic({ severity: "error", message: "boom", position: { line: 3, column: 5 } }),
    ]);
    expect(out).toContain("::error file=a.yaml,line=3,col=5::boom");
  });

  it("promotes warnings to errors under --strict", async () => {
    const warningOnly: CliIo["lint"] = async () => [
      diagnostic({ severity: "warning", message: "iffy" }),
    ];

    const relaxed = await invoke(["d"], warningOnly);
    expect(relaxed.out).toContain("warning");

    const strict = await invoke(["--strict", "d"], warningOnly);
    expect(strict.out).toContain("error");
    expect(strict.out).not.toContain("warning  iffy");
  });

  it("promotes warnings to errors under --strict in github format", async () => {
    const { out } = await invoke(["--strict", "--format", "github", "d"], async () => [
      diagnostic({ severity: "warning", message: "iffy" }),
    ]);
    expect(out).toContain("::error ");
    expect(out).not.toContain("::warning");
  });

  it("exits 2 with usage when no directory is given", async () => {
    const { code, err } = await invoke([]);
    expect(code).toBe(2);
    expect(err).toContain("Usage");
  });

  it("exits 2 for an unknown --format value", async () => {
    const { code, err } = await invoke(["--format", "xml", "d"]);
    expect(code).toBe(2);
    expect(err).toContain("format");
  });

  it("exits 2 for an unknown flag", async () => {
    const { code } = await invoke(["--nope", "d"]);
    expect(code).toBe(2);
  });

  it("exits 2 when a directory is unreadable", async () => {
    const { code, err } = await invoke(["missing"], async () => {
      throw new Error("ENOENT: no such file or directory");
    });
    expect(code).toBe(2);
    expect(err).toContain("missing");
  });
});

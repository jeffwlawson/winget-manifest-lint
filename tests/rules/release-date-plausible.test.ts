import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import type { RuleContext } from "../../src/rules/rule.js";
import rule from "../../src/rules/release-date-plausible.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => join(here, "..", "fixtures", ...parts);

// A fixed clock so the future/old bounds are deterministic regardless of when
// the suite runs. Rules never read the clock themselves — it is injected.
const NOW = new Date("2026-07-25T12:00:00Z");
const context: RuleContext = { now: NOW };

/** Build a package whose single installer file holds the given YAML body. */
function packageWithInstaller(body: string): ManifestPackage {
  const source = `PackageIdentifier: Publisher.Package\nPackageVersion: 1.0.0\n${body}ManifestType: installer\nManifestVersion: 1.6.0\n`;
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  return {
    directory: "/virtual/1.0.0",
    directoryVersion: "1.0.0",
    files: [
      {
        fileName: "Publisher.Package.installer.yaml",
        role: "installer",
        data: doc.toJS() as Record<string, unknown>,
        doc,
        lineCounter,
      },
    ],
  };
}

describe("release-date-plausible", () => {
  it("passes a real manifest with a plausible ReleaseDate", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "Contoso.ReleaseDate", "1.0.0"));
    expect(rule.check(pkg, context)).toEqual([]);
  });

  it("flags a real manifest whose ReleaseDate predates 2015", async () => {
    const { pkg } = await parseManifestDirectory(
      fixture("invalid", "Contoso.OldReleaseDate", "1.0.0"),
    );
    const diagnostics = rule.check(pkg, context);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "release-date-plausible",
      severity: "warning",
      file: "Contoso.OldReleaseDate.installer.yaml",
    });
    expect(diagnostics[0]?.message).toContain("2015-01-01");
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it("passes when there is no ReleaseDate at all", () => {
    const pkg = packageWithInstaller("InstallerType: msi\nInstallers:\n- Architecture: x64\n");
    expect(rule.check(pkg, context)).toEqual([]);
  });

  it("passes a root ReleaseDate exactly on the 2015-01-01 boundary", () => {
    const pkg = packageWithInstaller("ReleaseDate: 2015-01-01\n");
    expect(rule.check(pkg, context)).toEqual([]);
  });

  it("passes a ReleaseDate equal to today", () => {
    // 2026-07-25 at UTC midnight is not after the noon `now`, so not "future".
    const pkg = packageWithInstaller("ReleaseDate: 2026-07-25\n");
    expect(rule.check(pkg, context)).toEqual([]);
  });

  it("warns when the ReleaseDate is in the future", () => {
    const pkg = packageWithInstaller("ReleaseDate: 2026-07-26\n");
    const diagnostics = rule.check(pkg, context);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("warning");
    expect(diagnostics[0]?.message).toContain("in the future");
  });

  it("warns when the ReleaseDate is before 2015-01-01", () => {
    const pkg = packageWithInstaller("ReleaseDate: 2014-12-31\n");
    const diagnostics = rule.check(pkg, context);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("implausibly old");
  });

  it.each(["2024-1-5", "2024-13-01", "2024-02-30", "not-a-date", "2024/01/15", "20240115"])(
    "warns that %s is not a valid ISO date",
    (value) => {
      const pkg = packageWithInstaller(`ReleaseDate: "${value}"\n`);
      const diagnostics = rule.check(pkg, context);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("not a valid ISO 8601 date");
    },
  );

  it("judges a per-installer ReleaseDate, pointing at that installer", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n- Architecture: x86\n  ReleaseDate: 2099-01-01\n",
    );
    const diagnostics = rule.check(pkg, context);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("in the future");
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it("flags both a bad root date and a bad per-installer date", () => {
    const pkg = packageWithInstaller(
      "ReleaseDate: 2010-01-01\nInstallers:\n- Architecture: x64\n  ReleaseDate: 2099-01-01\n",
    );
    const diagnostics = rule.check(pkg, context);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.message).join(" ")).toContain("implausibly old");
    expect(diagnostics.map((d) => d.message).join(" ")).toContain("in the future");
  });

  it("says nothing when there is no installer file", () => {
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [] }, context)).toEqual(
      [],
    );
  });

  it("says nothing when no clock is injected — a rule never invents one", () => {
    const pkg = packageWithInstaller("ReleaseDate: 2099-01-01\n");
    expect(rule.check(pkg)).toEqual([]);
  });
});

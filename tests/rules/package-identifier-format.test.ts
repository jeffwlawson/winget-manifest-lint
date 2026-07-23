import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/package-identifier-format.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => join(here, "..", "fixtures", ...parts);

/**
 * Build a package with a single version file carrying `identifier`, parsed the
 * same way the real parser does. Boundary cases (segment counts and the length
 * limit) are cheaper to express this way than as a fixture directory each.
 */
function packageWithIdentifier(identifier: string): ManifestPackage {
  const source = `PackageIdentifier: ${identifier}\nManifestType: version\nManifestVersion: 1.6.0\n`;
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  return {
    directory: "/virtual",
    directoryVersion: "1.0.0",
    files: [
      {
        fileName: "Publisher.Package.yaml",
        role: "version",
        data: doc.toJS() as Record<string, unknown>,
        doc,
        lineCounter,
      },
    ],
  };
}

describe("package-identifier-format", () => {
  it("passes a well-formed identifier in a real manifest", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a single-segment identifier in a real manifest", async () => {
    const { pkg } = await parseManifestDirectory(fixture("invalid", "sharkdp", "0.26.1"));
    const diagnostics = rule.check(pkg);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "package-identifier-format",
      severity: "error",
      file: "sharkdp.yaml",
    });
    expect(diagnostics[0]?.message).toContain("2 to 8 dot-separated segments");
    // Reports on the version file only, not on all three copies.
    expect(diagnostics.map((d) => d.file)).toEqual(["sharkdp.yaml"]);
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it.each(["Publisher.Package", "A.B.C", "A.B.C.D", "A.B.C.D.E", "A.B.C.D.E.F.G.H"])(
    "accepts %s (2 to 8 segments)",
    (identifier) => {
      expect(rule.check(packageWithIdentifier(identifier))).toEqual([]);
    },
  );

  it.each(["singlesegment", "A.B.C.D.E.F.G.H.I"])(
    "rejects %s (wrong segment count)",
    (identifier) => {
      const diagnostics = rule.check(packageWithIdentifier(identifier));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("dot-separated segments");
    },
  );

  it("accepts an identifier exactly at the 128-character limit", () => {
    const identifier = `Pub.${"a".repeat(124)}`; // 4 + 124 = 128
    expect(identifier).toHaveLength(128);
    expect(rule.check(packageWithIdentifier(identifier))).toEqual([]);
  });

  it("rejects an identifier over the 128-character limit", () => {
    const identifier = `Pub.${"a".repeat(125)}`; // 4 + 125 = 129, still 2 segments
    const diagnostics = rule.check(packageWithIdentifier(identifier));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("128-character limit");
  });

  it("reports both problems when segment count and length are wrong", () => {
    const identifier = "a".repeat(130); // 1 segment and 130 characters
    const diagnostics = rule.check(packageWithIdentifier(identifier));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.message).join(" ")).toMatch(/segments[\s\S]*limit|limit[\s\S]*segments/);
  });

  it("says nothing when there is no version file", () => {
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [] })).toEqual([]);
  });

  it("says nothing when PackageIdentifier is absent or not a string", () => {
    const missing = packageWithIdentifier("").files[0]!;
    missing.data = {};
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [missing] })).toEqual([]);

    missing.data = { PackageIdentifier: 42 };
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [missing] })).toEqual([]);
  });
});

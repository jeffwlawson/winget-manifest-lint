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
    // Built from segments of <=32 chars so only the total-length bound is in
    // play: 32+32+32+29 + 3 dots = 128.
    const seg = "a".repeat(32);
    const identifier = `${seg}.${seg}.${seg}.${"a".repeat(29)}`;
    expect(identifier).toHaveLength(128);
    expect(rule.check(packageWithIdentifier(identifier))).toEqual([]);
  });

  it("rejects an identifier over the 128-character limit", () => {
    // 32+32+32+30 + 3 dots = 129; every segment still within range, so the
    // only violation is total length.
    const seg = "a".repeat(32);
    const identifier = `${seg}.${seg}.${seg}.${"a".repeat(30)}`;
    expect(identifier).toHaveLength(129);
    const diagnostics = rule.check(packageWithIdentifier(identifier));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("128-character limit");
  });

  it("reports both problems when segment count and total length are wrong", () => {
    // 9 segments of 20 chars: too many segments AND over 128 total, but each
    // segment is individually within range, so exactly two problems.
    const identifier = Array.from({ length: 9 }, () => "a".repeat(20)).join(".");
    const diagnostics = rule.check(packageWithIdentifier(identifier));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.message).join(" ")).toMatch(/segments[\s\S]*limit|limit[\s\S]*segments/);
  });

  it.each([".Package", "Publisher.", "Pub..Package"])(
    "rejects %s (empty segment)",
    (identifier) => {
      const diagnostics = rule.check(packageWithIdentifier(identifier));
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]?.message).toContain("empty segment");
    },
  );

  it("rejects a segment longer than 32 characters", () => {
    const identifier = `Pub.${"a".repeat(33)}`; // 2 segments, second is 33 chars
    const diagnostics = rule.check(packageWithIdentifier(identifier));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("each segment must be 1 to 32 characters");
  });

  it("accepts a segment exactly 32 characters", () => {
    const identifier = `Pub.${"a".repeat(32)}`;
    expect(rule.check(packageWithIdentifier(identifier))).toEqual([]);
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

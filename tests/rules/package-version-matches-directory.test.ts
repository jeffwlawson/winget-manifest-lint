import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/package-version-matches-directory.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => join(here, "..", "fixtures", ...parts);

/**
 * Build a package whose single version file carries `version`, sitting in a
 * directory named `directoryVersion`, parsed the way the real parser does.
 */
function packageWithVersion(version: string, directoryVersion: string): ManifestPackage {
  const source = `PackageIdentifier: Publisher.Package\nPackageVersion: ${JSON.stringify(
    version,
  )}\nManifestType: version\nManifestVersion: 1.6.0\n`;
  const lineCounter = new LineCounter();
  const doc = parseDocument(source, { lineCounter });
  return {
    directory: `/virtual/${directoryVersion}`,
    directoryVersion,
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

describe("package-version-matches-directory", () => {
  it("passes when PackageVersion equals the directory name in a real manifest", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a PackageVersion that disagrees with the directory in a real manifest", async () => {
    const { pkg } = await parseManifestDirectory(
      fixture("invalid", "Contoso.VersionMismatch", "1.0.0"),
    );
    const diagnostics = rule.check(pkg);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "package-version-matches-directory",
      severity: "error",
      file: "Contoso.VersionMismatch.yaml",
    });
    expect(diagnostics[0]?.message).toContain('"2.0.0"');
    expect(diagnostics[0]?.message).toContain('"1.0.0"');
    // Reports on the version file only, not on all three copies.
    expect(diagnostics.map((d) => d.file)).toEqual(["Contoso.VersionMismatch.yaml"]);
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it("accepts an exact match", () => {
    expect(rule.check(packageWithVersion("1.2.3", "1.2.3"))).toEqual([]);
  });

  it("rejects a mismatch", () => {
    const diagnostics = rule.check(packageWithVersion("1.2.3", "1.2.4"));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('"1.2.3"');
    expect(diagnostics[0]?.message).toContain('"1.2.4"');
  });

  it("says nothing when there is no version file", () => {
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [] })).toEqual([]);
  });

  it("says nothing when PackageVersion is absent or not a string", () => {
    const file = packageWithVersion("1.0.0", "1.0.0").files[0]!;
    file.data = {};
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [file] })).toEqual([]);

    file.data = { PackageVersion: 42 };
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [file] })).toEqual([]);
  });
});

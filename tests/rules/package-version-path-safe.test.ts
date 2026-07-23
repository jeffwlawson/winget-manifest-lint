import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/package-version-path-safe.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => join(here, "..", "fixtures", ...parts);

/**
 * Build a package with a single version file carrying `version`, parsed the
 * same way the real parser does. The individual unsafe characters are cheaper
 * to express this way than as a fixture directory each — and several of them
 * (control characters) cannot appear in a real directory name at all.
 */
function packageWithVersion(version: string): ManifestPackage {
  const source = `PackageIdentifier: Publisher.Package\nPackageVersion: ${JSON.stringify(
    version,
  )}\nManifestType: version\nManifestVersion: 1.6.0\n`;
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

describe("package-version-path-safe", () => {
  it("passes a well-formed version in a real manifest", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a path-unsafe version in a real manifest", async () => {
    const { pkg } = await parseManifestDirectory(
      fixture("invalid", "Contoso.PathUnsafeVersion", "1.0.0"),
    );
    const diagnostics = rule.check(pkg);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "package-version-path-safe",
      severity: "error",
      file: "Contoso.PathUnsafeVersion.yaml",
    });
    expect(diagnostics[0]?.message).toContain('":"');
    // Reports on the version file only, not on all three copies.
    expect(diagnostics.map((d) => d.file)).toEqual(["Contoso.PathUnsafeVersion.yaml"]);
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it.each(["0.26.1", "1.0.0-beta.1", "2024.03.15", "v1_2_3", "1.0.0+build.7"])(
    "accepts %s (no path-unsafe characters)",
    (version) => {
      expect(rule.check(packageWithVersion(version))).toEqual([]);
    },
  );

  it.each([
    ["1.0/2", '"/"'],
    ["1.0\\2", '"\\"'],
    ["1:0", '":"'],
    ["1.0*", '"*"'],
    ["1.0?", '"?"'],
    ['1.0"', '"""'],
    ["1<0", '"<"'],
    ["1>0", '">"'],
    ["1|0", '"|"'],
  ])("rejects %s", (version, needle) => {
    const diagnostics = rule.check(packageWithVersion(version));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain(needle);
  });

  it("names a control character by its code point", () => {
    const diagnostics = rule.check(packageWithVersion(`1.0${String.fromCharCode(1)}`));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("U+0001");
  });

  it("reports each distinct unsafe character once, in order of appearance", () => {
    const diagnostics = rule.check(packageWithVersion("1:0/0:1"));
    expect(diagnostics).toHaveLength(1);
    const message = diagnostics[0]?.message ?? "";
    expect(message).toContain("characters");
    expect(message.indexOf('":"')).toBeLessThan(message.indexOf('"/"'));
    // The repeated colon is only listed once.
    expect(message.match(/":"/g)).toHaveLength(1);
  });

  it("says nothing when there is no version file", () => {
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [] })).toEqual([]);
  });

  it("says nothing when PackageVersion is absent or not a string", () => {
    const missing = packageWithVersion("1.0.0").files[0]!;
    missing.data = {};
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [missing] })).toEqual([]);

    missing.data = { PackageVersion: 42 };
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [missing] })).toEqual([]);
  });
});

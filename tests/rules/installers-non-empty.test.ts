import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/installers-non-empty.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (...parts: string[]) => join(here, "..", "fixtures", ...parts);

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

describe("installers-non-empty", () => {
  it("passes a real manifest that declares installers", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("passes when Installers holds at least one entry", () => {
    const pkg = packageWithInstaller("Installers:\n- Architecture: x64\n");
    expect(rule.check(pkg)).toEqual([]);
  });

  it("errors when Installers is missing", () => {
    const pkg = packageWithInstaller("");
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "installers-non-empty",
      severity: "error",
      file: "Publisher.Package.installer.yaml",
    });
    expect(diagnostics[0]?.message).toContain("missing");
    // A missing key has nothing to point at.
    expect(diagnostics[0]?.position).toBeUndefined();
  });

  it("errors when Installers is an empty array", () => {
    const pkg = packageWithInstaller("Installers: []\n");
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("empty");
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it("errors when Installers is not an array", () => {
    const pkg = packageWithInstaller("Installers: nope\n");
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("not a list");
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it("says nothing when there is no installer file", () => {
    expect(
      rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [] }),
    ).toEqual([]);
  });
});

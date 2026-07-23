import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/installer-architecture-type-scope-unique.js";

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

describe("installer-architecture-type-scope-unique", () => {
  it("passes a real manifest whose installers differ by architecture", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a real manifest with a repeated (Architecture, InstallerType, Scope) tuple", async () => {
    const { pkg } = await parseManifestDirectory(
      fixture("invalid", "Contoso.DuplicateInstaller", "1.0.0"),
    );
    const diagnostics = rule.check(pkg);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "installer-architecture-type-scope-unique",
      severity: "error",
      file: "Contoso.DuplicateInstaller.installer.yaml",
    });
    // Points at the duplicate (the third installer), not the first occurrence.
    expect(diagnostics[0]?.position).toBeDefined();
    expect(diagnostics[0]?.message).toContain("x64");
    expect(diagnostics[0]?.message).toContain("msi");
    expect(diagnostics[0]?.message).toContain("machine");
  });

  it("passes when architectures differ", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n- Architecture: x86\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("passes when scope disambiguates otherwise-identical installers", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n  Scope: user\n- Architecture: x64\n  Scope: machine\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("resolves InstallerType and Scope from the installer entry over the root default", () => {
    // Both installers are x64; the first inherits the root msi, the second
    // overrides to exe — so the tuples differ and this is valid.
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n- Architecture: x64\n  InstallerType: exe\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a duplicate that arises only after applying the root default type", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n- Architecture: x64\n  InstallerType: msi\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("msi");
  });

  it("treats two installers with no type or scope as duplicates when architecture matches", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n- Architecture: x64\n",
    );
    expect(rule.check(pkg)).toHaveLength(1);
  });

  it("reports each distinct duplicated tuple once", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n- Architecture: x86\n- Architecture: x64\n- Architecture: x86\n",
    );
    expect(rule.check(pkg)).toHaveLength(2);
  });

  it("says nothing when there is no installer file", () => {
    expect(rule.check({ directory: "/x", directoryVersion: "1.0.0", files: [] })).toEqual([]);
  });

  it("says nothing when Installers is absent or not an array", () => {
    const pkg = packageWithInstaller("");
    const file = pkg.files[0]!;
    file.data = {};
    expect(rule.check(pkg)).toEqual([]);

    file.data = { Installers: "nope" };
    expect(rule.check(pkg)).toEqual([]);
  });
});

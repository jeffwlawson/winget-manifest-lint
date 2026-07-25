import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/nested-installer-compatibility.js";

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

describe("nested-installer-compatibility", () => {
  it("passes a real archive manifest with root-level nested fields", async () => {
    // sharkdp.bat is a zip whose NestedInstallerType/NestedInstallerFiles sit at
    // the root and every installer inherits them.
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a real archive manifest missing both nested fields", async () => {
    const { pkg } = await parseManifestDirectory(
      fixture("invalid", "Contoso.NestedInstaller", "1.0.0"),
    );
    const diagnostics = rule.check(pkg);

    expect(diagnostics).toHaveLength(2);
    for (const d of diagnostics) {
      expect(d).toMatchObject({
        ruleId: "nested-installer-compatibility",
        severity: "error",
        file: "Contoso.NestedInstaller.installer.yaml",
      });
    }
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("NestedInstallerType");
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("NestedInstallerFiles");
  });

  it("passes when nested fields are declared per installer", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n  InstallerType: zip\n  NestedInstallerType: exe\n  NestedInstallerFiles:\n  - RelativeFilePath: app\\tool.exe\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("errors on an archive installer missing NestedInstallerType", () => {
    const pkg = packageWithInstaller(
      "InstallerType: zip\nInstallers:\n- Architecture: x64\n  NestedInstallerFiles:\n  - RelativeFilePath: app\\tool.exe\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("no NestedInstallerType");
  });

  it("errors on an archive installer missing NestedInstallerFiles", () => {
    const pkg = packageWithInstaller(
      "InstallerType: zip\nNestedInstallerType: exe\nInstallers:\n- Architecture: x64\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("NestedInstallerFiles");
  });

  it("errors when NestedInstallerFiles has no entry with a RelativeFilePath", () => {
    const pkg = packageWithInstaller(
      "InstallerType: zip\nNestedInstallerType: exe\nNestedInstallerFiles:\n- PortableCommandAlias: tool\nInstallers:\n- Architecture: x64\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("RelativeFilePath");
  });

  it("errors when nested fields appear on a non-archive installer", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msi\nInstallers:\n- Architecture: x64\n  NestedInstallerType: exe\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("non-archive");
    expect(diagnostics[0]?.message).toContain("NestedInstallerType");
  });

  it("errors when a per-installer type override drops an archive to a non-archive holding nested fields", () => {
    // Root is zip with nested defaults; this installer overrides to exe, so the
    // inherited nested fields no longer apply.
    const pkg = packageWithInstaller(
      "InstallerType: zip\nNestedInstallerType: exe\nNestedInstallerFiles:\n- RelativeFilePath: app\\tool.exe\nInstallers:\n- Architecture: x64\n  InstallerType: exe\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("non-archive");
  });

  it("passes when a per-installer type override lifts a non-archive default to an archive with nested fields", () => {
    const pkg = packageWithInstaller(
      "InstallerType: exe\nInstallers:\n- Architecture: x64\n- Architecture: x86\n  InstallerType: zip\n  NestedInstallerType: exe\n  NestedInstallerFiles:\n  - RelativeFilePath: app\\tool.exe\n",
    );
    expect(rule.check(pkg)).toEqual([]);
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

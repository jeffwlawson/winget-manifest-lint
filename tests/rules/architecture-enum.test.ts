import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/architecture-enum.js";

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

describe("architecture-enum", () => {
  it("passes a real manifest whose architectures are all in the enum", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("passes every allowed architecture", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x86\n- Architecture: x64\n- Architecture: arm\n- Architecture: arm64\n- Architecture: neutral\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("errors on an architecture outside the set", () => {
    const pkg = packageWithInstaller("Installers:\n- Architecture: sparc\n");
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "architecture-enum",
      severity: "error",
      file: "Publisher.Package.installer.yaml",
    });
    expect(diagnostics[0]?.position).toBeDefined();
    expect(diagnostics[0]?.message).toContain("sparc");
  });

  it("errors on a case variant of an allowed architecture", () => {
    // winget's schema pins the enum to lower-case spellings, so `X64` is rejected
    // even though it names an otherwise-valid architecture.
    const pkg = packageWithInstaller("Installers:\n- Architecture: X64\n");
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("X64");
  });

  it("flags each offending installer independently", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n- Architecture: ARM64\n- Architecture: mips\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("ARM64");
    expect(diagnostics.map((d) => d.message).join("\n")).toContain("mips");
  });

  it("says nothing about a missing or non-string Architecture", () => {
    // A required-field rule owns absence; this rule only judges values it sees.
    const pkg = packageWithInstaller("Installers:\n- InstallerType: exe\n- Architecture: 64\n");
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

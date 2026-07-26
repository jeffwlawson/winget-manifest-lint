import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { LineCounter, parseDocument } from "yaml";
import { parseManifestDirectory, type ManifestPackage } from "../../src/manifest.js";
import rule from "../../src/rules/installer-sha256-format.js";

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

const HASH = "3f2a1c9e7b4d6058ae1f92c3d47b8e05619fa2cd83e740b1592c6de7a03f4b18";

describe("installer-sha256-format", () => {
  it("passes a real manifest whose installers all carry a valid hash", async () => {
    const { pkg } = await parseManifestDirectory(fixture("valid", "sharkdp.bat", "0.26.1"));
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags a real manifest whose second installer hash is malformed", async () => {
    const { pkg } = await parseManifestDirectory(
      fixture("invalid", "Contoso.BadInstallerHash", "1.0.0"),
    );
    const diagnostics = rule.check(pkg);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      ruleId: "installer-sha256-format",
      severity: "error",
      file: "Contoso.BadInstallerHash.installer.yaml",
    });
    expect(diagnostics[0]?.message).toContain("Installers[1].InstallerSha256");
    // Points at the offending installer entry, not the first one.
    expect(diagnostics[0]?.position).toBeDefined();
  });

  it("accepts a lowercase 64-character hex digest", () => {
    const pkg = packageWithInstaller(
      `Installers:\n- Architecture: x64\n  InstallerSha256: ${HASH}\n`,
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("accepts an uppercase 64-character hex digest (case-insensitive)", () => {
    const pkg = packageWithInstaller(
      `Installers:\n- Architecture: x64\n  InstallerSha256: ${HASH.toUpperCase()}\n`,
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("flags an installer with no InstallerSha256", () => {
    const pkg = packageWithInstaller("Installers:\n- Architecture: x64\n");
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("missing InstallerSha256");
  });

  it("flags a hash that is too short", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n  InstallerSha256: abc123\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("6 characters");
  });

  it("flags a 64-character value containing non-hex characters", () => {
    const nonHex = "g".repeat(64);
    const pkg = packageWithInstaller(
      `Installers:\n- Architecture: x64\n  InstallerSha256: ${nonHex}\n`,
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("non-hexadecimal");
  });

  it("flags a non-string hash value", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n  InstallerSha256: 1234567890\n",
    );
    // An all-digit unquoted value parses as a number, not a 64-char string.
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("InstallerSha256");
  });

  it("skips a msstore installer, which carries no hash by design", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n  InstallerType: msstore\n  MSStoreProductIdentifier: 9WZDNCRFHVN5\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("skips a msstore installer whose type is a root-level default", () => {
    const pkg = packageWithInstaller(
      "InstallerType: msstore\nInstallers:\n- Architecture: x64\n  MSStoreProductIdentifier: 9WZDNCRFHVN5\n",
    );
    expect(rule.check(pkg)).toEqual([]);
  });

  it("still checks a non-msstore installer sharing a msstore file", () => {
    const pkg = packageWithInstaller(
      "Installers:\n- Architecture: x64\n  InstallerType: msstore\n  MSStoreProductIdentifier: 9WZDNCRFHVN5\n- Architecture: x86\n  InstallerType: msi\n  InstallerUrl: https://example.com/tool.msi\n",
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain("entry 1");
    expect(diagnostics[0]?.message).toContain("missing InstallerSha256");
  });

  it("reports each offending installer independently", () => {
    const pkg = packageWithInstaller(
      `Installers:\n- Architecture: x64\n  InstallerSha256: ${HASH}\n- Architecture: x86\n  InstallerSha256: short\n- Architecture: arm64\n`,
    );
    const diagnostics = rule.check(pkg);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]?.message).toContain("Installers[1]");
    expect(diagnostics[1]?.message).toContain("entry 2");
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

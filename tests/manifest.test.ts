import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installerFile,
  localeFiles,
  parseManifestDirectory,
  positionOf,
  versionFile,
} from "../src/manifest.js";
import { compareDiagnostics, type Diagnostic } from "../src/diagnostic.js";

const here = dirname(fileURLToPath(import.meta.url));
const BAT = join(here, "fixtures", "valid", "sharkdp.bat", "0.26.1");

describe("parseManifestDirectory", () => {
  it("finds all three files and assigns roles from the file name", async () => {
    const { pkg, diagnostics } = await parseManifestDirectory(BAT);

    expect(diagnostics).toEqual([]);
    expect(pkg.files.map((f) => f.role).sort()).toEqual(["installer", "locale", "version"]);
    expect(pkg.directoryVersion).toBe("0.26.1");
  });

  it("treats a defaultLocale file as the `locale` role", async () => {
    // The role comes from the file name; ManifestType saying `defaultLocale` is
    // a separate claim that a rule checks independently.
    const { pkg } = await parseManifestDirectory(BAT);
    const locales = localeFiles(pkg);

    expect(locales).toHaveLength(1);
    expect(locales[0]?.localeTag).toBe("en-US");
    expect(locales[0]?.data["ManifestType"]).toBe("defaultLocale");
  });

  it("exposes parsed scalars through the accessors", async () => {
    const { pkg } = await parseManifestDirectory(BAT);

    expect(versionFile(pkg)?.data["PackageIdentifier"]).toBe("sharkdp.bat");
    expect(installerFile(pkg)?.data["InstallerType"]).toBe("zip");
  });

  it("does not throw on a directory containing no manifests", async () => {
    const { pkg, diagnostics } = await parseManifestDirectory(join(here, "fixtures"));

    expect(pkg.files).toEqual([]);
    expect(diagnostics).toEqual([]);
  });
});

describe("positionOf", () => {
  it("resolves a top-level key to a 1-based line and column", async () => {
    const { pkg } = await parseManifestDirectory(BAT);
    const version = versionFile(pkg);
    expect(version).toBeDefined();

    // `PackageIdentifier` is the first key after the schema comment + blank line.
    expect(positionOf(version!, ["PackageIdentifier"])).toEqual({ line: 3, column: 20 });
  });

  it("resolves into an array element, which is where installer rules report", async () => {
    const { pkg } = await parseManifestDirectory(BAT);
    const installer = installerFile(pkg);

    const pos = positionOf(installer!, ["Installers", 1, "Architecture"]);
    expect(pos?.line).toBeGreaterThan(0);
    expect(pos?.column).toBeGreaterThan(0);
  });

  it("returns undefined for a path that does not exist", async () => {
    const { pkg } = await parseManifestDirectory(BAT);

    expect(positionOf(versionFile(pkg)!, ["NoSuchKey"])).toBeUndefined();
    expect(positionOf(versionFile(pkg)!, [])).toBeUndefined();
  });
});

describe("compareDiagnostics", () => {
  const at = (file: string, line?: number): Diagnostic => ({
    ruleId: "x",
    severity: "error",
    message: "m",
    file,
    ...(line === undefined ? {} : { position: { line, column: 1 } }),
  });

  it("orders by file, then position, with unpositioned first", () => {
    const sorted = [at("b.yaml", 1), at("a.yaml", 5), at("a.yaml"), at("a.yaml", 2)]
      .sort(compareDiagnostics)
      .map((d) => `${d.file}:${d.position?.line ?? "-"}`);

    expect(sorted).toEqual(["a.yaml:-", "a.yaml:2", "a.yaml:5", "b.yaml:1"]);
  });
});

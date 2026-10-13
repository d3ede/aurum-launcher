import { afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
// @ts-expect-error The release tool is a standalone Node module.
import { prepareRelease } from "../scripts/prepare-release.mjs";

const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "aurum-release-test-"));
  roots.push(root);
  const bundleDir = join(root, "bundle");
  const outputDir = join(root, "output");
  mkdirSync(bundleDir);
  mkdirSync(join(root, "src-tauri"));
  mkdirSync(join(root, "docs/releases"), { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  writeFileSync(
    join(root, "src-tauri/Cargo.toml"),
    '[package]\nversion = "1.2.3"',
  );
  writeFileSync(
    join(root, "src-tauri/tauri.conf.json"),
    JSON.stringify({
      version: "1.2.3",
      bundle: { createUpdaterArtifacts: true },
      plugins: { updater: { pubkey: "test-public-key" } },
    }),
  );
  writeFileSync(join(root, "docs/releases/v1.2.3.md"), "Release notes");
  const installer = join(bundleDir, "Aurum Launcher_1.2.3_x64-setup.exe");
  writeFileSync(installer, "owned installer fixture");
  writeFileSync(
    `${installer}.sig`,
    Buffer.from(
      "untrusted comment: fixture signature\nsignature\ntrusted comment: timestamp:0\tversion:1.2.3\nsignature",
    ).toString("base64"),
  );
  return { root, bundleDir, outputDir, tag: "v1.2.3", installer };
}
describe("signed release publication", () => {
  it("pairs the manifest with an immutable installer URL and matching checksum", () => {
    const data = fixture();
    const manifest = prepareRelease({
      ...data,
      now: new Date("2026-10-14T00:00:00Z"),
    });
    expect(manifest.platforms["windows-x86_64"].url).toBe(
      "https://github.com/d3ede/aurum-launcher/releases/download/v1.2.3/Aurum-Launcher_x64-setup.exe",
    );
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.notes).toBe("Release notes");
    const bytes = readFileSync(
      join(data.outputDir, "Aurum-Launcher_x64-setup.exe"),
    );
    expect(bytes).toEqual(readFileSync(data.installer));
    expect(
      readFileSync(join(data.outputDir, "SHA256SUMS.txt"), "utf8"),
    ).toContain(createHash("sha256").update(bytes).digest("hex"));
  });
  it("rejects a tag that points at a different application version", () => {
    expect(() => prepareRelease({ ...fixture(), tag: "v1.2.4" })).toThrow(
      "versions must match",
    );
  });
  it("rejects a signature bound to a different release version", () => {
    const data = fixture();
    writeFileSync(
      `${data.installer}.sig`,
      Buffer.from(
        "untrusted comment: fixture\nsignature\ntrusted comment: timestamp:0\tversion:1.2.2\nsignature",
      ).toString("base64"),
    );
    expect(() => prepareRelease(data)).toThrow("exact release version");
  });
  it("refuses to publish an installer without its updater signature", () => {
    const data = fixture();
    rmSync(`${data.installer}.sig`);
    expect(() => prepareRelease(data)).toThrow();
  });
  it("rejects stale native versions and ambiguous installer selection", () => {
    const data = fixture();
    writeFileSync(
      join(data.root, "src-tauri/Cargo.toml"),
      '[package]\nversion = "1.2.2"',
    );
    expect(() => prepareRelease(data)).toThrow("versions must match");
    writeFileSync(
      join(data.root, "src-tauri/Cargo.toml"),
      '[package]\nversion = "1.2.3"',
    );
    writeFileSync(
      join(data.bundleDir, "Other_1.2.3_x64-setup.exe"),
      "other installer",
    );
    expect(() => prepareRelease(data)).toThrow("exactly one");
  });
});

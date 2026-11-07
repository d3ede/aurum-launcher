import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

export const runtimeNames = [
  "aurum-social-worker.exe",
  "aurum-social-firewall.exe",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function packageSocialRuntime(root = resolve(".")) {
  const directory = join(root, "src-tauri/social-runtime");
  const version = JSON.parse(readFileSync(join(root, "package.json"))).version;
  const files = runtimeNames.map((name) => {
    const bytes = readFileSync(join(directory, name));
    const compressed = gzipSync(bytes, { level: 9 });
    writeFileSync(join(directory, `${name}.gz`), compressed);
    return {
      name,
      bytes: bytes.length,
      sha256: sha256(bytes),
      downloadBytes: compressed.length,
      downloadSha256: sha256(compressed),
    };
  });
  const revision = sha256(
    files.map((file) => `${file.name}:${file.sha256}:${file.bytes}`).join("\n"),
  );
  const manifest = { version, revision, files };
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = packageSocialRuntime();
  console.log(
    `Packaged optional Social runtime: ${manifest.files.reduce((sum, file) => sum + file.downloadBytes, 0)} download bytes`,
  );
}

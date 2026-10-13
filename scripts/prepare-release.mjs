import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

export function prepareRelease({
  root = resolve("."),
  bundleDir,
  outputDir,
  tag,
  now = new Date(),
}) {
  const packageVersion = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  const config = JSON.parse(
    readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const crateVersion = readFileSync(
    join(root, "src-tauri/Cargo.toml"),
    "utf8",
  ).match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (
    !/^\d+\.\d+\.\d+$/.test(packageVersion) ||
    config.version !== packageVersion ||
    crateVersion !== packageVersion ||
    tag !== `v${packageVersion}`
  ) {
    throw new Error(
      "Release tag and application versions must match (stable SemVer only).",
    );
  }
  if (!config.bundle.createUpdaterArtifacts || !config.plugins.updater.pubkey)
    throw new Error("Signed updater artifacts must be configured.");
  bundleDir = resolve(bundleDir ?? join(root, "target/release/bundle/nsis"));
  outputDir = resolve(outputDir ?? join(root, "target/publish"));
  const installers = readdirSync(bundleDir).filter((name) =>
    name.endsWith(`_${packageVersion}_x64-setup.exe`),
  );
  if (installers.length !== 1)
    throw new Error(
      "Expected exactly one Windows x64 installer for this version.",
    );
  const installer = join(bundleDir, installers[0]);
  const signature = readFileSync(`${installer}.sig`, "utf8").trim();
  const signedText = Buffer.from(signature, "base64").toString("utf8");
  if (
    !signature ||
    !Buffer.from(signature, "base64")
      .toString("utf8")
      .startsWith("untrusted comment:")
  )
    throw new Error("Missing or invalid updater signature.");
  const signedVersion = signedText.match(
    /^trusted comment:.*\bversion:([^\s]+)/m,
  )?.[1];
  if (signedVersion !== packageVersion)
    throw new Error("Updater signature must bind the exact release version.");
  const installerName = "Aurum-Launcher_x64-setup.exe";
  const repository = "d3ede/aurum-launcher";
  const notes = readFileSync(
    join(root, "docs/releases", `${tag}.md`),
    "utf8",
  ).trim();
  const manifest = {
    version: packageVersion,
    notes,
    pub_date: now.toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        // A version-specific URL keeps an existing manifest paired with its
        // signed installer even while a newer release becomes latest.
        url: `https://github.com/${repository}/releases/download/${tag}/${installerName}`,
      },
    },
  };
  mkdirSync(outputDir, { recursive: true });
  copyFileSync(installer, join(outputDir, installerName));
  writeFileSync(join(outputDir, `${installerName}.sig`), `${signature}\n`);
  writeFileSync(
    join(outputDir, "latest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const assets = [installerName, `${installerName}.sig`, "latest.json"];
  writeFileSync(
    join(outputDir, "SHA256SUMS.txt"),
    assets
      .map(
        (name) =>
          `${createHash("sha256")
            .update(readFileSync(join(outputDir, name)))
            .digest("hex")}  ${name}`,
      )
      .join("\n") + "\n",
  );
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = prepareRelease({
    tag: process.env.RELEASE_TAG ?? process.argv[2],
    bundleDir: process.env.AURUM_BUNDLE_DIR,
    outputDir: process.env.AURUM_RELEASE_DIR,
  });
  console.log(`Prepared signed Windows release ${manifest.version}`);
}

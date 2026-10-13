import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import tauri from "@tauri-apps/cli";

// The interface, favicon and native icons share the approved Figma vector.
const source = fileURLToPath(
  new URL("../src/assets/branding/aurum-gold.svg", import.meta.url),
);
const generated = fileURLToPath(
  new URL("../target/branding-icons/", import.meta.url),
);
const destination = fileURLToPath(
  new URL("../src-tauri/icons/", import.meta.url),
);

await tauri.run(["icon", source, "--output", generated]);
mkdirSync(destination, { recursive: true });
for (const filename of ["icon.png", "icon.ico"]) {
  copyFileSync(join(generated, filename), join(destination, filename));
}

// End-to-end import through the real WebView2 UI/IPC. Only owned .test-data fixtures are copied.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(".test-data", `native-modrinth-${Date.now()}`);
const sourceRoot = join(root, "ModrinthApp");
const dataRoot = join(root, "Aurum");
const sourceFiles = new Map();
function write(file, value) {
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, value);
  sourceFiles.set(file, readFileSync(file));
}
for (const [folder, name, loader, loaderVersion] of [
  ["Cozy", "Уютный мир", "fabric", "0.16.14"],
  ["Adventure", "Приключения", "forge", "1.20.1-47.4.0"],
]) {
  const src = join(sourceRoot, "profiles", folder);
  write(
    join(src, "profile.json"),
    JSON.stringify({
      metadata: {
        name,
        game_version: folder === "Cozy" ? "1.21.1" : "1.20.1",
        loader,
        loader_version: { id: loaderVersion },
      },
      memory: { maximum: 6144 },
    }),
  );
  write(join(src, "mods", "example.jar"), "isolated test mod");
  write(join(src, "mods", "off.jar.disabled"), "disabled test mod");
  write(join(src, "saves", "Мой мир", "level.dat"), "isolated test world");
  write(join(src, "options.txt"), "renderDistance:12\n");
  write(join(src, "config", "example.toml"), "enabled=true\n");
  write(join(src, "journeymap", "waypoints.json"), "[]");
}
const executable = resolve(
  process.env.AURUM_SMOKE_EXE || "target/release/aurum.exe",
);
const child = spawn(executable, [], {
  cwd: resolve("."),
  windowsHide: true,
  env: {
    ...process.env,
    AURUM_DATA_DIR: dataRoot,
    THESEUS_CONFIG_DIR: sourceRoot,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=9233 --remote-debugging-address=127.0.0.1",
  },
  stdio: "pipe",
});
let browser;
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Smoke launcher exited: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9233");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(browser, "Owned smoke launcher did not start its local CDP port");
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  const rpc = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
      { action, payload },
    );
  assert.equal((await rpc("snapshot")).dataDir, dataRoot);
  const found = await rpc("scanModrinth", { directories: [] });
  const owned = found.profiles.filter((p) =>
    p.path.toLowerCase().includes(root.toLowerCase()),
  );
  assert.equal(owned.length, 2);
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await page.getByRole("button", { name: "Из Modrinth" }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт из Modrinth" });
  await dialog
    .getByRole("checkbox", { name: "Импортировать Уютный мир", exact: true })
    .first()
    .waitFor();
  for (const name of ["Уютный мир", "Приключения"]) {
    // Restrict selection to the unique fixture source path, even if real profiles use the same name.
    assert.equal(owned.filter((p) => p.name === name).length, 1);
    const rows = dialog
      .locator(".modrinth-profile-row")
      .filter({ hasText: name });
    assert.equal(
      await rows.count(),
      1,
      "A personal profile shares a fixture name; refusing ambiguous selection",
    );
    await rows.getByRole("checkbox").check();
  }
  await page.screenshot({
    path: ".test-data/screenshots/modrinth-import-native.png",
  });
  await dialog
    .getByRole("button", { name: "Импортировать · 2", exact: true })
    .click();
  await dialog.getByText("Импорт завершён · добавлено: 2").waitFor();
  const result = await rpc("snapshot");
  assert.equal(result.profiles.length, 2);
  for (const p of result.profiles) {
    const dest = join(dataRoot, "instances", p.id);
    assert.equal(
      readFileSync(join(dest, "saves", "Мой мир", "level.dat"), "utf8"),
      "isolated test world",
    );
    assert.equal(
      readFileSync(join(dest, "options.txt"), "utf8"),
      "renderDistance:12\n",
    );
    assert(existsSync(join(dest, "mods", "off.jar.disabled")));
    assert(existsSync(join(dest, "journeymap", "waypoints.json")));
    assert.equal(p.ramMb, 6144);
    assert.equal(p.installedVersion, null);
  }
  for (const [file, before] of sourceFiles)
    assert.deepEqual(readFileSync(file), before);
  await dialog.getByRole("button", { name: "К сборкам", exact: true }).click();
  await page
    .getByRole("heading", { name: "Уютный мир", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  writeFileSync(
    join(root, "result.json"),
    JSON.stringify(
      {
        passed: true,
        imported: result.profiles.map((p) => p.name),
        originalsUnchanged: true,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: true,
      imported: result.profiles.length,
      fixtureRoot: root,
    }),
  );
} finally {
  if (browser) await browser.close();
  child.kill();
}

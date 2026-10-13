// Build target/debug/aurum.exe with identifier app.auren.launcher.instance-smoke first.
// Uses an owned data directory, opens its missing folder, starts installation through UI, then cancels.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdirSync, rmdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const root = resolve(
  ".test-data",
  `native-creation-${Date.now()}`,
  "Пустая сборка",
);
mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, "state.json"),
  JSON.stringify({
    profiles: [],
    accounts: [],
    selectedAccount: null,
    settings: {
      language: "ru",
      theme: "dark",
      javaPath: "",
      ramMb: 4096,
      jvmArgs: "",
      resolutionWidth: 1280,
      resolutionHeight: 720,
      showSnapshots: false,
    },
  }),
);
const child = spawn(resolve("target/debug/aurum.exe"), [], {
  windowsHide: true,
  env: {
    ...process.env,
    AURUM_DATA_DIR: root,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=9243 --remote-debugging-address=127.0.0.1",
  },
  stdio: "pipe",
});
let browser;
try {
  for (let i = 0; i < 80; i++) {
    assert.equal(child.exitCode, null, "Owned test launcher exited");
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9243");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(browser, "Owned launcher did not expose CDP");
  const page = browser.contexts()[0].pages()[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const rpc = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
      { action, payload },
    );
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  assert.equal(
    (await rpc("snapshot")).dataDir,
    root,
    "Refusing to modify a personal launcher",
  );
  const old = await rpc("createProfile", {
    name: "Empty legacy instance",
    minecraft: "1.21.1",
    loader: "vanilla",
    loaderVersion: null,
    cover: 0,
    icon: null,
    iconStyle: null,
  });
  const folder = resolve(root, "instances", old.id);
  assert(folder.startsWith(resolve(root, "instances") + sep));
  rmdirSync(folder); // Empty owned fixture only; never recursive.
  assert(!existsSync(folder));
  await rpc("openFolder", { id: old.id });
  assert(
    existsSync(folder),
    "Opening an old empty instance failed to recreate the directory",
  );
  assert.equal((await rpc("snapshot")).profiles[0].installedVersion, null);

  await page.getByRole("button", { name: "Новая сборка", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Новая сборка",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Версия Minecraft", exact: true })
    .click();
  await page.getByRole("option", { name: "1.21.1", exact: true }).click();
  await dialog
    .getByRole("textbox", { name: "Название сборки" })
    .fill("Auto-install native test");
  await dialog
    .getByRole("button", { name: "Создать сборку", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Auto-install native test", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Устанавливаем…", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "Устанавливаем…", exact: true })
      .isDisabled(),
  );
  await page.getByRole("button", { name: "Папка", exact: true }).click();
  await page
    .getByRole("button", { name: "Отменить операцию", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Установить и играть", exact: true })
    .waitFor({ timeout: 20000 });
  const state = await rpc("snapshot");
  assert.equal(state.profiles.length, 2);
  assert.equal(state.accounts.length, 0);
  assert.equal(state.running.length, 0);
  assert.equal(
    state.profiles.find((p) => p.name === "Auto-install native test")
      .installedVersion,
    null,
  );
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: "docs/screenshots/profile-creation-native.png",
    animations: "disabled",
  });
  console.log(
    "PROFILE_CREATION_NATIVE_OK: empty folder recreated, immediate install, folder during download, cancellation preserves instance, no game launch",
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}

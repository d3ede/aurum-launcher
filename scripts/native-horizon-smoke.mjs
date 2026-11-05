import { randomUUID } from "node:crypto";
// Run after closing the ordinary Aurum window. Uses only its own .test-data root.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(".test-data", `native-horizon-${Date.now()}`);
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
const child = spawn(resolve("target/release/aurum.exe"), [], {
  windowsHide: true,
  env: {
    ...process.env,
    AURUM_DATA_DIR: root,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=9246 --remote-debugging-address=127.0.0.1",
  },
  stdio: "ignore",
});
let browser;
try {
  let connected = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null)
      throw new Error(`Aurum exited: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9246");
      connected = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert(connected, "Native WebView did not become ready");
  const page = browser
    .contexts()[0]
    .pages()
    .find((p) => /tauri\.localhost/.test(p.url()));
  assert(page, "Main Tauri page not found");
  await page.getByText("0.5.1", { exact: false }).first().waitFor();
  const rpc = (action, payload = {}) =>
    page.evaluate(
      ({ action, payload }) =>
        window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
      { action, payload },
    );
  const initial = await rpc("snapshot");
  assert.equal(initial.profiles.length, 0);
  assert.equal(initial.accounts.length, 0);
  await page
    .getByRole("button", { name: "Создать сборку", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Новая сборка",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Загрузчик", exact: true })
    .click();
  assert.equal(await page.locator(".select-menu img.loader-logo").count(), 6);
  await page
    .getByRole("option", { name: "Horizon · Rust", exact: true })
    .click();
  assert(
    await dialog
      .getByRole("combobox", { name: "Версия Minecraft", exact: true })
      .isDisabled(),
  );
  assert(
    await dialog
      .getByRole("button", { name: "Создать сборку", exact: true })
      .isDisabled(),
  );
  await dialog.locator(".horizon-account-note").waitFor();
  await page.screenshot({ path: join(root, "horizon-native.png") });
  // Exercise the real bridge and persistence without downloading unowned game files.
  const profile = await rpc("createProfile", {
    engine: "horizon",
    name: "Native Horizon check",
    minecraft: "26.3",
    loader: "vanilla",
    loaderVersion: null,
    cover: 0,
    iconStyle: { symbol: "fabric", color: "#ABCDEF", background: "#123456" },
  });
  assert.equal(profile.engine, "horizon");
  assert.equal(profile.iconStyle.symbol, "fabric");
  let rejected = false;
  try {
    await rpc("install", {
      id: profile.id,
      operationId: randomUUID(),
    });
  } catch (error) {
    rejected = String(error).includes("Microsoft");
  }
  assert(rejected, "Unowned installation should fail before any download");
  const saved = (await rpc("snapshot")).profiles.find(
    (p) => p.id === profile.id,
  );
  assert.equal(saved.engine, "horizon");
  assert.equal(saved.installedVersion, null);
  assert.equal(saved.iconStyle.color, "#ABCDEF");
  assert(
    !existsSync(join(root, "horizon")),
    "Unowned installation downloaded Horizon",
  );
  console.log(
    JSON.stringify({
      nativeVersion: "0.5.1",
      brandedOptions: 6,
      nativeProfileSaved: true,
      ownerGate: true,
      noUnownedDownloads: true,
      dataRoot: root,
    }),
  );
} finally {
  await browser?.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}

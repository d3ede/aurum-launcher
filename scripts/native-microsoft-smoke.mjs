// The debug binary must be built with identifier app.auren.launcher.auth-smoke.
// Opens the real Microsoft page, then cancels it. Never enters account credentials.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(".test-data", `native-microsoft-${Date.now()}`);
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "state.json"), JSON.stringify({
  profiles: [], accounts: [], selectedAccount: null,
  settings: { language: "ru", theme: "light", javaPath: "", ramMb: 4096, jvmArgs: "", resolutionWidth: 1280, resolutionHeight: 720, showSnapshots: false },
}));
const child = spawn(resolve("target/debug/aurum.exe"), [], {
  cwd: resolve("."), windowsHide: true,
  env: { ...process.env, AURUM_DATA_DIR: root,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9241 --remote-debugging-address=127.0.0.1" },
  stdio: "pipe",
});
let browser;
try {
  for (let i = 0; i < 80; i++) {
    assert.equal(child.exitCode, null, "Owned test application exited unexpectedly");
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9241"); break; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  assert(browser, "Owned debug launcher did not expose CDP");
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
  const rpc = (action, payload = {}) => invoke("rpc", { action, payload });
  assert.equal((await rpc("snapshot")).dataDir, root, "Refusing to operate on a user's launcher");
  await page.evaluate(async () => {
    const handler = window.__TAURI_INTERNALS__.transformCallback(event => {
      if (event.payload.phase.startsWith("auth-")) {
        window.lastMicrosoftOperation = event.payload.id;
      }
    });
    await window.__TAURI_INTERNALS__.invoke("plugin:event|listen", {
      event: "auren:event", target: { kind: "Any" }, handler,
    });
  });
  await page.getByRole("button", { name: "Аккаунты и скины", exact: true }).click();
  await page.getByRole("button", { name: "Войти с Microsoft", exact: true }).click();
  const labels = () => invoke("plugin:window|get_all_windows");
  const label = "microsoft-signin";
  for (let i = 0; i < 100; i++) {
    if ((await labels()).includes(label)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert((await labels()).includes(label), "Microsoft sign-in did not create an owned native window");
  await page.getByText("Ждём подтверждения в окне Microsoft", { exact: true }).waitFor();
  const operation = await page.evaluate(() => window.lastMicrosoftOperation);
  await rpc("reopenMicrosoft", { operationId: operation });
  // Optional pause for read-only visual inspection by the developer.
  console.log("MICROSOFT_WINDOW_OPEN", label);
  if (process.env.AURUM_AUTH_SMOKE_PAUSE === "1") {
    await new Promise((r) => setTimeout(r, 45000));
  }
  await invoke("plugin:window|close", { label });
  await page.getByRole("dialog", { name: "Вход отменён", exact: true }).waitFor({ timeout: 10000 });
  for (let i = 0; i < 100 && await invoke("plugin:window|is_visible", { label }); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(await invoke("plugin:window|is_visible", { label }), false, "Cancelled Microsoft window remained visible");
  assert((await labels()).includes(label), "Preloaded Microsoft window was destroyed");
  assert.equal((await rpc("snapshot")).accounts.length, 0);
  await page.screenshot({ path: ".test-data/screenshots/microsoft-window-cancel-native.png", animations: "disabled" });
  const started = Date.now();
  await page.getByRole("button", { name: "Попробовать снова", exact: true }).click();
  await page.getByText("Ждём подтверждения в окне Microsoft", { exact: true }).waitFor();
  const reopenMs = Date.now() - started;
  const nextOperation = await page.evaluate(() => window.lastMicrosoftOperation);
  assert.notEqual(nextOperation, operation, "Retry must use a fresh OAuth operation");
  assert.equal(await invoke("plugin:window|is_visible", { label }), true);
  assert.equal((await labels()).filter(value => value === label).length, 1);
  await page.getByRole("button", { name: "Отменить вход", exact: true }).click();
  await page.getByRole("dialog", { name: "Вход отменён", exact: true }).waitFor();
  assert.equal(await invoke("plugin:window|is_visible", { label }), false);
  console.log(JSON.stringify({ nativeMicrosoftWindow: true, reusedWindow: true, retryOpenMs: reopenMs, cancellation: true, addedAccounts: (await rpc("snapshot")).accounts.length }));
  await invoke("plugin:window|close", { label: "main" }).catch(() => {});
  for (let index = 0; index < 100 && child.exitCode === null; index++) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.notEqual(child.exitCode, null, "Hidden sign-in window prevented the launcher from exiting");
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}

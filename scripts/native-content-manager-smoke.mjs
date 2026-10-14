// Build debug with identifier app.auren.launcher.content-manager-smoke and run the content_manager_fixture example first.
// Exercises actual Modrinth recognition and downloads in an owned .test-data profile, never starts a game.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const fixture = JSON.parse(
  readFileSync(".test-data/content-manager-fixture.json", "utf8"),
);
const root = resolve(fixture.root);
assert(
  root.startsWith(resolve(".test-data") + sep),
  "Fixture is outside the owned test data",
);
const child = spawn(resolve("target/debug/aurum.exe"), [], {
  windowsHide: true,
  env: {
    ...process.env,
    AURUM_DATA_DIR: root,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
      "--remote-debugging-port=9245 --remote-debugging-address=127.0.0.1",
  },
  stdio: "pipe",
});
let browser;
try {
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, "Owned launcher exited");
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9245");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  assert(browser, "Owned smoke launcher did not expose CDP");
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
    "Refusing to operate on personal launcher data",
  );
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть Content manager smoke", exact: true })
    .click();
  await page
    .getByText("Доступно обновлений: 2", { exact: true })
    .waitFor({ timeout: 60000 });
  const sodium = page
    .locator(".installed-content-row")
    .filter({ hasText: "Sodium" });
  assert.equal(await sodium.locator("img").count(), 1);
  assert(
    await page
      .getByRole("switch", { name: "Включить Sodium", exact: true })
      .isVisible(),
  );
  for (const theme of ["light", "dark"]) {
    const state = await rpc("snapshot");
    await rpc("saveSettings", { settings: { ...state.settings, theme } });
    if ((await page.locator("html").getAttribute("data-theme")) !== theme)
      await page
        .getByRole("button", { name: "Переключить тему", exact: true })
        .click();
    await page
      .getByText("Доступно обновлений: 2", { exact: true })
      .waitFor({ timeout: 60000 });
    await page.screenshot({
      path: `.test-data/screenshots/content-manager-native-${theme}.png`,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Sodium", exact: true }).click();
  const project = page.getByRole("dialog", { name: "Sodium", exact: true });
  await project.locator(".markdown").waitFor({ timeout: 30000 });
  await project.getByRole("button", { name: "Закрыть диалог" }).click();
  const bulk = page.getByRole("button", {
    name: "Обновить всё 2",
    exact: true,
  });
  await bulk.waitFor();
  // Await the background check so clicking cannot race a disabled update button.
  await bulk.click({ timeout: 60000 });
  await page.getByText(/Обновлено проектов: [12]/).waitFor({ timeout: 120000 });
  await page
    .getByText("Совместимых обновлений нет", { exact: true })
    .waitFor({ timeout: 60000 });
  const content = await rpc("content", { id: fixture.profileId });
  const updatedSodium = content.find((c) => c.projectId === "AANobbMI");
  assert(
    updatedSodium && !updatedSodium.enabled,
    "Updating silently re-enabled Sodium",
  );
  assert(
    existsSync(
      join(
        root,
        "instances",
        fixture.profileId,
        "mods",
        `${updatedSodium.filename}.disabled`,
      ),
    ),
  );
  assert.equal(
    content.find((c) => c.name === "Private utility").versionName,
    "2.4.0",
  );
  await page
    .getByRole("switch", { name: "Включить Sodium", exact: true })
    .click();
  await page
    .getByRole("switch", { name: "Отключить Sodium", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Удалить Private utility", exact: true })
    .click();
  for (
    let i = 0;
    i < 50 && (await page.locator(".installed-content-row").count()) !== 2;
    i++
  )
    await new Promise((r) => setTimeout(r, 100));
  assert.equal(await page.locator(".installed-content-row").count(), 2);
  assert.deepEqual(errors, []);
  const state = await rpc("snapshot");
  assert.equal(state.accounts.length, 0);
  assert.equal(state.running.length, 0);
  writeFileSync(
    ".test-data/content-manager-native-result.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "real file hash recognition",
          "real names and images",
          "real compatible updates",
          "bulk verified downloads",
          "disabled state preserved",
          "native toggle",
          "trash removal",
          "no game launch",
        ],
        content,
      },
      null,
      2,
    ),
  );
  console.log(
    "CONTENT_MANAGER_NATIVE_OK: recognition, project page, update all, disabled state, toggle and trash",
  );
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.exitCode === null) child.kill();
}

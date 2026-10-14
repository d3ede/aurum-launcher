import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9227");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
await page.getByRole("button", { name: "Главная", exact: true }).click();
await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
const rpc = (action, payload = {}) =>
  page.evaluate(
    async ({ action, payload }) =>
      window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
    { action, payload },
  );
const before = await rpc("snapshot");
assert(before.dataDir.includes(".test-data"));
assert(before.accounts.some((a) => a.name === "AurenTest"));
await page
  .getByRole("button", { name: "Каталог проектов", exact: true })
  .click();
await page
  .getByRole("textbox", { name: "Поиск проектов", exact: true })
  .fill("Sodium");
await page.locator(".catalog-card").first().waitFor({ timeout: 60000 });
assert((await page.locator(".catalog-card").count()) > 0);
await page.locator(".catalog-card").first().click();
await page.locator(".markdown").waitFor({ timeout: 60000 });
await page.screenshot({
  path: ".test-data/screenshots/native-project.png",
  animations: "disabled",
});
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /^Мои сборки/ }).click();
await page.getByRole("button", { name: "Новая сборка", exact: true }).click();
await page
  .getByRole("textbox", { name: "Название сборки" })
  .fill("Desktop smoke");
await page.getByRole("combobox", { name: "Версия Minecraft" }).click();
await page.getByRole("option", { name: "1.21.1", exact: true }).click();
await page.getByRole("button", { name: "Создать сборку", exact: true }).click();
await page.getByRole("dialog").waitFor({ state: "hidden" });
const p = (await rpc("snapshot")).profiles.find(
  (p) => p.name === "Desktop smoke",
);
assert(p);
await page
  .getByRole("heading", { name: "Desktop smoke", exact: true })
  .waitFor();
await page
  .getByRole("button", { name: "Установить и играть", exact: true })
  .last()
  .click();
await page.waitForFunction(
  async (id) => {
    const data = await window.__TAURI_INTERNALS__.invoke("rpc", {
      action: "snapshot",
      payload: {},
    });
    return data.running.includes(id);
  },
  p.id,
  { timeout: 180000 },
);
await page
  .getByRole("button", { name: "Остановить", exact: true })
  .last()
  .click();
await page.waitForFunction(
  async (id) => {
    const data = await window.__TAURI_INTERNALS__.invoke("rpc", {
      action: "snapshot",
      payload: {},
    });
    return !data.running.includes(id);
  },
  p.id,
  { timeout: 15000 },
);
await page.keyboard.press("Escape");
await page
  .getByRole("button", { name: "Аккаунты и скины", exact: true })
  .click();
await page.locator(".skin-stage canvas").waitFor();
await page.screenshot({
  path: ".test-data/screenshots/native-accounts.png",
  animations: "disabled",
});
await page.getByRole("button", { name: "Настройки", exact: true }).click();
await page.getByRole("button", { name: "Тихий вечер" }).click();
await page.waitForFunction(
  () => document.documentElement.dataset.theme === "dark",
);
await page.getByRole("button", { name: "Главная", exact: true }).click();
await page.screenshot({
  path: ".test-data/screenshots/native-dark.png",
  animations: "disabled",
});
await page.getByRole("button", { name: "Переключить тему" }).click();
await page.waitForFunction(
  () => document.documentElement.dataset.theme === "light",
);
await page.screenshot({
  path: ".test-data/screenshots/native-light.png",
  animations: "disabled",
});
await rpc("deleteProfile", { id: p.id });
assert(!(await rpc("snapshot")).profiles.some((v) => v.id === p.id));
assert.deepEqual(errors, []);
writeFileSync(
  ".test-data/native-smoke-result.json",
  JSON.stringify(
    {
      passed: true,
      checks: [
        "native startup",
        "real Modrinth search and project",
        "profile creation",
        "real installation and launch through UI",
        "process stop",
        "3D preview",
        "theme persistence",
        "profile deletion",
      ],
      errors,
    },
    null,
    2,
  ),
);
console.log(
  "PASS: native Tauri UI, real IPC, catalog, install/launch, 3D preview, themes, deletion",
);
await browser.close();

// Real WebView2 UI and IPC regression check; only isolated .test-data profiles.
import { chromium } from "playwright";
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9227");
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const rpc = (action, payload = {}) =>
  page.evaluate(
    ({ action, payload }) =>
      window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
    { action, payload },
  );
const before = await rpc("snapshot");
assert(before.dataDir.includes(".test-data"));
const created = [];
try {
  await page.getByRole("button", { name: "Развернуть окно" }).click();
  await page.getByRole("button", { name: "Восстановить окно" }).waitFor();
  await page.getByRole("button", { name: "Восстановить окно" }).click();
  await page.getByRole("button", { name: "Развернуть окно" }).waitFor();
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page.getByRole("button", { name: "Новая сборка", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const create = dialog.getByRole("button", {
    name: "Создать сборку",
    exact: true,
  });
  await create.waitFor();
  await page.waitForFunction(
    () => {
      const button = [
        ...document.querySelectorAll('[role="dialog"] button'),
      ].find((b) => b.textContent.includes("Создать сборку"));
      return button && !button.disabled;
    },
    { timeout: 60000 },
  );
  assert.equal(
    await dialog.getByRole("textbox", { name: "Название сборки" }).inputValue(),
    "",
  );
  await create.click();
  await dialog.waitFor({ state: "hidden" });
  let snapshot = await rpc("snapshot");
  const defaultProfile = snapshot.profiles.find(
    (p) => !before.profiles.some((old) => old.id === p.id),
  );
  assert(
    defaultProfile &&
      defaultProfile.name === `Minecraft ${defaultProfile.minecraft}`,
  );
  created.push(defaultProfile.id);
  await page
    .getByRole("heading", { name: defaultProfile.name, exact: true })
    .waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page
    .getByRole("button", { name: "Найти проекты", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Для модов нужен загрузчик", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Найти ресурспаки", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Ресурспаки", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Открыть ${defaultProfile.name}`,
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Изменить значок сборки" }).click();
  await page.getByRole("button", { name: "Значок 3", exact: true }).click();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.waitForFunction(async (id) => {
    const s = await window.__TAURI_INTERNALS__.invoke("rpc", {
      action: "snapshot",
      payload: {},
    });
    return s.profiles.find((p) => p.id === id)?.cover === 2;
  }, defaultProfile.id);
  // Custom data is stored by the same create/update contracts used by the file picker.
  const icon = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const context = c.getContext("2d");
    context.fillStyle = "#558d68";
    context.fillRect(0, 0, 128, 128);
    return c.toDataURL("image/png");
  });
  const loaders = await rpc("loaders", {
    minecraft: "1.21.1",
    loader: "fabric",
  });
  const profile = await rpc("createProfile", {
    name: "Aurum UI check",
    minecraft: "1.21.1",
    loader: "fabric",
    loaderVersion: loaders[0],
    cover: 1,
    icon,
  });
  created.push(profile.id);
  assert(profile.icon.startsWith("data:image/png;base64,"));
  await page.reload();
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page.getByRole("button", { name: "Открыть Aurum UI check" }).click();
  await page
    .getByRole("heading", { name: profile.name, exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Ресурспаки", exact: true }).click();
  await page
    .getByRole("button", { name: "Найти проекты", exact: true })
    .click();
  assert.equal(await page.getByLabel("Установить в").inputValue(), profile.id);
  assert.equal(
    await page
      .getByRole("button", { name: "Ресурспаки", exact: true })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(
    await page
      .getByRole("combobox", { name: "Фильтр версии Minecraft" })
      .inputValue(),
    "1.21.1",
  );
  await page.getByRole("button", { name: "Моды", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Категория проекта" })
    .selectOption("optimization");
  await page
    .getByRole("combobox", { name: "Сортировка проектов" })
    .selectOption("relevance");
  await page
    .getByRole("textbox", { name: "Поиск проектов", exact: true })
    .fill("Sodium");
  const result = page.locator(".catalog-result").filter({
    has: page.getByRole("heading", { name: "Sodium", exact: true }),
  });
  await result.waitFor({ timeout: 60000 });
  assert.equal(
    await page
      .getByRole("combobox", { name: "Фильтр загрузчика" })
      .inputValue(),
    "fabric",
  );
  await result.getByRole("button", { name: "Добавить", exact: true }).click();
  await result
    .getByRole("button", { name: "Добавлено", exact: true })
    .waitFor({ timeout: 120000 });
  assert(
    (await rpc("content", { id: profile.id })).some((c) => c.name === "Sodium"),
  );
  await page.screenshot({
    path: "docs/screenshots/native-catalog.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 960, height: 680 });
  assert.equal(
    await page.evaluate(() => {
      const e = document.querySelector(".content-scroll");
      return e.scrollWidth > e.clientWidth;
    }),
    false,
  );
  await page.setViewportSize({ width: 1280, height: 820 });
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page.getByRole("button", { name: "Открыть Aurum UI check" }).click();
  await page.locator(".content-row").filter({ hasText: "Sodium" }).waitFor();
  await page.screenshot({
    path: "docs/screenshots/native-instance.png",
    animations: "disabled",
  });
  assert.deepEqual(errors, []);
  writeFileSync(
    ".test-data/native-redesign-result.json",
    JSON.stringify(
      {
        passed: true,
        checks: [
          "custom titlebar maximize/restore",
          "two-click default profile",
          "preset icon persistence",
          "custom icon persistence",
          "full-page profile",
          "compatible resourcepack/mod filters",
          "live category and relevance filters",
          "one-click Sodium installation",
          "960px catalog layout",
        ],
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: Aurum window controls, creation, icons, filters and one-click real Modrinth install",
  );
} finally {
  for (const id of created) await rpc("deleteProfile", { id });
  await browser.close();
}

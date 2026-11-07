import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, language = "ru", theme = "light") {
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const state = {
        profiles: [],
        accounts: [],
        selectedAccount: null,
        running: [],
        dataDir: "C:/Aurum Launcher/Game Files",
        settings: {
          language,
          theme,
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
      };
      const storage = {
        totalBytes: 8 * 1024 ** 3,
        cleanableBytes: 1024 ** 3,
        gameDirectory: state.dataDir,
        launcherDirectory: "C:/Aurum Launcher/Launcher",
        categories: [
          { id: "profiles", bytes: 5 * 1024 ** 3, cleanable: false },
          { id: "minecraft", bytes: 1024 ** 3, cleanable: false },
          { id: "java", bytes: 1024 ** 3, cleanable: false },
          { id: "cache", bytes: 700 * 1024 ** 2, cleanable: true },
          { id: "temporary", bytes: 200 * 1024 ** 2, cleanable: true },
          { id: "logs", bytes: 1024 ** 2, cleanable: true },
          { id: "trash", bytes: 123 * 1024 ** 2, cleanable: true },
        ],
        profiles: [
          {
            id: "active",
            name: "My world",
            bytes: 5 * 1024 ** 3,
            kind: "profile",
            inUse: true,
          },
        ],
        installations: [
          {
            id: "java/java-21",
            name: "java-21",
            bytes: 1024 ** 3,
            kind: "java",
            inUse: true,
          },
          {
            id: "version/1.19",
            name: "1.19",
            bytes: 1024 ** 2,
            kind: "version",
            inUse: false,
          },
        ],
        trash: [
          {
            id: "deleted-one",
            name: "Deleted world",
            bytes: 100 * 1024 ** 2,
            kind: "profile",
            restorable: true,
            deletedAt: 1794000000,
          },
          {
            id: "content/deleted-two",
            name: "Old shader",
            bytes: 23 * 1024 ** 2,
            kind: "content",
            restorable: true,
            deletedAt: 1794000001,
          },
        ],
        browserCleanupPending: false,
      };
      w.storageRequests = [];
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback() {
          return 1;
        },
        async invoke(command: string, args: any) {
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.storageRequests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "storageSnapshot") return structuredClone(storage);
          if (action === "storageTrash") {
            storage.trash = storage.trash.filter(
              (e) => !payload.ids.includes(e.id),
            );
            return 123;
          }
          if (action === "storageClean") {
            storage.categories.find((c) => c.id === payload.category)!.bytes =
              0;
            if (payload.category === "cache")
              storage.browserCleanupPending = true;
            return 1024;
          }
          if (action === "storageRemoveVersion") {
            storage.installations = storage.installations.filter(
              (e) => e.id !== payload.id,
            );
            return 1024;
          }
          if (action === "recentServers" || action === "featured") return [];
          return null;
        },
      };
    },
    { language, theme },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  const destination = page.getByRole("button", { name: /Хранилище/ });
  await expect(destination.locator("..")).toHaveClass("settings-form");
  await expect(destination.locator("xpath=preceding-sibling::*[1]")).toContainText("Файлы и версии");
  await expect(page.getByRole("button", { name: "Изменить папку данных", exact: true }))
    .toHaveClass(/\bbutton secondary\b/);
  await destination.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `.test-data/screenshots/storage-placement-${theme}.png` });
  await page.getByRole("button", { name: /Хранилище/ }).click();
  await expect(
    page.getByRole("heading", { name: "Хранилище", exact: true }),
  ).toBeVisible();
}

test("storage shows real categories and protects used versions", async ({
  page,
}) => {
  await fixture(page);
  await expect(
    page.getByRole("img", { name: "Распределение занятого места" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Удалить версию java-21" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Удалить версию 1.19" }).click();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Удалить версию 1.19" }),
  ).toHaveCount(0);
});
test("trash selection restores only selected items and permanent deletion requires confirmation", async ({
  page,
}) => {
  await fixture(page, "ru", "dark");
  await page
    .getByRole("checkbox", { name: "Выбрать Deleted world", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Восстановить выбранное", exact: true })
    .click();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать Deleted world", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "Выбрать Old shader", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).storageRequests.find(
          (r: any) => r.action === "storageTrash",
        ).payload,
    ),
  ).toEqual({ ids: ["deleted-one"], restore: true });
  await page
    .getByRole("button", { name: "Очистить корзину", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Выбрать Old shader", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Очистить корзину", exact: true })
    .click();
  await page.getByRole("button", { name: "Продолжить", exact: true }).click();
  await expect(page.getByText("Корзина пуста", { exact: true })).toBeVisible();
});
test("cache cleanup preserves settings and schedules browser cache clearing on restart", async ({
  page,
}) => {
  await fixture(page);
  const card = page
    .locator(".storage-cleanup-card")
    .filter({ has: page.getByRole("heading", { name: "Кэш", exact: true }) });
  await card.getByRole("button", { name: "Очистить", exact: true }).click();
  await expect(
    page.getByText(
      "Очистка кэша интерфейса запланирована. Настройки и входы сохранятся.",
    ),
  ).toBeVisible();
  const calls = await page.evaluate(() =>
    (window as any).storageRequests.filter((r: any) =>
      ["storageClean", "saveSettings", "deleteProfile"].includes(r.action),
    ),
  );
  expect(calls).toEqual([
    { action: "storageClean", payload: { category: "cache" } },
  ]);
});

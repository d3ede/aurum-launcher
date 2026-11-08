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
          { id: "horizon", bytes: 889 * 1024 ** 2, cleanable: false },
          { id: "hosting", bytes: 1024 ** 2, cleanable: false },
          { id: "launcher", bytes: 69 * 1024 ** 2, cleanable: false },
          { id: "other", bytes: 10 * 1024, cleanable: false },
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
          if (action === "saveSettings") {
            state.settings = structuredClone(payload.settings);
            return structuredClone(state.settings);
          }
          if (action === "chooseJava") return "C:/Java/bin/java.exe";
          if (action === "checkJava") {
            if (w.javaCheckFails) throw new Error("Java is not available");
            return 17;
          }
          if (action === "changeDataDirectory")
            return w.cancelDirectory ? null : "C:/New Aurum/Game Files";
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
          if (action === "storageRemoveComponent") {
            storage.categories.find((c) => c.id === payload.category)!.bytes =
              0;
            if (payload.category === "profiles") {
              storage.trash.push({
                id: "all-profiles",
                name: "My world",
                bytes: 5 * 1024 ** 3,
                kind: "profile",
                restorable: true,
                deletedAt: 1794000100,
              });
              storage.profiles = [];
              return 0;
            }
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
  await expect(destination.locator("..")).toHaveClass("settings-destinations");
  await expect(
    destination.locator("xpath=preceding-sibling::*[1]"),
  ).toContainText("Внешний вид");
  await expect(
    page.getByRole("button", { name: "Изменить папку данных", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Путь к Java", exact: true }),
  ).toHaveCount(0);
  await destination.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `.test-data/screenshots/storage-placement-${theme}.png`,
  });
  await page.getByRole("button", { name: /Хранилище/ }).click();
  await expect(
    page.getByRole("heading", { name: "Хранилище", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Изменить папку данных", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("textbox", { name: "Путь к Java", exact: true }),
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

for (const theme of ["light", "dark"]) {
  test(`component removal has its own dialog, confirmation and cancellation in ${theme}`, async ({
    page,
  }) => {
    await fixture(page, "ru", theme);
    const entry = page.getByRole("button", {
      name: "Удаление компонентов",
      exact: true,
    });
    const card = entry.locator("..");
    await expect(card).toHaveClass(/storage-components-card/);
    await expect(
      card.locator("..").locator("xpath=following-sibling::*[1]"),
    ).toHaveClass(/storage-java-settings/);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.test-data/screenshots/components-card-${theme}.png`,
    });
    await entry.click();
    const list = page.getByRole("dialog", {
      name: "Удаление компонентов",
      exact: true,
    });
    await list.locator(".storage-component-list").hover();
    await page.mouse.wheel(0, 900);
    await expect(
      list.getByRole("button", {
        name: "Удалить компонент Корзина",
        exact: true,
      }),
    ).toBeInViewport();
    await expect(
      list.getByRole("button", {
        name: "Удалить компонент Общие файлы Minecraft",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(
      list.getByRole("button", { name: "Удалить компонент Java", exact: true }),
    ).toBeEnabled();
    await list
      .getByRole("button", { name: "Удалить компонент Horizon", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Удалить «Horizon»?",
      exact: true,
    });
    await expect(confirmation).toContainText(
      "Сборки, миры, моды и настройки сохранятся",
    );
    await expect(confirmation).toContainText("889");
    await confirmation
      .getByRole("button", { name: "Отмена", exact: true })
      .click();
    expect(
      await page.evaluate(() =>
        (window as any).storageRequests.filter(
          (r: any) => r.action === "storageRemoveComponent",
        ),
      ),
    ).toEqual([]);
    await expect(list).toBeVisible();
    await page.screenshot({
      path: `.test-data/screenshots/components-dialog-${theme}.png`,
    });
    await list
      .getByRole("button", { name: "Удалить компонент Horizon", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Удалить «Horizon»?", exact: true })
      .getByRole("button", { name: "Удалить", exact: true })
      .click();
    await expect(
      list.getByRole("button", {
        name: "Удалить компонент Horizon",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).storageRequests.filter(
          (r: any) => r.action === "storageRemoveComponent",
        ),
      ),
    ).toEqual([
      { action: "storageRemoveComponent", payload: { category: "horizon" } },
    ]);
    await list.getByRole("button", { name: "Закрыть", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Где хранятся файлы", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Лаунчер и игровые данные разделены. Общие ресурсы не дублируются для каждой сборки.",
        { exact: true },
      ),
    ).toHaveCount(0);
  });
}

test("bulk profile removal explains recovery and leaves individual controls below", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Удаление компонентов", exact: true })
    .click();
  const list = page.getByRole("dialog", {
    name: "Удаление компонентов",
    exact: true,
  });
  await list
    .getByRole("button", {
      name: "Удалить компонент Сборки и миры",
      exact: true,
    })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Удалить «Сборки и миры»?",
    exact: true,
  });
  await expect(confirmation).toContainText(
    "Место освободится после очистки корзины",
  );
  await confirmation
    .getByRole("button", { name: "В корзину", exact: true })
    .click();
  await expect(
    list.getByRole("button", {
      name: "Удалить компонент Сборки и миры",
      exact: true,
    }),
  ).toHaveCount(0);
  await list.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByText("My world", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Восстановить My world", exact: true }),
  ).toBeVisible();
});

test("launcher removal opens the uninstaller only after confirmation", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Удаление компонентов", exact: true })
    .click();
  const list = page.getByRole("dialog", {
    name: "Удаление компонентов",
    exact: true,
  });
  await list
    .getByRole("button", { name: "Удалить компонент Лаунчер", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Удалить «Лаунчер»?",
    exact: true,
  });
  await expect(confirmation).toContainText("Откроется деинсталлятор");
  expect(
    await page.evaluate(() =>
      (window as any).storageRequests.filter(
        (r: any) => r.action === "uninstall",
      ),
    ),
  ).toEqual([]);
  await confirmation
    .getByRole("button", { name: "Открыть деинсталлятор", exact: true })
    .click();
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as any).storageRequests.filter(
            (r: any) => r.action === "uninstall",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(() =>
      (window as any).storageRequests.filter(
        (r: any) => r.action === "storageRemoveComponent",
      ),
    ),
  ).toEqual([]);
});

for (const theme of ["light", "dark"]) {
  test(`storage owns Java, folders and version preferences without verbose hints in ${theme}`, async ({
    page,
  }) => {
    await fixture(page, "ru", theme);
    const files = page.getByRole("region", {
      name: "Файлы и версии",
      exact: true,
    });
    await expect(
      files.getByRole("heading", { name: "Где хранятся файлы", exact: true }),
    ).toBeVisible();
    await expect(
      files.getByText("C:/Aurum Launcher/Game Files", { exact: true }),
    ).toBeVisible();
    await expect(
      files.getByText("C:/Aurum Launcher/Launcher", { exact: true }),
    ).toBeVisible();
    const java = page.getByRole("region", { name: "Java", exact: true });
    const path = java.getByRole("textbox", {
      name: "Путь к Java",
      exact: true,
    });
    await expect(path).toHaveValue("");
    await expect(
      java.getByRole("button", { name: "Проверить Java", exact: true }),
    ).toHaveCount(0);
    for (const text of [
      "Оставьте достаточно памяти для операционной системы. Для каждой сборки можно задать отдельное значение.",
      "Память и classpath Aurum задаёт сам. Оставьте поле пустым, если дополнительные параметры не нужны.",
      "Подходящий runtime устанавливается автоматически",
      "Пустое поле — автоматическая установка Eclipse Temurin. Для новых версий игры требуется новая Java.",
    ])
      await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    await java.getByRole("button", { name: "Обзор", exact: true }).click();
    await expect(path).toHaveValue("C:/Java/bin/java.exe");
    await java
      .getByRole("button", { name: "Проверить Java", exact: true })
      .click();
    await expect(java.getByRole("status")).toHaveText("Java 17 — доступна");
    await java.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `.test-data/screenshots/storage-java-${theme}.png`,
    });
    await java.getByRole("button", { name: "Сохранить", exact: true }).click();
    await files
      .getByRole("checkbox", {
        name: "Показывать снапшоты Minecraft",
        exact: true,
      })
      .check();
    await expect(files.getByRole("checkbox")).toBeChecked();
    let saved = await page.evaluate(
      () =>
        (window as any).storageRequests
          .filter((r: any) => r.action === "saveSettings")
          .at(-1).payload.settings,
    );
    expect(saved.javaPath).toBe("C:/Java/bin/java.exe");
    expect(saved.showSnapshots).toBe(true);
    expect(saved.ramMb).toBe(4096);
    expect(saved.theme).toBe(theme);
    await java
      .getByRole("button", { name: "Автоматически", exact: true })
      .click();
    await expect(path).toHaveValue("");
    saved = await page.evaluate(
      () =>
        (window as any).storageRequests
          .filter((r: any) => r.action === "saveSettings")
          .at(-1).payload.settings,
    );
    expect(saved.javaPath).toBe("");
    expect(saved.showSnapshots).toBe(true);
    await page.setViewportSize({ width: 960, height: 680 });
    await files.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.test-data/screenshots/storage-files-minimum-${theme}.png`,
    });
  });
}

test("editing Java clears its previous check and a failed check stays actionable", async ({
  page,
}) => {
  await fixture(page);
  const java = page.getByRole("region", { name: "Java", exact: true });
  const input = java.getByRole("textbox", { name: "Путь к Java", exact: true });
  await input.fill("C:/Java/bin/java.exe");
  await java
    .getByRole("button", { name: "Проверить Java", exact: true })
    .click();
  await expect(java.getByRole("status")).toHaveText("Java 17 — доступна");
  await input.fill("C:/Other Java/bin/java.exe");
  await expect(java.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).javaCheckFails = true;
  });
  await java
    .getByRole("button", { name: "Проверить Java", exact: true })
    .click();
  await expect(java.getByRole("status")).toHaveText(
    "Проверка Java не пройдена",
  );
  await expect(
    java.getByRole("button", { name: "Проверить Java", exact: true }),
  ).toBeEnabled();
});

test("folder relocation supports cancellation and presents restart only after a new folder is selected", async ({
  page,
}) => {
  await fixture(page);
  const files = page.getByRole("region", {
    name: "Файлы и версии",
    exact: true,
  });
  await page.evaluate(() => {
    (window as any).cancelDirectory = true;
  });
  await files
    .getByRole("button", { name: "Изменить папку данных", exact: true })
    .click();
  await expect(
    files.getByRole("button", { name: "Перезапустить Aurum", exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).cancelDirectory = false;
  });
  await files
    .getByRole("button", { name: "Изменить папку данных", exact: true })
    .click();
  await expect(files.getByRole("status")).toContainText(
    "C:/New Aurum/Game Files",
  );
  await expect(
    files.getByRole("button", { name: "Изменить папку данных", exact: true }),
  ).toBeDisabled();
  await files
    .getByRole("button", { name: "Перезапустить Aurum", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).storageRequests.filter(
          (r: any) => r.action === "restart",
        ).length,
    ),
  ).toBe(1);
});

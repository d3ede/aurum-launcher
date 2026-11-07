import { expect, test, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  options: {
    seed?: boolean;
    pause?: boolean;
    running?: boolean;
    language?: string;
    manualRemaining?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    localStorage.setItem("aurum:language", options.language || "ru");
    const w = window as any;
    w.isTauri = true;
    w.favoriteRequests = [];
    const project = (id: string, kind = "mod", source = "modrinth") => ({
      id,
      kind,
      source,
      title: `${source} ${id}`,
      author: "Publisher",
      description: "A saved project",
      icon: null,
      downloads: 120,
    });
    const projects = [
      project("good"),
      project("broken"),
      project("incompatible"),
      project("good", "mod", "curseforge"),
      project("pack", "modpack"),
      project("manual", "modpack", "atlauncher"),
      project("shade", "shader"),
    ];
    const storage = "aurum:favorites:D:/Aurum-favorite-fixture";
    if (options.seed && !localStorage.getItem(storage))
      localStorage.setItem(
        storage,
        JSON.stringify(projects.map((project) => ({ project }))),
      );
    const base = {
      minecraft: "1.21.1",
      loader: "fabric",
      loaderVersion: "0.16.0",
      installedVersion: "1.21.1",
      ramMb: null,
      jvmArgs: "",
      lastPlayed: null,
      cover: 0,
      content: [],
    };
    const profiles = JSON.parse(
      localStorage.getItem("test:favorite-profiles") || "null",
    ) || [
      { ...base, id: "fabric", name: "Fabric instance" },
      { ...base, id: "forge", name: "Forge instance", loader: "forge" },
    ];
    const state = {
      profiles,
      accounts: [],
      selectedAccount: null,
      running: options.running ? ["fabric"] : [],
      dataDir: "D:/Aurum-favorite-fixture",
      curseforgeConfigured: true,
      settings: {
        language: options.language || "ru",
        theme: "dark",
        javaPath: "",
        ramMb: 4096,
        jvmArgs: "",
        resolutionWidth: 1280,
        resolutionHeight: 820,
        showSnapshots: false,
      },
    };
    const saveProfiles = () =>
      localStorage.setItem("test:favorite-profiles", JSON.stringify(profiles));
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
        w.favoriteRequests.push({ action, payload });
        if (action === "snapshot") return structuredClone(state);
        if (action === "versions")
          return {
            latest: { release: "1.21.1" },
            versions: [{ id: "1.21.1", type: "release" }],
          };
        if (action === "catalogCategories") return [];
        if (action === "search")
          return {
            projects: projects.filter(
              (p) =>
                p.source === payload.query.source &&
                p.kind === payload.query.kind,
            ),
            total: 3,
          };
        if (action === "project") {
          const selected = projects.find(
            (p) => p.id === payload.id && p.source === payload.source,
          )!;
          return {
            project: selected,
            url: "https://example.test/project",
            body: "Project details",
            gallery: [],
            versions: [
              {
                id: "v1",
                name: "Latest",
                gameVersions: [
                  payload.id === "incompatible" ? "26.3" : "1.21.1",
                ],
                loaders: ["fabric"],
              },
              {
                id: "v0",
                name: "Older",
                gameVersions: ["1.20.1"],
                loaders: ["fabric"],
              },
            ],
          };
        }
        if (action === "packRequirements")
          return {
            optional: [
              {
                id: "extra",
                name: "Extra mod",
                selected: !!payload.options?.optional?.includes("extra"),
                description: "Optional",
              },
            ],
            manualFiles:
              payload.projectId === "manual"
                ? [
                    {
                      id: "author",
                      name: "Publisher file",
                      url: "https://example.test/file",
                    },
                  ]
                : [],
            fileCount: 3,
          };
        if (action === "choosePackFile") return "D:/fixture/publisher.jar";
        if (action === "installContent") {
          if (
            options.pause &&
            payload.projectId === "good" &&
            payload.source === "modrinth"
          )
            await new Promise((resolve, reject) => {
              w.favoritePending = { resolve, reject };
            });
          if (payload.projectId === "broken")
            throw new Error("Publisher denied automatic downloads");
          profiles
            .find((p: any) => p.id === payload.id)
            .content.push({
              id: `${payload.source}:${payload.projectId}`,
              source: payload.source,
              projectId: payload.projectId,
              versionId: payload.versionId,
              name: payload.projectId,
              filename: "mod.jar",
              kind: "mod",
              enabled: true,
            });
          saveProfiles();
          return null;
        }
        if (action === "downloadPack") {
          if (
            payload.projectId === "manual" &&
            !payload.options?.manualFiles?.author
          )
            throw new Error("A manual file is required");
          const id = `installed-${payload.projectId}`;
          profiles.push({
            ...base,
            id,
            name: id,
            ...(options.manualRemaining && payload.projectId === "pack"
              ? {
                  manualDownloads: [
                    {
                      name: "Publisher jar",
                      path: "mods/restricted.jar",
                      url: "https://example.test/file",
                      sha1: "0".repeat(40),
                      reason: "restricted",
                    },
                  ],
                }
              : {}),
          });
          saveProfiles();
          return id;
        }
        if (action === "cancel") {
          w.favoritePending?.reject(new Error("Cancelled"));
          return null;
        }
        if (action === "scanPackDownloads") return 0;
        if (action === "saveSettings") {
          state.settings = payload.settings;
          return null;
        }
        return null;
      },
    };
  }, options);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: options.language === "uk" ? "Каталог проєктів" : "Каталог проектов",
      exact: true,
    })
    .click();
  await expect(page.locator(".catalog-result").first()).toBeVisible();
}
async function open(page: Page) {
  await page.locator(".catalog-favorites-button").click();
  const dialog = page.getByRole("dialog", { name: "Избранное", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
const row = (page: Page, name: string) =>
  page
    .locator(".favorite-row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });

test("stars persist, work in details and keep projects from different sources distinct", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", {
      name: "Добавить modrinth good в избранное",
      exact: true,
    })
    .click();
  await expect(page.locator(".catalog-favorites-button")).toContainText("1");
  const star = await page.locator(".catalog-favorites-button").boundingBox();
  const view = await page.locator(".catalog-view-switch").boundingBox();
  expect(star!.x).toBeGreaterThan(view!.x + view!.width);
  await page.screenshot({
    path: ".test-data/screenshots/favorites-catalog.png",
    animations: "disabled",
  });
  await page.locator(".catalog-card").first().click();
  const details = page.getByRole("dialog", {
    name: "modrinth good",
    exact: true,
  });
  await expect(
    details.getByRole("button", { name: "Убрать modrinth good из избранного" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Плитки", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Источник проектов", exact: true })
    .click();
  await page.getByRole("option", { name: "CurseForge", exact: true }).click();
  await page
    .getByRole("button", { name: "Добавить curseforge good в избранное" })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Каталог проектов", exact: true })
    .click();
  const dialog = await open(page);
  await expect(dialog.locator(".favorite-row")).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "modrinth good", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "curseforge good", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Убрать curseforge good из избранного" })
    .click();
  await expect(dialog.locator(".favorite-row")).toHaveCount(1);
});

test("bulk installation skips incompatible and manual projects, continues after failures and remembers packs", async ({
  page,
}) => {
  await fixture(page, { seed: true });
  const dialog = await open(page);
  await expect(row(page, "modrinth incompatible")).toContainText(
    "нет совместимой версии",
  );
  await expect(row(page, "atlauncher manual")).toContainText(
    "Проверьте параметры модпака",
  );
  await expect(
    dialog.getByRole("button", {
      name: /Установить выбранное · [1-9]/,
      exact: true,
    }),
  ).toBeEnabled();
  await page.screenshot({
    path: ".test-data/screenshots/favorites-dark.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: /Установить выбранное · [1-9]/, exact: true })
    .click();
  await expect(dialog.locator(".favorites-summary")).toHaveText(
    "Установлено: 4. Ошибок: 1.",
  );
  await expect(row(page, "modrinth broken")).toContainText("Publisher denied");
  const calls = await page.evaluate(() =>
    (window as any).favoriteRequests.filter((r: any) =>
      ["installContent", "downloadPack"].includes(r.action),
    ),
  );
  expect(calls.map((r: any) => r.payload.projectId)).toEqual([
    "good",
    "broken",
    "good",
    "pack",
    "shade",
  ]);
  expect(
    calls
      .filter((r: any) => r.action === "installContent")
      .every(
        (r: any) => r.payload.id === "fabric" && r.payload.versionId === "v1",
      ),
  ).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Каталог проектов", exact: true })
    .click();
  await open(page);
  await expect(row(page, "modrinth pack")).toContainText("Установлено");
  await expect(
    row(page, "modrinth pack").getByRole("button", {
      name: "Установить modrinth pack",
      exact: true,
    }),
  ).toBeDisabled();
});

test("manual file selection and optional mods remain required for platform packs", async ({
  page,
}) => {
  await fixture(page, { seed: true });
  await open(page);
  const manual = row(page, "atlauncher manual");
  await expect(
    manual.getByRole("button", {
      name: "Установить atlauncher manual",
      exact: true,
    }),
  ).toBeDisabled();
  await manual.locator("summary").click();
  await manual.getByRole("checkbox", { name: /Extra mod/ }).check();
  await manual
    .getByRole("button", { name: "Выбрать файл", exact: true })
    .click();
  await expect(
    manual.getByRole("button", {
      name: "Установить atlauncher manual",
      exact: true,
    }),
  ).toBeEnabled();
  await manual
    .getByRole("button", { name: "Установить atlauncher manual", exact: true })
    .click();
  await expect(page.locator(".favorites-summary")).toContainText(
    "Установлено: 1",
  );
  const payload = await page.evaluate(
    () =>
      (window as any).favoriteRequests.find(
        (r: any) => r.action === "downloadPack",
      ).payload,
  );
  expect(payload.options).toEqual({
    optional: ["extra"],
    manualFiles: { author: "D:/fixture/publisher.jar" },
  });
});

test("install selected only processes the checked projects", async ({
  page,
}) => {
  await fixture(page, { seed: true });
  const dialog = await open(page);
  await dialog
    .getByRole("checkbox", { name: "Выбрать все", exact: true })
    .uncheck();
  await row(page, "curseforge good").getByRole("checkbox").check();
  await row(page, "modrinth shade").getByRole("checkbox").check();
  const install = dialog.getByRole("button", {
    name: "Установить выбранное · 2",
    exact: true,
  });
  await expect(install).toBeEnabled();
  await install.click();
  await expect(dialog.locator(".favorites-summary")).toHaveText(
    "Установлено: 2. Ошибок: 0.",
  );
  expect(
    await page.evaluate(() =>
      (window as any).favoriteRequests
        .filter((r: any) => r.action === "installContent")
        .map((r: any) => `${r.payload.source}:${r.payload.projectId}`),
    ),
  ).toEqual(["curseforge:good", "modrinth:shade"]);
});

test("clear favorites confirms only the checked projects and keeps cancellation and saved lists intact", async ({
  page,
}) => {
  await fixture(page, { seed: true });
  const dialog = await open(page);
  await expect(dialog.locator(".favorites-actions > button")).toHaveCount(1);
  await expect(dialog).not.toContainText("Проверяем Minecraft и загрузчик");
  await dialog
    .getByRole("combobox", { name: "Установить в сборку", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Выберите сборку", exact: true })
    .click();
  await expect(dialog).not.toContainText(
    "Выберите подходящую сборку для этого проекта.",
  );
  await expect(
    row(page, "modrinth good").getByRole("button", {
      name: "Установить modrinth good",
      exact: true,
    }),
  ).toBeDisabled();
  const clear = dialog.getByRole("button", {
    name: "Очистить избранное",
    exact: true,
  });
  await dialog
    .getByRole("checkbox", { name: "Выбрать все", exact: true })
    .uncheck();
  await expect(clear).toBeDisabled();
  await row(page, "curseforge good").getByRole("checkbox").check();
  await row(page, "modrinth pack").getByRole("checkbox").check();
  const clearBox = await clear.boundingBox();
  const retryBox = await dialog
    .getByRole("button", { name: "Проверить снова", exact: true })
    .boundingBox();
  expect(clearBox!.x + clearBox!.width).toBeLessThan(retryBox!.x);
  await clear.click();
  const confirm = page.getByRole("dialog", {
    name: "Убрать выбранные проекты из избранного?",
    exact: true,
  });
  await expect(confirm).toContainText("Выбрано проектов: 2.");
  await confirm.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(dialog.locator(".favorite-row")).toHaveCount(7);
  await clear.click();
  await confirm
    .getByRole("button", { name: "Очистить избранное", exact: true })
    .click();
  await expect(dialog.locator(".favorite-row")).toHaveCount(5);
  await expect(row(page, "curseforge good")).toHaveCount(0);
  await expect(row(page, "modrinth pack")).toHaveCount(0);
  await expect(row(page, "modrinth good")).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (window as any).favoriteRequests.filter((r: any) =>
        [
          "installContent",
          "downloadPack",
          "removeProfile",
          "removeContent",
        ].includes(r.action),
      ),
    ),
  ).toHaveLength(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Каталог проектов", exact: true })
    .click();
  await open(page);
  await expect(page.locator(".favorite-row")).toHaveCount(5);
});

test("cancelling a batch does not start the next item or remove saved favorites", async ({
  page,
}) => {
  await fixture(page, { seed: true, pause: true });
  const dialog = await open(page);
  await dialog
    .getByRole("button", { name: /Установить выбранное · [1-9]/, exact: true })
    .click();
  await expect(row(page, "modrinth good")).toContainText("Установка…");
  await expect(
    dialog.getByRole("button", { name: "Закрыть диалог" }),
  ).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Остановить очередь", exact: true })
    .click();
  await expect(dialog.locator(".favorites-summary")).toContainText(
    "Очередь остановлена",
  );
  expect(
    await page.evaluate(
      () =>
        (window as any).favoriteRequests.filter((r: any) =>
          ["installContent", "downloadPack"].includes(r.action),
        ).length,
    ),
  ).toBe(1);
  await expect(dialog.locator(".favorite-row")).toHaveCount(7);
});

test("running profiles block content changes; compact Ukrainian favorites stay inside the window", async ({
  page,
}) => {
  await fixture(page, { seed: true, running: true, language: "uk" });
  await page.setViewportSize({ width: 960, height: 680 });
  await page.locator(".catalog-favorites-button").click();
  const dialog = page.getByRole("dialog", { name: "Обране", exact: true });
  await expect(row(page, "modrinth good")).toContainText("Спочатку зупиніть");
  await expect(
    row(page, "modrinth good").getByRole("button", {
      name: "Установити modrinth good",
      exact: true,
    }),
  ).toBeDisabled();
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    false,
  );
  await expect(dialog).not.toContainText(/[ыэёъ�⁇]/i);
  await page.screenshot({
    path: ".test-data/screenshots/favorites-uk-compact.png",
    animations: "disabled",
  });
});

test("incomplete pack imports remain accessible from favorites without creating another instance", async ({
  page,
}) => {
  await fixture(page, { seed: true, manualRemaining: true });
  await open(page);
  await row(page, "modrinth pack")
    .getByRole("button", { name: "Установить modrinth pack", exact: true })
    .click();
  const manual = page.getByRole("dialog", {
    name: "Нужна ручная установка",
    exact: true,
  });
  await expect(manual).toContainText("Publisher jar");
  await manual
    .getByRole("button", { name: "Продолжить позже", exact: true })
    .click();
  await expect(row(page, "modrinth pack")).toContainText(
    "Остались файлы для ручной установки",
  );
  await row(page, "modrinth pack")
    .getByRole("button", { name: "Показать файлы", exact: true })
    .click();
  await expect(manual).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).favoriteRequests.filter(
          (r: any) => r.action === "downloadPack",
        ).length,
    ),
  ).toBe(1);
});

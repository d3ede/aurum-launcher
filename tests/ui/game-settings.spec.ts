import { expect, test, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  { theme = "dark", count = 1, running = false, language = "ru" } = {},
) {
  await page.addInitScript(
    ({ theme, count, running, language }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      w.requests = [];
      const raw =
        'version:3955\nfov:0.5\nmouseSensitivity:0.4\nkey_key.forward:key.keyboard.w\nkey_key.jump:key.keyboard.space\nsoundCategory_master:0.75\nsoundCategory_music:0.25\nlang:ru_ru\nguiScale:3\ncustomModOption:keep:exact\nresourcePacks:["pack"]\n';
      const groups = [
        "graphics",
        "fov",
        "controls",
        "mouse",
        "sound",
        "interface",
      ];
      const state = {
        profiles: [
          {
            id: "source",
            name: "Уютный мир",
            minecraft: "1.21.1",
            loader: "fabric",
            loaderVersion: "0.16.14",
            installedVersion: "1.21.1",
            ramMb: null,
            jvmArgs: "",
            lastPlayed: null,
            cover: 0,
            content: [],
          },
          {
            id: "legacy",
            name: "Старая сборка",
            minecraft: "1.12.2",
            loader: "vanilla",
            loaderVersion: null,
            installedVersion: "1.12.2",
            ramMb: null,
            jvmArgs: "",
            lastPlayed: null,
            cover: 1,
            content: [],
          },
        ],
        gameSettingsProfiles: Array.from({ length: count }, (_, i) => ({
          id: `preset-${i}`,
          name: i === 0 ? "Основной" : `Профиль ${i + 1}`,
          sourceVersion: "1.21.1",
          sourceName: "Уютный мир",
          options: raw,
          categories: groups,
        })),
        accounts: [],
        selectedAccount: null,
        running: running ? ["source"] : [],
        dataDir: "D:/Aurum-game-settings",
        curseforgeConfigured: true,
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
      w.gameState = state;
      w.sourceOptions = raw;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback() {
          return 1;
        },
        async invoke(cmd: string, args: any) {
          if (cmd !== "rpc") return cmd.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.requests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "gameSettings.save") {
            const p = structuredClone(payload.preset),
              i = state.gameSettingsProfiles.findIndex((x) => x.id === p.id);
            if (i >= 0) state.gameSettingsProfiles[i] = p;
            else state.gameSettingsProfiles.push(p);
            return p;
          }
          if (action === "gameSettings.capture") {
            const source = state.profiles.find(
              (p) => p.id === payload.profileId,
            )!;
            const p = {
              id:
                payload.replaceId ??
                `captured-${state.gameSettingsProfiles.length}`,
              name: payload.name,
              sourceVersion: source.minecraft,
              sourceName: source.name,
              options: raw,
              categories: groups,
            };
            const i = state.gameSettingsProfiles.findIndex(
              (x) => x.id === p.id,
            );
            if (i >= 0) state.gameSettingsProfiles[i] = p;
            else state.gameSettingsProfiles.push(p);
            return structuredClone(p);
          }
          if (action === "gameSettings.delete") {
            state.gameSettingsProfiles = state.gameSettingsProfiles.filter(
              (p) => p.id !== payload.id,
            );
            return null;
          }
          if (action === "gameSettings.apply")
            return { applied: 8, skipped: ["simulationDistance"] };
          if (action === "versions")
            return {
              latest: { release: "1.21.1" },
              versions: [{ id: "1.21.1", type: "release" }],
            };
          if (action === "loaders") return ["0.16.14"];
          if (action === "createProfile") {
            const created = {
              ...state.profiles[0],
              ...payload,
              id: "new-instance",
            };
            state.profiles.push(created);
            return created;
          }
          if (action === "content") return [];
          if (action === "inspectContent")
            return { content: [], updates: [], warnings: [] };
          if (action === "search")
            return {
              projects: [
                {
                  id: "pack",
                  source: payload.query.source,
                  kind: "modpack",
                  title: "Test modpack",
                  description: "A Minecraft modpack",
                  author: "Author",
                  icon: null,
                  downloads: 100,
                },
              ],
              total: 1,
            };
          if (action === "project")
            return {
              project: {
                id: "pack",
                source: payload.source,
                kind: "modpack",
                title: "Test modpack",
                description: "",
                author: "Author",
                icon: null,
                downloads: 100,
              },
              body: "Description",
              gallery: [],
              versions: [
                {
                  id: "version",
                  name: "1.0",
                  gameVersions: ["1.21.1"],
                  loaders: ["fabric"],
                },
              ],
              url: "https://modrinth.com/modpack/test",
            };
          if (action === "downloadPack") return "installed-pack";
          if (action === "catalogCategories") return [];
          return null;
        },
      };
    },
    { theme, count, running, language },
  );
  await page.goto("/");
}
async function open(page: Page, language = "ru") {
  await page.locator(".sidebar nav button").last().click();
  await page
    .getByRole("button", {
      name:
        language === "en"
          ? "Game settings"
          : language === "uk"
            ? "Налаштування гри"
            : "Настройки игры",
      exact: true,
    })
    .click();
}
async function saved(page: Page) {
  return page.evaluate(
    () =>
      (window as any).requests
        .filter((r: any) => r.action === "gameSettings.save")
        .at(-1)?.payload.preset,
  );
}

test("imports an independent options copy, edits FOV, selects categories and saves the profile", async ({
  page,
}) => {
  await fixture(page, { count: 0 });
  await open(page);
  await page
    .locator(".game-settings-library")
    .getByRole("button", { name: "Импортировать из сборки", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Импортировать из сборки",
    exact: true,
  });
  await dialog.getByRole("combobox", { name: "Сборка-источник" }).click();
  await page
    .getByRole("option", { name: "Уютный мир · 1.21.1", exact: true })
    .click();
  await dialog.getByLabel("Название профиля").fill("Мой Minecraft");
  await dialog
    .getByRole("button", { name: "Импортировать настройки", exact: true })
    .click();
  await expect(
    page.getByLabel("Название профиля", { exact: true }),
  ).toHaveValue("Мой Minecraft");
  await page
    .getByRole("button", { name: "Настроить: Поле зрения", exact: true })
    .click();
  const camera = page.getByRole("dialog", { name: "Поле зрения", exact: true });
  await camera
    .getByRole("slider", { name: "Поле зрения", exact: true })
    .focus();
  await page.keyboard.press("End");
  await expect(camera.locator("output").first()).toHaveText("110°");
  await camera.getByRole("button", { name: "Готово", exact: true }).click();
  await page
    .getByRole("switch", { name: "Переносить: Графика", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Сохранить профиль", exact: true })
    .click();
  await expect
    .poll(() => saved(page))
    .toMatchObject({
      name: "Мой Minecraft",
      sourceVersion: "1.21.1",
      categories: ["fov", "controls", "mouse", "sound", "interface"],
    });
  expect((await saved(page)).options).toContain("fov:1\n");
  expect((await saved(page)).options).toContain("customModOption:keep:exact");
  expect(await page.evaluate(() => (window as any).sourceOptions)).toContain(
    "fov:0.5\n",
  );
});

test("key capture is independent, detects conflicts and Escape cancels only the capture", async ({
  page,
}) => {
  await fixture(page);
  await open(page);
  await page
    .getByRole("button", { name: "Настроить: Управление", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Управление", exact: true });
  await dialog
    .getByRole("button", { name: "Назначить: Прыжок", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Клавиша: Прыжок", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("KeyW");
  await expect(
    dialog.getByRole("button", { name: "Назначить: Прыжок", exact: true }),
  ).toHaveText("W");
  await expect(
    dialog.getByText(
      "Некоторым действиям назначена одна клавиша. Проверьте выделенные назначения.",
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Назначить: Вперёд", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Клавиша: Вперёд", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Сохранить профиль", exact: true }),
  ).toBeDisabled();
});

test("five-profile limit, deletion confirmation and replacing an import keep slots predictable", async ({
  page,
}) => {
  await fixture(page, { count: 5 });
  await open(page);
  await expect(
    page
      .locator(".game-settings-library")
      .getByRole("button", { name: "Создать профиль", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Обновить из сборки", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Импортировать из сборки",
    exact: true,
  });
  await expect(
    dialog.getByRole("checkbox", {
      name: "Заменить текущий профиль настроек",
      exact: true,
    }),
  ).toBeChecked();
  await dialog.getByRole("combobox", { name: "Сборка-источник" }).click();
  await page
    .getByRole("option", { name: "Старая сборка · 1.12.2", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Импортировать настройки", exact: true })
    .click();
  await expect(page.locator(".game-settings-profile")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Удалить профиль настроек", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await expect(page.locator(".game-settings-profile")).toHaveCount(5);
  await page
    .getByRole("button", { name: "Удалить профиль настроек", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить", exact: true })
    .click();
  await expect(page.locator(".game-settings-profile")).toHaveCount(4);
});

test("unfinished profile edits survive navigation and switching offers an explicit discard", async ({
  page,
}) => {
  await fixture(page, { count: 2 });
  await open(page);
  await page.getByLabel("Название профиля", { exact: true }).fill("Изменённый");
  await page.getByRole("button", { name: /02 Профиль 2/ }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Есть несохранённые изменения",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Назад к настройкам", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Настройки игры", exact: true })
    .click();
  await expect(
    page.getByLabel("Название профиля", { exact: true }),
  ).toHaveValue("Изменённый");
  await page.getByRole("button", { name: /02 Профиль 2/ }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Не сохранять", exact: true })
    .click();
  await expect(
    page.getByLabel("Название профиля", { exact: true }),
  ).toHaveValue("Профиль 2");
});

test("new-instance and catalog installation expose one profile choice without category switches", async ({
  page,
}) => {
  await fixture(page, { count: 2 });
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Новая сборка", exact: true })
    .first()
    .click();
  const create = page.getByRole("dialog", {
    name: "Новая сборка",
    exact: true,
  });
  await create
    .getByRole("checkbox", { name: "Использовать мои настройки", exact: true })
    .check();
  await create
    .getByRole("combobox", { name: "Профиль настроек", exact: true })
    .click();
  await page.getByRole("option", { name: "Профиль 2", exact: true }).click();
  await expect(create.getByRole("switch")).toHaveCount(0);
  await create
    .getByRole("button", { name: "Создать сборку", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).requests.find(
            (r: any) => r.action === "createProfile",
          )?.payload.gameSettingsProfileId,
      ),
    )
    .toBe("preset-1");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).requests.find((r: any) => r.action === "install")
            ?.payload.gameSettingsProfileId,
      ),
    )
    .toBe("preset-1");
  await page.getByRole("button",{name:"Все сборки",exact:true}).click();
  await page.locator(".sidebar nav button").nth(2).click();
  await page.getByRole("button", { name: "Модпаки", exact: true }).click();
  await page.locator(".catalog-card").first().click();
  const pack = page.getByRole("dialog", { name: "Test modpack", exact: true });
  await pack
    .getByRole("checkbox", { name: "Использовать мои настройки", exact: true })
    .check();
  await pack
    .getByRole("button", { name: "Создать сборку из модпака", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).requests.find((r: any) => r.action === "downloadPack")
            ?.payload.gameSettingsProfileId,
      ),
    )
    .toBe("preset-0");
});

for (const theme of ["light", "dark"]) {
  test(`settings and sound dialog fit the minimum window in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 });
    await fixture(page, { theme });
    await open(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `.test-data/screenshots/game-settings-${theme}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Настроить: Музыка и звуки", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Музыка и звуки",
      exact: true,
    });
    await expect(dialog.getByRole("slider")).toHaveCount(10);
    await expect(
      dialog.getByRole("button", { name: "Готово", exact: true }),
    ).toBeInViewport();
    await dialog.getByRole("slider", { name: "Музыка", exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(
      dialog.getByRole("slider", { name: "Музыка", exact: true }),
    ).toHaveValue("0");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.test-data/screenshots/game-settings-sound-${theme}.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "Готово", exact: true }).click();
  });
}

for (const language of ["en", "uk"])
  test(`game settings messages and editors are translated to ${language}`, async ({
    page,
  }) => {
    await fixture(page, { language });
    await open(page, language);
    await expect(page.locator(".game-settings-page")).not.toContainText(
      /@game\./,
    );
    await page
      .getByRole("button", {
        name: language === "en" ? "Configure Mouse" : "Налаштувати: Миша",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("slider")).toHaveCount(2);
    await expect(dialog).not.toContainText(/@game\./);
  });

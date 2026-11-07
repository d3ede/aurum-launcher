import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const steve = Array.from(readFileSync("src/assets/skins/wide-steve.png"));
const ari = Array.from(readFileSync("src/assets/skins/slim-ari.png"));
const zuri = Array.from(readFileSync("src/assets/skins/slim-zuri.png"));
async function fixture(
  page: Page,
  kind: "offline" | "microsoft" = "offline",
  theme = "light",
  importMode: "normal" | "empty" | "partial" | "error" = "normal",
  waitForPreview = true,
  slowAppearance = false,
) {
  await page.addInitScript(
    ({ steve, ari, zuri, kind, theme, importMode, slowAppearance }) => {
      localStorage.setItem("aurum:language", "ru");
      const w = window as any;
      w.isTauri = true;
      w.requests = [];
      const texture = (bytes: number[]) =>
        `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`;
      const account = {
        id: "skin-user",
        name: "CozyPlayer",
        uuid: "skin-user",
        kind,
        skinModel: "alex",
        hasSkin: true,
      };
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 32;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#cead57";
      ctx.fillRect(0, 0, 64, 32);
      ctx.fillStyle = "#516756";
      ctx.fillRect(2, 2, 8, 14);
      const capeTexture = canvas.toDataURL();
      const library = JSON.parse(
        localStorage.getItem("fixture:skins") || "null",
      ) || {
        skins: [
          {
            id: "saved-a",
            name: "Путешественник",
            model: "alex",
            texture: texture(ari),
            capeId: null,
          },
          {
            id: "saved-b",
            name: "Исследователь",
            model: "steve",
            texture: texture(steve),
            capeId: null,
          },
        ],
        capes: [],
        selections: { "skin-user": { skinId: "saved-a", capeId: null } },
      };
      if (w.noSelection) delete library.selections[account.id];
      const state = {
        profiles: [],
        accounts: [account],
        selectedAccount: account.id,
        settings: {
          language: "ru",
          theme,
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
        dataDir: "D:/Aurum-test",
        running: [],
        curseforgeConfigured: false,
      };
      let next = 0;
      let uploads = 0;
      const save = () =>
        localStorage.setItem("fixture:skins", JSON.stringify(library));
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback() {
          return ++next;
        },
        async invoke(command: string, args: any) {
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.requests.push({ action, payload });
          if (action === "snapshot") return state;
          if (action === "skinLibrary") return structuredClone(library);
          if (action === "browseSkins") {
            if (payload.query === "error")
              throw new Error("Слишком много запросов. Повторите через 60 с.");
            if (payload.query === "empty") return { skins: [], after: null };
            const result = {
              skins: [
                {
                  id: payload.after ? "b".repeat(32) : "a".repeat(32),
                  name:
                    payload.query === "unnamed"
                      ? null
                      : payload.query === "catalog-name"
                        ? "Имя из каталога"
                        : payload.after
                          ? "Explorer"
                          : "Knight",
                  shortId: "abcd1234",
                  hash: "c".repeat(64),
                },
              ],
              after: payload.after ? null : "a".repeat(32),
            };
            if (payload.query === "slow")
              return new Promise((resolve) => {
                w.resolveSkinSearch = () =>
                  resolve({
                    skins: [
                      {
                        id: "d".repeat(32),
                        name: "Stale",
                        hash: "c".repeat(64),
                      },
                    ],
                    after: null,
                  });
              });
            return result;
          }
          if (action === "skinBrowserTexture") return texture(zuri);
          if (action === "skinBrowserSkin") {
            if (payload.query === "missing")
              throw new Error("Скин или игрок не найден");
            return {
              id: `${payload.source}:${payload.query}`,
              name: ["unnamed", "catalog-name"].includes(
                w.requests.filter((r: any) => r.action === "browseSkins").at(-1)
                  ?.payload.query,
              )
                ? null
                : payload.source === "player"
                  ? payload.query
                  : "Knight",
              shortId: "abcd1234",
              model: "alex",
              texture: texture(zuri),
              capeId: null,
            };
          }
          if (action === "chooseModrinthDirectory") return "D:/Custom Modrinth";
          if (action === "importModrinthSkins") {
            if (importMode === "error")
              throw new Error(
                "Не удалось прочитать библиотеку скинов; исходный файл сохранён",
              );
            if (importMode === "empty" && !payload.directories.length)
              return { imported: 0, duplicates: 0, invalid: 0, warnings: [] };
            const imported = library.skins.some(
              (s: any) => s.id === "modrinth-skin",
            )
              ? 0
              : 1;
            if (imported)
              library.skins.push({
                id: "modrinth-skin",
                name: "Modrinth 3",
                model: "alex",
                texture: texture(zuri),
                capeId: null,
              });
            save();
            return {
              imported,
              duplicates: imported ? 0 : 1,
              invalid: importMode === "partial" ? 2 : 0,
              warnings:
                importMode === "partial" ? ["D:/Broken Modrinth/app.db"] : [],
            };
          }
          if (action === "accountSkinPreview") {
            if (slowAppearance)
              return new Promise((resolve) => {
                w.showPreview = () =>
                  resolve({ texture: texture(ari), model: "alex", capes: [] });
              });
            if (w.holdAppearance || w.appearanceFailure) return null;
            return {
              texture: texture(w.useSteve ? steve : ari),
              model: w.useSteve ? "steve" : "alex",
              capes: [],
            };
          }
          if (action === "accountAppearance") {
            if (slowAppearance)
              return new Promise((resolve) => {
                w.showAppearance = () =>
                  resolve({ texture: texture(ari), model: "alex", capes: [] });
              });
            if (w.holdAppearance)
              await new Promise<void>((resolve) => {
                w.releaseAppearance = resolve;
              });
            if (w.appearanceFailure) throw new Error("Appearance unavailable");
            return {
              texture: texture(w.useSteve ? steve : ari),
              model: w.useSteve ? "steve" : "alex",
              capes:
                kind === "microsoft"
                  ? [
                      {
                        id: "owned:00000000-0000-4000-8000-000000000001",
                        name: "Minecraft cape",
                        texture: capeTexture,
                        active: false,
                      },
                    ]
                  : [],
            };
          }
          if (action === "saveSettings") {
            state.settings = payload.settings;
            return null;
          }
          if (action === "defaultSkinTexture")
            return payload.id === "default:zuri" ? zuri : steve;
          if (action === "chooseSkinTexture")
            return {
              name: payload.cape ? "Мой плащ" : `Мой скин ${++uploads}`,
              bytes: payload.cape
                ? Array.from(atob(capeTexture.split(",")[1]), (c) =>
                    c.charCodeAt(0),
                  )
                : ari,
            };
          if (action === "saveLibrarySkin") {
            const s = {
              id: payload.id || `upload-${uploads}-${library.skins.length}`,
              name: payload.name,
              model: payload.model,
              texture: texture(payload.bytes),
              capeId: payload.capeId,
            };
            const index = library.skins.findIndex(
              (s: any) => s.id === payload.id,
            );
            if (index < 0) library.skins.push(s);
            else library.skins[index] = s;
            save();
            return s;
          }
          if (action === "saveLibraryCape") {
            const c = {
              id: "local-cape",
              name: payload.name,
              texture: texture(payload.bytes),
            };
            library.capes.push(c);
            save();
            return c;
          }
          if (action === "applyLibrarySkin") {
            library.selections[account.id] = {
              skinId: payload.skinId,
              capeId: payload.capeId,
            };
            save();
            return null;
          }
          if (action === "deleteLibraryItem") {
            library.skins = library.skins.filter(
              (s: any) => s.id !== payload.id,
            );
            save();
            return null;
          }
          throw new Error(`Unexpected action ${action}`);
        },
      };
    },
    { steve, ari, zuri, kind, theme, importMode, slowAppearance },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Скины и плащи", exact: true }),
  ).toBeVisible();
  if (!waitForPreview) return;
  await expect(page.locator(".wardrobe-character canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
}
test("skin browser renders models, previews and saves without applying to Microsoft", async ({
  page,
}) => {
  await fixture(page, "microsoft");
  const libraryGrid = page.locator(".wardrobe-grid").first();
  await expect(
    libraryGrid.locator(":scope > button").last(),
  ).toHaveAccessibleName("Браузер скинов");
  await page
    .getByRole("button", { name: "Браузер скинов", exact: true })
    .click();
  const browser = page.getByRole("dialog", {
    name: "Браузер скинов",
    exact: true,
  });
  const tile = browser.getByRole("button", { name: "Посмотреть скин Knight" });
  await expect(tile.locator("img")).toHaveAttribute(
    "data-thumbnail-ready",
    "true",
  );
  await tile.click();
  await expect(browser.locator("canvas")).toHaveAttribute("data-ready", "true");
  await expect(browser.getByText("Тонкие руки", { exact: true })).toBeVisible();
  await browser
    .getByRole("button", { name: "Добавить в библиотеку", exact: true })
    .click();
  await expect(
    browser.getByRole("button", { name: "Уже в библиотеке" }),
  ).toBeDisabled();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(
    requests.filter((r: any) => r.action === "saveLibrarySkin"),
  ).toHaveLength(1);
  expect(requests.some((r: any) => r.action === "applyLibrarySkin")).toBe(
    false,
  );
  for (const [width, height, theme] of [
    [1280, 820, "light"],
    [960, 680, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    if (theme === "dark") {
      await browser.getByRole("button", { name: "Закрыть диалог" }).click();
      await page.getByRole("button", { name: "Переключить тему" }).click();
      await page
        .getByRole("button", { name: "Браузер скинов", exact: true })
        .click();
      await browser
        .getByRole("button", { name: "Посмотреть скин Knight" })
        .click();
      await expect(browser.locator("canvas")).toHaveAttribute(
        "data-ready",
        "true",
      );
    }
    await expect(
      browser.getByRole("button", { name: "Уже в библиотеке" }),
    ).toBeInViewport();
    await expect(
      browser.getByRole("button", { name: "Закрыть диалог" }),
    ).toBeInViewport();
    expect(
      await browser.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: `.test-data/screenshots/skin-browser-${theme}.png`,
    });
  }
  await browser.getByRole("button", { name: "Закрыть диалог" }).click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Knight" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Knight" }),
  ).toBeVisible();
});

test("skin browser separates missing names and IDs and saves a custom name", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Браузер скинов", exact: true })
    .click();
  const browser = page.getByRole("dialog", {
    name: "Браузер скинов",
    exact: true,
  });
  await browser.getByRole("textbox", { name: "Поиск скинов" }).fill("unnamed");
  const tile = browser.getByRole("button", {
    name: "Посмотреть скин Без названия",
  });
  await expect(tile.getByText("Без названия", { exact: true })).toBeVisible();
  await expect(tile.getByText("ID: abcd1234", { exact: true })).toBeVisible();
  expect(
    await tile
      .locator(".browser-skin-id")
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeLessThan(12);
  await tile.click();
  await expect(
    browser.getByRole("heading", { name: "Без названия", exact: true }),
  ).toBeVisible();
  const name = browser.getByRole("textbox", { name: "Название образа" });
  await expect(name).toHaveValue("Без названия");
  const add = browser.getByRole("button", {
    name: "Добавить в библиотеку",
    exact: true,
  });
  await name.fill("   ");
  await expect(add).toBeDisabled();
  await name.fill("🐉".repeat(31));
  await expect(add).toBeDisabled();
  await name.fill("  Синий рыцарь  ");
  expect(await name.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
  await page.setViewportSize({ width: 960, height: 680 });
  await expect(name).toBeInViewport();
  await expect(add).toBeInViewport();
  await page.screenshot({
    path: ".test-data/screenshots/skin-browser-custom-name.png",
  });
  await add.click();
  await expect(
    browser.getByRole("button", { name: "Уже в библиотеке" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).requests
          .filter((r: any) => r.action === "saveLibrarySkin")
          .at(-1)?.payload.name,
    ),
  ).toBe("Синий рыцарь");
  await browser.getByRole("button", { name: "Закрыть диалог" }).click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Синий рыцарь" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Синий рыцарь" }),
  ).toBeVisible();
});

test("skin browser preserves a catalog name when details omit it", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Браузер скинов", exact: true })
    .click();
  const browser = page.getByRole("dialog", {
    name: "Браузер скинов",
    exact: true,
  });
  await browser
    .getByRole("textbox", { name: "Поиск скинов" })
    .fill("catalog-name");
  await browser
    .getByRole("button", { name: "Посмотреть скин Имя из каталога" })
    .click();
  await expect(
    browser.getByRole("heading", { name: "Имя из каталога", exact: true }),
  ).toBeVisible();
  await expect(
    browser.getByRole("textbox", { name: "Название образа" }),
  ).toHaveValue("Имя из каталога");
});

test("skin browser keeps one search focus border and menus match their triggers", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Браузер скинов", exact: true })
    .click();
  const browser = page.locator(".skin-browser-modal");
  await browser.getByRole("textbox", { name: "Поиск скинов" }).focus();
  expect(
    await browser
      .getByRole("textbox", { name: "Поиск скинов" })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).toBe("none");
  for (const label of ["Где искать скины", "Порядок скинов"]) {
    const trigger = browser.getByRole("combobox", {
      name: label,
      includeHidden: true,
    });
    await trigger.click();
    const menu = page.getByRole("listbox");
    await expect(menu).toBeVisible();
    expect(
      Math.abs(
        (await menu.boundingBox())!.width -
          (await trigger.boundingBox())!.width,
      ),
    ).toBeLessThanOrEqual(1);
    expect(await trigger.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(
      "none",
    );
    await menu.getByRole("option").nth(1).hover();
    const checked = menu.locator('[data-state="checked"]');
    expect(
      await checked.evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    await expect(menu.locator("[data-highlighted]")).toHaveCount(1);
    expect(await menu.evaluate((el) => getComputedStyle(el).transform)).toBe(
      "none",
    );
    await page.screenshot({
      path: `.test-data/screenshots/skin-browser-menu-${label === "Порядок скинов" ? "sort" : "source"}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(browser).toBeVisible();
  }
});

test("skin browser searches the catalog, pages, sorts, opens players and MineSkin links", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Браузер скинов", exact: true })
    .click();
  const browser = page.getByRole("dialog", {
    name: "Браузер скинов",
    exact: true,
  });
  await browser.getByRole("button", { name: "Показать ещё скины" }).click();
  await expect(
    browser.getByRole("button", { name: "Посмотреть скин Explorer" }),
  ).toBeVisible();
  await expect(
    browser.getByRole("button", { name: "Показать ещё скины" }),
  ).toHaveCount(0);
  const search = browser.getByRole("textbox", { name: "Поиск скинов" });
  await search.fill("knight");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).requests
            .filter((r: any) => r.action === "browseSkins")
            .at(-1)?.payload.query,
      ),
    )
    .toBe("knight");
  await browser.getByRole("combobox", { name: "Порядок скинов" }).click();
  await page
    .getByRole("option", { name: "Популярные скины", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).requests
            .filter((r: any) => r.action === "browseSkins")
            .at(-1)?.payload.mode,
      ),
    )
    .toBe("popular");
  await search.fill("");
  await browser.getByRole("combobox", { name: "Где искать скины" }).click();
  await page
    .getByRole("option", { name: "По нику игрока", exact: true })
    .click();
  await search.fill("Notch");
  await expect(
    browser.getByRole("heading", { name: "Notch", exact: true }),
  ).toBeVisible();
  const request = await page.evaluate(() =>
    (window as any).requests
      .filter((r: any) => r.action === "skinBrowserSkin")
      .at(-1),
  );
  expect(request.payload).toEqual({ query: "Notch", source: "player" });
  await search.fill("");
  await browser.getByRole("combobox", { name: "Где искать скины" }).click();
  await page
    .getByRole("option", { name: "По ID или ссылке", exact: true })
    .click();
  await search.fill("https://mineskin.org/898c498b");
  await expect(
    browser.getByRole("heading", { name: "Knight", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).requests
          .filter((r: any) => r.action === "skinBrowserSkin")
          .at(-1)?.payload,
    ),
  ).toEqual({ query: "https://mineskin.org/898c498b", source: "mineskin" });
});

test("skin browser handles empty results, rate limits and stale search responses", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Браузер скинов", exact: true })
    .click();
  const browser = page.getByRole("dialog", {
    name: "Браузер скинов",
    exact: true,
  });
  const search = browser.getByRole("textbox", { name: "Поиск скинов" });
  await search.fill("error");
  await expect(
    browser.getByText("Слишком много запросов. Повторите через 60 с."),
  ).toBeVisible();
  await search.fill("empty");
  await expect(
    browser.getByText("Скины не найдены. Попробуйте другое название или тег."),
  ).toBeVisible();
  await search.fill("slow");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).resolveSkinSearch))
    .toBe("function");
  await search.fill("knight");
  await expect(
    browser.getByRole("button", { name: "Посмотреть скин Knight" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).resolveSkinSearch());
  await expect(
    browser.getByRole("button", { name: "Посмотреть скин Stale" }),
  ).toHaveCount(0);
  await expect(
    browser.getByRole("button", { name: "Посмотреть скин Knight" }),
  ).toBeVisible();
});
for (const kind of ["offline", "microsoft"] as const) {
  test(`${kind} wardrobe keeps preview and Apply visible while the library scrolls`, async ({
    page,
  }) => {
    await fixture(page, kind, kind === "offline" ? "light" : "dark");
    const library = page.getByRole("region", { name: "Библиотека скинов" });
    const character = page.locator(".wardrobe-character");
    const apply = page.getByRole("button", { name: "Применить", exact: true });
    for (const viewport of [
      { width: 1280, height: 820 },
      { width: 1110, height: 779 },
      { width: 960, height: 680 },
    ]) {
      await page.setViewportSize(viewport);
      await library.evaluate((element) => element.scrollTo(0, 0));
      await expect(apply).toBeInViewport({ ratio: 1 });
      await expect(character).toBeInViewport({ ratio: 1 });
      const before = await character.boundingBox();
      await library.hover();
      await page.mouse.wheel(0, 4000);
      await expect
        .poll(() => library.evaluate((e) => e.scrollTop))
        .toBeGreaterThan(0);
      await page
        .getByRole("button", { name: "Выбрать скин Zuri", exact: true })
        .click();
      await expect(apply).toBeInViewport({ ratio: 1 });
      expect(await character.boundingBox()).toEqual(before);
      expect(
        await page.locator(".content-scroll").evaluate((e) => e.scrollTop),
      ).toBe(0);
      expect(
        await character.evaluate((e) => e.scrollHeight - e.clientHeight),
      ).toBeLessThanOrEqual(1);
      expect(
        await page
          .locator(".content-scroll")
          .evaluate((e) => e.scrollWidth - e.clientWidth),
      ).toBeLessThanOrEqual(1);
      await apply.click();
      expect(
        await page.evaluate(
          () =>
            (window as any).requests
              .filter((r: any) => r.action === "applyLibrarySkin")
              .at(-1).payload.skinId,
        ),
      ).toBe("default:zuri");
      // Keyboard users can scroll the library without moving the character, too.
      await library.focus();
      await page.keyboard.press("Home");
      await expect.poll(() => library.evaluate((e) => e.scrollTop)).toBe(0);
      await expect(apply).toBeInViewport({ ratio: 1 });
      await page.screenshot({
        path: `.test-data/screenshots/skins-fixed-${kind}-${viewport.width}.png`,
        animations: "disabled",
      });
    }
  });
}

test("one click imports Modrinth skins, preserves selection and survives restart without duplicates", async ({
  page,
}) => {
  await fixture(page);
  const importButton = page.getByRole("button", {
    name: "Импорт из Modrinth",
    exact: false,
  });
  await importButton.click();
  await expect(
    page.getByRole("status").filter({ hasText: "Импортировано: 1" }),
  ).toBeVisible();
  const imported = page.getByRole("button", {
    name: "Выбрать скин Modrinth 3",
    exact: true,
  });
  await expect(imported).toBeVisible();
  await expect(imported).toHaveText("");
  await expect(
    page.getByRole("button", {
      name: "Выбрать скин Путешественник",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await importButton.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Импортировано: 0 · Уже в библиотеке: 1" }),
  ).toBeVisible();
  await expect(imported).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      (window as any).requests.filter(
        (r: any) => r.action === "applyLibrarySkin",
      ),
    ),
  ).toEqual([]);
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: ".test-data/screenshots/skins-modrinth-dark.png",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(imported).toBeVisible();
});

test("missing automatic library offers a custom Modrinth folder", async ({
  page,
}) => {
  await fixture(page, "offline", "light", "empty");
  await page.getByRole("button", { name: "Импорт из Modrinth" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Сохранённые скины Modrinth не найдены." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Выбрать папку Modrinth" }).click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Modrinth 3", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).requests
          .filter((r: any) => r.action === "importModrinthSkins")
          .at(-1).payload.directories,
    ),
  ).toEqual(["D:/Custom Modrinth"]);
  await page.screenshot({
    path: ".test-data/screenshots/skins-modrinth-light.png",
  });
});

test("partial Modrinth import explains skipped textures and unreadable sources", async ({
  page,
}) => {
  await fixture(page, "offline", "light", "partial");
  await page.getByRole("button", { name: "Импорт из Modrinth" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Пропущено: 2" }),
  ).toBeVisible();
  await expect(
    page.getByText("Пропущены повреждённые текстуры и неизвестные модели рук."),
  ).toBeVisible();
  await expect(
    page.getByText(/Не удалось прочитать скины Modrinth: D:\/Broken/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Modrinth 3", exact: true }),
  ).toBeVisible();
});

test("failed Modrinth import preserves saved skins and allows retry", async ({
  page,
}) => {
  await fixture(page, "offline", "light", "error");
  const button = page.getByRole("button", { name: "Импорт из Modrinth" });
  await button.click();
  await expect(
    page
      .locator(".wardrobe-library")
      .getByText(
        "Не удалось прочитать библиотеку скинов; исходный файл сохранён",
      ),
  ).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(
    page.getByRole("button", {
      name: "Выбрать скин Путешественник",
      exact: true,
    }),
  ).toBeVisible();
});
test("dedicated wardrobe has all defaults, still manual view, animations and both themes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  for (const name of [
    "Steve",
    "Alex",
    "Ari",
    "Efe",
    "Kai",
    "Makena",
    "Noor",
    "Sunny",
    "Zuri",
  ])
    await expect(
      page.getByRole("button", { name: `Выбрать скин ${name}`, exact: true }),
    ).toBeVisible();
  await expect(
    page.locator(".wardrobe-tile img[data-thumbnail-ready]"),
  ).toHaveCount(11);
  await expect(page.locator(".wardrobe-tile-caption")).toHaveCount(0);
  expect(await page.locator(".wardrobe-tile").allTextContents()).toEqual(
    Array(11).fill(""),
  );
  const framing = await page
    .locator(".wardrobe-tile img")
    .first()
    .evaluate((element) => {
      const image = element as HTMLImageElement;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let left = canvas.width,
        right = 0,
        top = canvas.height,
        bottom = 0;
      for (let y = 0; y < canvas.height; y++)
        for (let x = 0; x < canvas.width; x++)
          if (data[(y * canvas.width + x) * 4 + 3] > 100) {
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
      return {
        width: (right - left) / canvas.width,
        height: (bottom - top) / canvas.height,
        top: top / canvas.height,
        bottom: bottom / canvas.height,
      };
    });
  expect(framing.width).toBeGreaterThan(0.6);
  expect(framing.height).toBeGreaterThan(0.85);
  expect(framing.top).toBeGreaterThan(0.025);
  expect(framing.top).toBeLessThan(0.15);
  expect(framing.bottom).toBeGreaterThan(0.97);
  await expect(page.locator(".skin-orbit")).toHaveCount(0);
  const canvas = page.locator(".wardrobe-character canvas");
  await expect(canvas).toHaveAttribute("data-auto-rotate", "false");
  await page.getByRole("combobox", { name: "Анимация персонажа" }).click();
  await page.getByRole("option", { name: "Без анимации", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-motion", "still");
  // Let the select's closing transition and the resulting sticky-stage resize settle.
  await page.waitForTimeout(500);
  const before = await canvas.screenshot();
  await page.waitForTimeout(750);
  expect((await canvas.screenshot()).equals(before)).toBe(true);
  const bounds = await canvas.boundingBox();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.5,
    bounds!.y + bounds!.height * 0.4,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds!.x + bounds!.width * 0.8,
    bounds!.y + bounds!.height * 0.4,
    { steps: 12 },
  );
  await page.mouse.up();
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await page.getByRole("button", { name: "Сбросить ракурс" }).click();
  await page.getByRole("combobox", { name: "Анимация персонажа" }).click();
  await page.getByRole("option", { name: "Помахать", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-motion", "wave");
  await page.locator(".content-scroll").evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: ".test-data/screenshots/skins-light.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: ".test-data/screenshots/skins-dark.png",
    animations: "disabled",
  });
  await page.setViewportSize({ width: 960, height: 680 });
  expect(
    await page
      .locator(".content-scroll")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "Импорт из Modrinth", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: ".test-data/screenshots/skins-small.png",
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});
test("multiple saved PNG skins, model and cape persist, apply switches and deletion is local", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Добавить скин", exact: true })
    .click();
  let dialog = page.getByRole("dialog", { name: "Настройка скина" });
  await dialog
    .getByRole("textbox", { name: "Название образа" })
    .fill("Мой образ");
  await dialog
    .getByRole("button", { name: "Тонкие руки", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Добавить PNG-плащ" }).click();
  await expect(
    dialog.getByRole("button", { name: "Плащ Мой плащ", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: ".test-data/screenshots/skin-editor-light.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Сохранить скин", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await expect(page.getByText("Образ применён", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Добавить скин", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Настройка скина" });
  await dialog
    .getByRole("button", { name: "Сохранить скин", exact: true })
    .click();
  await page.reload();
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Мой образ", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Выбрать скин Мой скин 2", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Выбрать скин Исследователь", exact: true })
    .click();
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  const calls = await page.evaluate(() =>
    (window as any).requests.filter(
      (r: any) => r.action === "applyLibrarySkin",
    ),
  );
  expect(calls.at(-1).payload.skinId).toBe("saved-b");
  await page
    .getByRole("button", { name: "Выбрать скин Мой скин 2", exact: true })
    .click();
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить из библиотеки", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Выбрать скин Мой скин 2", exact: true }),
  ).toHaveCount(0);
});
test("owned Microsoft capes are selectable, local capes stay previews, small editor fits", async ({
  page,
}) => {
  await fixture(page, "microsoft", "dark");
  await page.setViewportSize({ width: 960, height: 680 });
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Настройка скина" });
  await dialog
    .getByRole("button", { name: "Плащ Minecraft cape", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Сохранить скин", exact: true }),
  ).toBeInViewport();
  expect(await dialog.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(
    false,
  );
  await page.screenshot({
    path: ".test-data/screenshots/skin-editor-dark.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Сохранить скин", exact: true })
    .click();
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as any).requests
          .filter((r: any) => r.action === "applyLibrarySkin")
          .at(-1).payload.capeId,
    ),
  ).toBe("owned:00000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Добавить PNG-плащ" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Сохранить скин", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Применить", exact: true }),
  ).toBeDisabled();
});

test("cold wardrobe waits for appearance; warm navigation remembers the preview", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).holdAppearance = true;
  });
  await fixture(page, "offline", "light", "normal", false);
  await expect(page.locator(".wardrobe-layout")).toBeHidden();
  await expect(page.locator(".wardrobe-character canvas")).toHaveCount(0);
  await expect(
    page.getByText("Получаем образ Minecraft…").first(),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseAppearance))
    .toBe("function");
  await page.evaluate(() => {
    (window as any).holdAppearance = false;
    (window as any).releaseAppearance();
  });
  await expect(page.locator(".wardrobe-layout")).toBeVisible();
  const zuri = page.getByRole("button", {
    name: "Выбрать скин Zuri",
    exact: true,
  });
  await zuri.click();
  await expect(zuri).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".wardrobe-character canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page.evaluate(() => {
    (window as any).holdAppearance = true;
  });
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(page.locator(".wardrobe-layout")).toBeVisible();
  await expect(zuri).toHaveAttribute("aria-pressed", "true");
});

test("Steve is a valid loaded appearance and first-load failures can be retried", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).appearanceFailure = true;
    (window as any).useSteve = true;
    (window as any).noSelection = true;
  });
  await fixture(page, "offline", "light", "normal", false);
  await expect(page.getByRole("alert")).toContainText("Appearance unavailable");
  await expect(page.locator(".wardrobe-layout")).toBeHidden();
  await page.evaluate(() => {
    (window as any).appearanceFailure = false;
  });
  await page
    .getByRole("button", { name: "Попробовать снова", exact: true })
    .click();
  await expect(page.locator(".wardrobe-layout")).toBeVisible();
  await expect(page.locator(".wardrobe-character canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
});

test("cached native texture is visible before the full cape response", async ({
  page,
}) => {
  await fixture(page, "microsoft", "dark", "normal", false, true);
  await expect(page.locator(".wardrobe-layout")).toBeHidden();
  await expect(page.locator(".wardrobe-character canvas")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).showPreview))
    .toBe("function");
  await page.evaluate(() => (window as any).showPreview());
  await expect(page.locator(".wardrobe-layout")).toBeVisible();
  await expect(page.locator(".wardrobe-character canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(page.locator(".wardrobe-layout")).toBeVisible();
  await page.evaluate(() => (window as any).showAppearance());
});

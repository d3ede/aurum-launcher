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
) {
  await page.addInitScript(
    ({ steve, ari, zuri, kind, theme, importMode }) => {
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
          if (action === "accountAppearance")
            return {
              texture: texture(ari),
              model: "alex",
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
    { steve, ari, zuri, kind, theme, importMode },
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Скины и плащи", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Скины и плащи", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".wardrobe-character canvas")).toHaveAttribute(
    "data-ready",
    "true",
  );
}
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

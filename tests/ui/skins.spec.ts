import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const steve = Array.from(readFileSync("src/assets/skins/wide-steve.png"));
const ari = Array.from(readFileSync("src/assets/skins/slim-ari.png"));
const zuri = Array.from(readFileSync("src/assets/skins/slim-zuri.png"));
async function fixture(
  page: Page,
  kind: "offline" | "microsoft" = "offline",
  theme = "light",
) {
  await page.addInitScript(
    ({ steve, ari, zuri, kind, theme }) => {
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
    { steve, ari, zuri, kind, theme },
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

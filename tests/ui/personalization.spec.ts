import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, language = "ru") {
  await page.addInitScript(
    ({ language }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const state = {
        profiles: Array.from({ length: 7 }, (_, i) => ({
          id: `profile-${i}`,
          name: `World ${i}`,
          minecraft: "1.21.11",
          loader: "fabric",
          loaderVersion: "0.18.4",
          installedVersion: "1.21.11",
          ramMb: null,
          jvmArgs: "",
          lastPlayed: 100 - i,
          cover: 1,
          content: [],
        })),
        accounts: [
          {
            id: "account",
            uuid: "account",
            name: "Player",
            kind: "offline",
            skinModel: "steve",
            hasSkin: false,
          },
        ],
        selectedAccount: "account",
        running: [] as string[],
        dataDir: "D:/Aurum-test",
        serverManager: true,
        curseforgeConfigured: true,
        settings: JSON.parse(
          localStorage.getItem("test:settings") || "null",
        ) || {
          language,
          theme: "light",
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
      };
      w.personalizationRequests = [];
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
          w.personalizationRequests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "saveSettings") {
            if (w.failSettings) throw new Error("Settings write failed");
            state.settings = payload.settings;
            localStorage.setItem(
              "test:settings",
              JSON.stringify(payload.settings),
            );
            return null;
          }
          if (action === "recentServers")
            return Array.from({ length: 8 }, (_, i) => ({
              id: `server-${i}`,
              profileId: "profile-2",
              name: `Server ${i}`,
              address: `play${i}.example.org:25565`,
              lastPlayed: Math.floor(Date.now() / 1000) - i * 60,
              icon: null,
            }));
          if (action === "serverStatus")
            return {
              online: true,
              players: 5,
              maxPlayers: 20,
              latencyMs: 30,
              checkedAt: Math.floor(Date.now() / 1000),
              icon: null,
            };
          if (action === "takeServerShortcut") return null;
          if (action === "search")
            return {
              projects: [
                {
                  id: "project",
                  source: payload.query.source,
                  title: payload.query.source + " project",
                  description: "Example project",
                  downloads: 1234,
                  kind: payload.query.kind,
                  author: "Author",
                  icon: null,
                },
              ],
              total: 1,
            };
          if (action === "launch") {
            state.running = [payload.id];
            return null;
          }
          if (action === "stop") {
            state.running = [];
            return null;
          }
          if (action === "uninstall") return null;
          throw new Error(`Unexpected action: ${action}`);
        },
      };
    },
    { language },
  );
  await page.goto("/");
  await expect(page.locator(".quick-launch")).toContainText("World 0");
}
async function select(page: Page, name: string, option: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function customize(page: Page) {
  await page
    .getByRole("button", { name: "Настроить главную", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Главная страница", exact: true }),
  ).toBeVisible();
}
async function saveHome(page: Page) {
  await page
    .getByRole("button", { name: "Сохранить и открыть главную" })
    .click();
}
async function appearance(page: Page) {
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
}

test("home customization saves counts, duplicate policy, source and block order", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator(".recent-server-row")).toHaveCount(5);
  await customize(page);
  await page.screenshot({
    path: ".test-data/screenshots/home-customization.png",
  });
  await page
    .getByRole("spinbutton", { name: "Количество недавних сборок" })
    .fill("5");
  await page.getByRole("spinbutton", { name: "Количество серверов" }).fill("2");
  await page
    .getByRole("checkbox", {
      name: "Повторять сборку из быстрого запуска в недавних",
    })
    .check();
  await select(
    page,
    "Что показывать в рекомендациях",
    "Популярное в CurseForge",
  );
  await page
    .getByRole("button", { name: "Переместить Рекомендации вверх" })
    .click();
  await page
    .getByRole("button", { name: "Переместить Рекомендации вверх" })
    .click();
  await saveHome(page);
  await expect(page.locator(".recent-server-row")).toHaveCount(2);
  await expect(page.locator(".home-primary .instance-card")).toHaveCount(5);
  await expect(page.locator(".home-primary .profile-grid")).toContainText(
    "World 0",
  );
  await expect(page.locator(".recommendations")).toContainText(
    "curseforge project",
  );
  expect(
    await page
      .locator("[data-home-block]")
      .evaluateAll((rows) =>
        rows.map((el) => el.getAttribute("data-home-block")),
      ),
  ).toEqual(["launch", "discover", "servers", "profiles"]);
  await page.reload();
  await expect(page.locator(".recent-server-row")).toHaveCount(2);
  await expect(page.locator(".home-primary .instance-card")).toHaveCount(5);
});

test("fixed instance and last server launch the correct target and hidden blocks stay hidden", async ({
  page,
}) => {
  await fixture(page);
  await customize(page);
  await select(page, "Что запускать", "Определённая сборка");
  await select(page, "Сборка для быстрого запуска", "World 4");
  await saveHome(page);
  await expect(page.locator(".quick-launch")).toContainText("World 4");
  await expect(page.locator(".profile-grid")).not.toContainText("World 4");
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Играть", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).personalizationRequests
            .filter((r: any) => r.action === "launch")
            .at(-1)?.payload,
      ),
    )
    .toEqual({ id: "profile-4" });
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Остановить" })
    .click();
  await customize(page);
  await select(page, "Что запускать", "Последний сервер");
  await page.getByRole("spinbutton", { name: "Количество серверов" }).fill("0");
  await page
    .getByRole("spinbutton", { name: "Количество недавних сборок" })
    .fill("0");
  await select(page, "Что показывать в рекомендациях", "Скрыть блок");
  await page
    .getByRole("checkbox", { name: "Показывать аккаунт и новости сбоку" })
    .uncheck();
  await saveHome(page);
  await expect(page.locator(".quick-launch")).toContainText("Server 0");
  await expect(
    page.locator(
      ".recent-servers, .profile-grid, .recommendations, .home-sidebar",
    ),
  ).toHaveCount(0);
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Играть", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).personalizationRequests
            .filter((r: any) => r.action === "launch")
            .at(-1)?.payload,
      ),
    )
    .toEqual({ id: "profile-2", server: "play0.example.org:25565" });
});

test("dragging reorders blocks and uploaded backgrounds survive restart and reset", async ({
  page,
}) => {
  await fixture(page);
  await customize(page);
  const rows = page.locator(".home-block-row");
  await rows
    .filter({ hasText: "Рекомендации" })
    .locator(".block-drag-handle")
    .dragTo(rows.filter({ hasText: "Быстрый запуск" }));
  await expect(rows.first()).toContainText("Рекомендации");
  await page.getByLabel("Выбрать изображение", { exact: true }).setInputFiles({
    name: "background.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZcAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await select(page, "Где использовать фон", "На всей главной");
  await saveHome(page);
  await expect(page.locator(".home-layout")).toHaveClass(
    /custom-home-background/,
  );
  await page.reload();
  await expect(page.locator(".home-layout")).toHaveCSS(
    "background-image",
    /data:image\/png;base64/,
  );
  await customize(page);
  await page.getByRole("button", { name: "Сбросить главную" }).click();
  await saveHome(page);
  await expect(page.locator(".home-layout")).not.toHaveClass(
    /custom-home-background/,
  );
  expect(
    await page
      .locator("[data-home-block]")
      .first()
      .getAttribute("data-home-block"),
  ).toBe("launch");
});

test("new palettes, named custom themes and fonts persist with live preview", async ({
  page,
}) => {
  await fixture(page);
  await appearance(page);
  for (const [name, id] of [
    ["Гранатовый шёлк", "garnet"],
    ["Северная глубина", "navy"],
    ["Весенний мох", "spring"],
    ["Персиковый рассвет", "peach"],
    ["Лавандовая ночь", "lavender"],
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-palette", id);
    const card = page.getByRole("button", { name, exact: true });
    await expect(card.locator(".theme-card-name")).toHaveText(name);
    await expect(card.locator("small")).toHaveCount(0);
    await expect(
      card.locator(id === "peach" ? ".lucide-sun" : ".lucide-moon"),
    ).toHaveCount(1);
    await page.screenshot({
      path: `.test-data/screenshots/appearance-${id}.png`,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "Создать свою тему" }).click();
  await expect(
    page.getByRole("heading", { name: "Создание своей темы", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".appearance-theme-grid")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Название установленного шрифта" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: ".test-data/screenshots/theme-editor-page.png",
    animations: "disabled",
  });
  await page
    .getByRole("textbox", { name: "Название темы" })
    .fill("Океан и звёзды");
  await page.getByLabel("Акцент", { exact: true }).fill("#aabbcc");
  await page
    .getByRole("button", { name: "Сохранить тему", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Океан и звёзды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("textbox", { name: "Название установленного шрифта" })
    .fill("Georgia");
  await page.getByRole("button", { name: "Сохранить оформление" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-palette",
    /^custom-/,
  );
  expect(
    await page
      .locator("html")
      .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--gold")),
  ).toBe("#aabbcc");
  await expect(page.locator("body")).toHaveCSS("font-family", /Georgia/);
  await appearance(page);
  await expect(
    page.getByRole("button", { name: "Океан и звёзды", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Изменить тему Океан и звёзды" })
    .click();
  await page.getByRole("textbox", { name: "Название темы" }).fill("Новое имя");
  await page
    .getByRole("button", { name: "Сохранить тему", exact: true })
    .click();
  await page.getByRole("button", { name: "Удалить тему Новое имя" }).click();
  await page.getByRole("button", { name: "Сохранить оформление" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "light");
});

test("uploaded fonts persist, invalid files are rejected and failed saves retain previous home", async ({
  page,
}) => {
  await fixture(page);
  await appearance(page);
  await page
    .getByLabel("Загрузить шрифт", { exact: true })
    .setInputFiles(
      "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
    );
  await expect(
    page.getByRole("textbox", { name: "Название установленного шрифта" }),
  ).toHaveValue("inter-latin-wght-normal.woff2");
  await page.getByRole("button", { name: "Сохранить оформление" }).click();
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => document.fonts.check('15px "Aurum User Font"')),
    )
    .toBe(true);
  await appearance(page);
  await page.getByLabel("Загрузить шрифт", { exact: true }).setInputFiles({
    name: "broken.ttf",
    mimeType: "font/ttf",
    buffer: Buffer.from("not a font"),
  });
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось загрузить шрифт",
  );
  await page
    .getByRole("button", { name: "Назад к настройкам", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Главная страница", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "Количество серверов" }).fill("0");
  await page.evaluate(() => {
    (window as any).failSettings = true;
  });
  await saveHome(page);
  await expect(page.getByRole("alert")).toContainText("Settings write failed");
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect(page.locator(".recent-server-row")).toHaveCount(5);
});

test("running-game snapshots preserve the appearance preview", async ({
  page,
}) => {
  await fixture(page);
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Играть", exact: true })
    .click();
  await expect(page.locator(".quick-launch")).toContainText("Запущена");
  await appearance(page);
  await page
    .getByRole("button", { name: "Северная глубина", exact: true })
    .click();
  const snapshots = () =>
    page.evaluate(
      () =>
        (window as any).personalizationRequests.filter(
          (r: any) => r.action === "snapshot",
        ).length,
    );
  const count = await snapshots();
  await expect.poll(snapshots).toBeGreaterThan(count);
  await expect(page.locator("html")).toHaveAttribute("data-palette", "navy");
  await page
    .getByRole("button", { name: "Назад к настройкам", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "light");
});

test("appearance fits minimum size, translates and discards unsaved preview; uninstall is separate", async ({
  page,
}) => {
  await fixture(page, "en");
  await page.setViewportSize({ width: 960, height: 680 });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Garnet Silk", exact: true }).click();
  await page.getByRole("button", { name: "Create your own theme" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your own theme", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .locator(".content-scroll")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(false);
  await page
    .getByRole("button", { name: "Back to appearance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "light");
  const uninstall = page.getByRole("button", {
    name: "Uninstall Aurum",
    exact: true,
  });
  await expect(uninstall).toHaveClass(/uninstall-button/);
  expect(await uninstall.evaluate((el) => el.closest("form"))).toBe(null);
  expect(
    await page.locator(".settings-page > .settings-uninstall").count(),
  ).toBe(1);
  const saveBounds = await page
    .getByRole("button", { name: "Save settings", exact: true })
    .boundingBox();
  const uninstallBounds = await uninstall.boundingBox();
  expect(
    Math.abs(
      saveBounds!.x +
        saveBounds!.width -
        uninstallBounds!.x -
        uninstallBounds!.width,
    ),
  ).toBeLessThanOrEqual(1);
  await page.locator(".settings-uninstall").scrollIntoViewIfNeeded();
  await page.screenshot({
    path: ".test-data/screenshots/settings-uninstall.png",
  });
});

test("settings destinations occupy separate rows and the page never scrolls outside the launcher", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByRole("tablist")).toHaveCount(0);
  await expect(
    page.getByText(
      "Игровые файлы, Java и сборки занимают дополнительное место",
      { exact: false },
    ),
  ).toHaveCount(0);
  const home = await page
    .getByRole("button", { name: "Главная страница", exact: true })
    .boundingBox();
  const appearanceRow = await page
    .getByRole("button", { name: "Внешний вид", exact: true })
    .boundingBox();
  expect(appearanceRow!.y - home!.y - home!.height).toBeGreaterThanOrEqual(14);
  expect(appearanceRow!.width).toBe(home!.width);
  await page
    .getByRole("button", { name: "Главная страница", exact: true })
    .click();
  await page.locator(".content-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.mouse.move(700, 600);
  await page.mouse.wheel(0, 4000);
  await page.evaluate(() => window.scrollTo(0, 4000));
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const shell = await page.locator(".app-shell").boundingBox();
  expect(shell!.y).toBe(0);
  expect(shell!.height).toBe(820);
  await expect(
    page.getByRole("button", { name: "Сохранить и открыть главную" }),
  ).toBeInViewport();
  await page
    .getByRole("button", { name: "Назад к настройкам", exact: true })
    .click();
  await page.getByRole("button", { name: "Внешний вид", exact: true }).click();
  await page.locator(".content-scroll").evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.getByRole("button", { name: "Создать свою тему" }).click();
  await expect(
    page.getByRole("heading", { name: "Создание своей темы", exact: true }),
  ).toBeInViewport();
  expect(
    await page.locator(".content-scroll").evaluate((el) => el.scrollTop),
  ).toBe(0);
  await page
    .getByRole("textbox", { name: "HEX: Акцент", exact: true })
    .fill("#112233");
  await expect(page.getByLabel("Акцент", { exact: true })).toHaveValue(
    "#112233",
  );
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Внешний вид", exact: true }),
  ).toBeInViewport();
});

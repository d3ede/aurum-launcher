import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, theme = "light", language = "ru") {
  await page.addInitScript(
    ({ theme, language }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const profile = {
        id: "95698e6a-9ac5-4418-b773-4346121b0220",
        name: "Radiance",
        minecraft: "1.21.11",
        loader: "fabric",
        loaderVersion: "0.18.4",
        installedVersion: "1.21.11",
        ramMb: 4096,
        jvmArgs: "",
        lastPlayed: 1791930000,
        cover: 1,
        icon: null,
        iconStyle: null,
        content: [],
      };
      const state = {
        profiles: [profile],
        accounts: [
          {
            id: "account-1",
            uuid: "account-1",
            name: "CozyPlayer",
            kind: "offline",
            skinModel: "steve",
            hasSkin: false,
          },
        ],
        selectedAccount: "account-1",
        running: [] as string[],
        dataDir: "D:/Aurum-test",
        curseforgeConfigured: false,
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
      w.homeRequests = [];
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
          w.homeRequests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "saveSettings") {
            state.settings = payload.settings;
            return null;
          }
          if (action === "search")
            return {
              total: 4,
              projects: [
                {
                  id: "fabric-api",
                  source: "modrinth",
                  title: "Fabric API",
                  description: "Library for Fabric mods.",
                  author: "FabricMC",
                  icon: null,
                  downloads: 277800000,
                  kind: "mod",
                },
                {
                  id: "sodium",
                  source: "modrinth",
                  title: "Sodium",
                  description: "Rendering performance improvements.",
                  author: "CaffeineMC",
                  icon: null,
                  downloads: 244400000,
                  kind: "mod",
                },
                {
                  id: "lithium",
                  source: "modrinth",
                  title: "Lithium",
                  description: "Game logic optimizations.",
                  author: "CaffeineMC",
                  icon: null,
                  downloads: 98000000,
                  kind: "mod",
                },
                {
                  id: "modmenu",
                  source: "modrinth",
                  title: "Mod Menu",
                  description: "Installed mod information.",
                  author: "TerraformersMC",
                  icon: null,
                  downloads: 87000000,
                  kind: "mod",
                },
              ],
            };
          if (action === "launch") {
            state.running = [payload.id];
            return null;
          }
          if (action === "stop") {
            state.running = [];
            return null;
          }
          if (action === "content") return [];
          throw new Error(`Unexpected home action: ${action}`);
        },
      };
    },
    { theme, language },
  );
  await page.goto("/");
  await expect(page.locator(".recommended-project")).toHaveCount(4);
}

test("home has account and factual release panels, working actions and both themes", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator(".home-account-card")).toContainText("CozyPlayer");
  await expect(page.locator(".home-news-card")).toContainText("Aurum 0.4.2");
  await expect(page.locator(".home-news-card")).toContainText(
    "Головы из скинов",
  );
  await expect(page.locator(".home-news-card")).toContainText("Окно Microsoft");
  await expect(page.locator(".home-news-card")).toContainText(
    "Сохранение входа Microsoft",
  );
  await expect(page.locator(".home-sidebar img")).toHaveCount(0);
  await expect(page.locator(".sidebar-pattern")).toHaveCount(1);
  await page.screenshot({
    path: ".test-data/screenshots/home-light.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Переключить тему", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: ".test-data/screenshots/home-dark.png",
    animations: "disabled",
  });
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Играть", exact: true })
    .click();
  await expect(page.locator(".quick-launch .home-profile-status")).toHaveText(
    "Запущена",
  );
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Остановить", exact: true })
    .click();
  await expect(page.locator(".quick-launch .home-profile-status")).toHaveText(
    "Установлена",
  );
  await page
    .getByRole("button", { name: "Все изменения", exact: true })
    .click();
  const notes = page.getByRole("dialog", { name: "Изменения Aurum 0.4.2" });
  await expect(notes).toContainText(
    "исправлена ошибка сохранения сессии Microsoft",
  );
  await expect(notes).toContainText(
    "Перед установкой проверяется подпись обновления.",
  );
  await expect(notes).toContainText("В этой сборке: компактный список модов");
  await expect(notes).toContainText(
    "ярлыки Aurum на рабочем столе и в меню «Пуск» автоматически перенаправляются",
  );
  await page.keyboard.press("Escape");
  await expect(notes).toHaveCount(0);
  await page
    .getByRole("button", { name: "Все изменения", exact: true })
    .click();
  await notes
    .getByRole("button", { name: "Настройки обновлений", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Обновления лаунчера", exact: true }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page
    .getByRole("button", { name: "Настройки сборки Radiance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Radiance", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Название", exact: true }),
  ).toHaveValue("Radiance");
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page
    .getByRole("button", { name: "Управление аккаунтом", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Аккаунты и скины", exact: true }),
  ).toBeVisible();
});

test("home adapts to minimum window size and translates the new panels", async ({
  page,
}) => {
  await fixture(page, "light", "en");
  await expect(
    page.getByRole("heading", { name: "My account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "What's new", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".home-news-card")).toContainText("Aurum 0.4.2");
  await expect(page.locator(".home-news-card")).toContainText("Skin heads");
  await expect(page.locator(".home-news-card")).toContainText(
    "Microsoft window",
  );
  await expect(page.locator(".home-news-card")).toContainText(
    "Saving Microsoft sign-in",
  );
  await page.setViewportSize({ width: 960, height: 680 });
  expect(
    await page
      .locator(".content-scroll")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  expect(
    await page
      .locator(".home-layout")
      .evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(false);
  await page.locator(".home-sidebar").scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("heading", { name: "What's new", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: ".test-data/screenshots/home-small.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "All changes", exact: true }).click();
  const notes = page.getByRole("dialog", { name: "Aurum 0.4.2 changes" });
  await expect(notes).toContainText("fixes Microsoft session saving failures");
  await expect(notes).toContainText(
    "The update signature is verified before installation.",
  );
  await expect(notes).toContainText(
    "Updates automatically redirect Aurum Desktop and Start menu shortcuts",
  );
  await expect(
    notes.getByRole("button", { name: "Update settings", exact: true }),
  ).toBeInViewport();
});

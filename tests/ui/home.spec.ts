import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  theme = "light",
  language = "ru",
  profileCount = 1,
) {
  await page.addInitScript(
    ({ theme, language, profileCount }) => {
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
        profiles: Array.from({ length: profileCount }, (_, index) => ({
          ...profile,
          id: index === 0 ? profile.id : `other-${index}`,
          name: index === 0 ? profile.name : `Other ${index}`,
          lastPlayed: profile.lastPlayed - index,
        })),
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
    { theme, language, profileCount },
  );
  await page.goto("/");
  await expect(page.locator(".recommended-project")).toHaveCount(4);
}

test("home has account and factual release panels, working actions and both themes", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator(".home-primary .instance-card")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Недавние сборки" }),
  ).toHaveCount(0);
  await expect(page.locator(".home-account-card")).toContainText("CozyPlayer");
  await expect(page.locator(".home-news-card")).toContainText("Aurum 0.5.0");
  await expect(page.locator(".home-news-version")).toHaveCount(3);
  await expect(page.locator(".home-news-card")).toContainText("Aurum 0.4.5");
  await expect(page.locator(".home-news-card")).not.toContainText(
    "Aurum 0.4.2",
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
  const notes = page.getByRole("dialog", { name: "История версий" });
  await expect(notes.locator(".release-section")).toHaveCount(12);
  await expect(notes.locator(".release-section[open]")).toHaveCount(1);
  await expect(notes.locator(".release-section[open]")).toContainText(
    "Aurum 0.5.0",
  );
  await expect(notes.locator(".release-section[open]")).toContainText(
    "Каталог проектов",
  );
  await expect(notes).not.toContainText("В этой сборке:");
  await notes.locator("summary").filter({ hasText: "Aurum 0.4.3" }).click();
  await expect(
    notes.getByRole("heading", { name: "Локальный хостинг", exact: true }),
  ).toBeVisible();
  await notes.screenshot({ path: ".test-data/screenshots/changelog-dark.png" });
  await page.keyboard.press("Escape");
  await expect(notes).toHaveCount(0);
  await page
    .getByRole("button", { name: "Подробнее о версии 0.4.5", exact: true })
    .click();
  await expect(notes.locator(".release-section[open]")).toHaveCount(1);
  await expect(notes.locator(".release-section[open]")).toContainText(
    "Aurum 0.4.5",
  );
  await page.keyboard.press("Escape");
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
    page.getByRole("heading", { name: "Профили", exact: true }),
  ).toBeVisible();
});

test("quick launch is unique and cards leave space above Play in both themes", async ({
  page,
}) => {
  await fixture(page, "dark", "ru", 5);
  await expect(page.locator(".home-primary .instance-card")).toHaveCount(3);
  await expect(page.locator(".quick-launch")).toContainText("Radiance");
  await expect(page.locator(".home-primary .profile-grid")).not.toContainText(
    "Radiance",
  );
  await expect(page.locator(".home-primary .profile-grid")).toContainText(
    "Other 3",
  );
  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: 820 });
    const search = await page.locator(".header-search").boundingBox();
    const quick = await page.locator(".quick-launch").boundingBox();
    expect(Math.abs(search!.x - quick!.x)).toBeLessThanOrEqual(1);
    for (const theme of ["dark", "light"]) {
      if ((await page.locator("html").getAttribute("data-theme")) !== theme) {
        await page
          .getByRole("button", { name: "Переключить тему", exact: true })
          .click();
      }
      const card = page.locator(".home-primary .instance-card").first();
      const open = card.locator(".instance-card-open");
      await open.hover();
      const area = await open.boundingBox();
      const play = await card
        .locator(".instance-card-footer .button")
        .boundingBox();
      expect(play!.y - (area!.y + area!.height)).toBeGreaterThanOrEqual(12);
      await page.screenshot({
        path: `.test-data/screenshots/home-spacing-${width}-${theme}.png`,
        animations: "disabled",
      });
    }
  }
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
  await expect(page.locator(".home-news-card")).toContainText("Aurum 0.5.0");
  await expect(page.locator(".home-news-version")).toHaveCount(3);
  await expect(page.locator(".home-news-card")).toContainText(
    "Quick launch and imports",
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
  const notes = page.getByRole("dialog", { name: "Version history" });
  await expect(notes.locator(".release-section[open]")).toHaveCount(1);
  await expect(notes.locator(".release-section[open]")).toContainText(
    "CurseForge and combined search",
  );
  await expect(notes).not.toContainText("In this build:");
  await notes.screenshot({
    path: ".test-data/screenshots/changelog-light-small.png",
  });
  await notes.locator("summary").filter({ hasText: "Aurum 0.4.2" }).click();
  await expect(
    notes.getByRole("heading", { name: "Microsoft accounts", exact: true }),
  ).toBeVisible();
  await expect(
    notes.getByRole("button", { name: "Update settings", exact: true }),
  ).toBeInViewport();
});

import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, language = "ru", theme = "dark") {
  await page.addInitScript(
    ({ language, theme }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      w.requests = [];
      w.manualOutcome = "success";
      const state = {
        profiles: [] as any[],
        accounts: [],
        selectedAccount: null,
        running: [],
        dataDir: "D:/fixture",
        curseforgeConfigured: true,
        settings: {
          language,
          theme,
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 820,
          showSnapshots: false,
        },
      };
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
          if (action === "search") return { projects: [], total: 0 };
          if (action === "recentServers") return [];
          if (action === "importPack") {
            state.profiles.push({
              id: "manual-pack",
              name: "Imported pack",
              minecraft: "1.21.1",
              loader: "fabric",
              loaderVersion: "0.16.0",
              installedVersion: null,
              ramMb: null,
              jvmArgs: "",
              lastPlayed: null,
              cover: 0,
              content: [],
              manualDownloads: [
                {
                  name: "Restricted Mod",
                  path: "mods/restricted-1.2.jar",
                  url: "https://www.curseforge.com/minecraft/mc-mods/restricted/files/123",
                  sha1: "hash",
                  reason: "restricted",
                },
                {
                  name: "Failed Download",
                  path: "mods/failed-2.0.jar",
                  url: "https://www.curseforge.com/minecraft/mc-mods/failed/files/456",
                  sha1: "hash",
                  reason: "download",
                },
              ],
            });
            return "manual-pack";
          }
          if (action === "importPackManualFile") {
            if (w.manualOutcome === "cancel") return false;
            if (w.manualOutcome === "wrong")
              throw "Выбран другой файл. Скачайте указанную версию мода";
            state.profiles[0].manualDownloads =
              state.profiles[0].manualDownloads.filter(
                (f: any) => f.path !== payload.path,
              );
            return true;
          }
          if (action === "inspectContent")
            return { content: [], updates: [], warnings: [] };
          if (action === "content") return [];
          return null;
        },
      };
    },
    { language, theme },
  );
  await page.goto("/");
  await page.locator(".sidebar nav button").nth(1).click();
  await page.locator(".library-import-menu > button").click();
  await page.locator(".library-import-options button").nth(1).click();
}

for (const [language, theme] of [
  ["ru", "dark"],
  ["en", "light"],
]) {
  test(`partial import shows named files, exact links and resumes later (${language}, ${theme})`, async ({
    page,
  }) => {
    await fixture(page, language, theme);
    const dialog = page.getByRole("dialog", {
      name:
        language === "ru"
          ? "Нужна ручная установка"
          : "Manual installation needed",
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: language === "ru" ? "Папка сборки" : "Instance folder",
        exact: true,
      }),
    ).toBeVisible();
    await expect(dialog.locator(".pack-missing-file")).toHaveCount(2);
    await page.setViewportSize({ width: 1040, height: 700 });
    const bounds = await dialog.boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await expect(dialog).toContainText("mods/restricted-1.2.jar");
    await expect(dialog).toContainText(
      language === "ru" ? "Автор разрешает" : "The author only allows",
    );
    await dialog
      .locator(".pack-manual-actions")
      .first()
      .locator("button")
      .first()
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).requests.find((r: any) => r.action === "openUrl")
              ?.payload.url,
        ),
      )
      .toBe(
        "https://www.curseforge.com/minecraft/mc-mods/restricted/files/123",
      );
    await dialog
      .getByRole("button", {
        name: language === "ru" ? "Продолжить позже" : "Continue later",
      })
      .click();
    await expect(dialog).toHaveCount(0);
    const open = page.getByRole("button", {
      name: language === "ru" ? "Открыть Imported pack" : "Open Imported pack",
      exact: true,
    });
    await expect(open).toBeVisible();
    await open.click();
    await page.locator(".pack-manual-notice button").click();
    await expect(dialog.locator(".pack-missing-file")).toHaveCount(2);
    await page.screenshot({
      path: `.test-data/pack-manual-${language}-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await dialog
      .locator(".pack-manual-actions")
      .first()
      .locator("button")
      .nth(1)
      .click();
    await expect(dialog.locator(".pack-missing-file")).toHaveCount(1);
    await expect(dialog).toContainText("Failed Download");
    await dialog.locator(".pack-manual-actions button").nth(1).click();
    await expect(dialog).toContainText(
      language === "ru"
        ? "Все недостающие файлы установлены"
        : "All missing files are installed",
    );
    await dialog
      .getByRole("button", {
        name: language === "ru" ? "Закрыть" : "Close",
        exact: true,
      })
      .click();
    await expect(page.locator(".pack-manual-notice")).toHaveCount(0);
  });
}

test("cancelled picker and wrong versions retain the missing list", async ({
  page,
}) => {
  await fixture(page);
  const dialog = page.getByRole("dialog", { name: "Нужна ручная установка" });
  await page.evaluate(() => {
    (window as any).manualOutcome = "cancel";
  });
  await dialog
    .locator(".pack-manual-actions")
    .first()
    .locator("button")
    .nth(1)
    .click();
  await expect(dialog.locator(".pack-missing-file")).toHaveCount(2);
  await expect(
    page.getByText("Файл добавлен в сборку", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).manualOutcome = "wrong";
  });
  await dialog
    .locator(".pack-manual-actions")
    .first()
    .locator("button")
    .nth(1)
    .click();
  await expect(
    page.getByText("Выбран другой файл. Скачайте указанную версию мода", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.locator(".pack-missing-file")).toHaveCount(2);
});

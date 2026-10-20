import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  language = "ru",
  unsupported = false,
  installing = false,
) {
  await page.addInitScript(
    ({ language, unsupported, installing }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      w.packRequests = [];
      const state = {
        profiles: [],
        accounts: [],
        selectedAccount: null,
        running: [],
        dataDir: "D:/fixture",
        curseforgeConfigured: false,
        settings: {
          language,
          theme: "dark",
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 820,
          showSnapshots: false,
        },
      };
      const project = (source: string) => ({
        id: "test-pack",
        source,
        kind: "modpack",
        title: `${source} fixture`,
        description: "A public modpack",
        author: "Publisher",
        icon: null,
        downloads: 2400,
      });
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      const callbacks = new Map<number, Function>();
      let nextCallback = 0;
      let eventHandler: number | undefined;
      w.emitPackProgress = (payload: any) =>
        callbacks.get(eventHandler!)?.({
          event: "auren:event",
          id: 1,
          payload,
        });
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(callback: Function) {
          callbacks.set(++nextCallback, callback);
          return nextCallback;
        },
        async invoke(cmd: string, args: any) {
          if (cmd === "plugin:event|listen") {
            if (args.event === "auren:event") eventHandler = args.handler;
            return 1;
          }
          if (cmd !== "rpc") return cmd.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.packRequests.push({ action, payload });
          if (action === "snapshot") return state;
          if (action === "search")
            return { projects: [project(payload.query.source)], total: 1 };
          if (action === "catalogCategories") return [];
          if (action === "versions")
            return {
              latest: { release: "1.21.1" },
              versions: [{ id: "1.21.1", type: "release" }],
            };
          if (action === "project")
            return {
              project: project(payload.source),
              body: "Public pack description",
              gallery: [],
              url: "https://example.test/modpack",
              versions: [
                {
                  id: "2.0",
                  name: "2.0",
                  gameVersions: ["1.21.1"],
                  loaders: ["neoforge"],
                },
                {
                  id: "1.0",
                  name: "1.0",
                  gameVersions: ["1.20.1"],
                  loaders: ["fabric"],
                },
              ],
            };
          if (action === "packRequirements") {
            if (unsupported)
              throw "This legacy pack requires unsupported custom jar patches";
            if (payload.source !== "atlauncher")
              return { optional: [], manualFiles: [], fileCount: 4 };
            const selected =
              payload.options.optional?.includes("optional") ?? false;
            return {
              optional: [
                {
                  id: "optional",
                  name: "Optional map",
                  description: "An optional minimap",
                  selected,
                },
              ],
              manualFiles: selected
                ? [
                    {
                      id: "mods/manual.jar",
                      name: "manual.jar",
                      url: "https://example.test/manual",
                    },
                  ]
                : [],
              fileCount: selected ? 5 : 4,
            };
          }
          if (action === "choosePackFile") return "D:/fixture/manual.jar";
          if (action === "downloadPack") {
            if (installing) {
              w.packOperationId = payload.operationId;
              queueMicrotask(() =>
                w.emitPackProgress({
                  id: payload.operationId,
                  profileId: null,
                  phase: "pack",
                  packName: `${payload.source} fixture`,
                  message: "Файлы CurseForge",
                  done: 15,
                  total: 109,
                }),
              );
              return new Promise(() => {});
            }
            return "installed-fixture";
          }
          return null;
        },
      };
    },
    { language, unsupported, installing },
  );
  await page.goto("/");
  await page.locator(".sidebar nav button").nth(2).click();
  await page.locator(".catalog-result").first().waitFor();
}
async function source(page: Page, name: string, language = "ru") {
  await page
    .getByRole("combobox", {
      name: language === "ru" ? "Источник проектов" : "Project source",
    })
    .click();
  await page.getByRole("option", { name, exact: true }).click();
  await expect(page.locator(".catalog-result h3")).toContainText(
    `${name.toLowerCase()} fixture`,
  );
}

for (const language of ["ru", "en"]) {
  test(`installation progress names the modpack and wraps long names (${language})`, async ({
    page,
  }) => {
    await fixture(page, language, false, true);
    await source(page, "FTB", language);
    await page.locator(".catalog-card").click();
    await page
      .getByRole("button", {
        name:
          language === "ru"
            ? "Создать сборку из модпака"
            : "Creating an instance from a mod pack",
      })
      .click();
    const panel = page.locator(".operation-panel");
    const title = panel.locator("b");
    const label = language === "ru" ? "Модпак" : "Modpack";
    await expect(title).toHaveText(`${label} ftb fixture`);
    await expect(panel.locator("progress")).toHaveAttribute("value", "15");
    const name = "ОченьДлинноеНазваниеМодпака".repeat(8);
    await page.evaluate((packName) => {
      const w = window as any;
      w.emitPackProgress({
        id: w.packOperationId,
        profileId: null,
        phase: "pack",
        packName,
        message: "Файлы CurseForge",
        done: 16,
        total: 109,
      });
    }, name);
    await expect(title).toHaveText(`${label} ${name}`);
    const bounds = await panel.boundingBox();
    const titleBounds = await title.boundingBox();
    expect(titleBounds!.x + titleBounds!.width).toBeLessThanOrEqual(
      bounds!.x + bounds!.width,
    );
    await page.screenshot({
      path: `.test-data/screenshots/pack-progress-${language}-dark.png`,
    });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.screenshot({
      path: `.test-data/screenshots/pack-progress-${language}-light.png`,
    });
  });
}

test("all pack sources browse anonymously and show only supported filters", async ({
  page,
}) => {
  await fixture(page);
  for (const name of ["ATLauncher", "FTB", "Technic"]) {
    await source(page, name);
    await expect(page.locator(".catalog-context")).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Категория проекта" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("combobox", { name: "Фильтр загрузчика" }),
    ).toHaveCount(0);
    if (name === "Technic")
      await expect(
        page.getByRole("combobox", { name: "Фильтр версии Minecraft" }),
      ).toHaveCount(0);
    const last = await page.evaluate(
      () =>
        (window as any).packRequests
          .filter((r: any) => r.action === "search")
          .at(-1).payload.query,
    );
    expect(last.kind).toBe("modpack");
    expect(last.source).toBe(name.toLowerCase());
  }
  await page
    .getByRole("textbox", { name: "Поиск проектов", exact: true })
    .fill("Adventure");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).packRequests
            .filter((r: any) => r.action === "search")
            .at(-1).payload.query.query,
      ),
    )
    .toBe("Adventure");
  expect(
    await page.evaluate(() =>
      (window as any).packRequests.some((r: any) =>
        r.action.startsWith("login"),
      ),
    ),
  ).toBe(false);
});

test("FTB version installs as a new profile without login", async ({
  page,
}) => {
  await fixture(page);
  await source(page, "FTB");
  await page.locator(".catalog-card").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Версия проекта" }).click();
  await page.getByRole("option", { name: "1.0", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Создать сборку из модпака" })
    .click();
  await expect(dialog).toHaveCount(0);
  const call = await page.evaluate(
    () =>
      (window as any).packRequests.find((r: any) => r.action === "downloadPack")
        .payload,
  );
  expect(call).toMatchObject({
    source: "ftb",
    projectId: "test-pack",
    versionId: "1.0",
    options: { manualFiles: {} },
  });
});

test("ATLauncher optional selection requests browser files and passes chosen paths", async ({
  page,
}) => {
  await fixture(page);
  await source(page, "ATLauncher");
  await page.locator(".catalog-card").click();
  const install = page.getByRole("button", {
    name: "Создать сборку из модпака",
  });
  await expect(install).toBeEnabled();
  await page
    .getByRole("checkbox", { name: "Optional map An optional minimap" })
    .check();
  await expect(install).toBeDisabled();
  await page.getByRole("button", { name: "Скачать на сайте" }).click();
  await page.getByRole("button", { name: "Выбрать файл" }).click();
  await expect(install).toBeEnabled();
  await install.click();
  const call = await page.evaluate(
    () =>
      (window as any).packRequests.find((r: any) => r.action === "downloadPack")
        .payload,
  );
  expect(call.options).toEqual({
    optional: ["optional"],
    manualFiles: { "mods/manual.jar": "D:/fixture/manual.jar" },
  });
});

test("unsupported pack preflight keeps install disabled and project page accessible in English", async ({
  page,
}) => {
  await fixture(page, "en", true);
  await source(page, "Technic", "en");
  await page.locator(".catalog-card").click();
  await expect(
    page.getByText("This legacy pack requires unsupported custom jar patches"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Creating an instance from a mod pack" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Project page" }).click();
  expect(
    await page.evaluate(() =>
      (window as any).packRequests.some(
        (r: any) =>
          r.action === "openUrl" &&
          r.payload.url === "https://example.test/modpack",
      ),
    ),
  ).toBe(true);
});

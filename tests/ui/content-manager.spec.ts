import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  theme = "light",
  running = false,
  language = "ru",
  extraRows = 0,
) {
  await page.addInitScript(
    ({ theme, running, language, extraRows }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const icon =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOioAAAAASUVORK5CYII=";
      const content = [
        {
          id: "mr:sodium",
          name: "Sodium",
          filename: "sodium-fabric-mc1.21.1-0.5.11.jar",
          source: "modrinth",
          projectId: "sodium",
          versionId: "old-sodium",
          versionName: "0.5.11",
          icon,
          author: "CaffeineMC",
          kind: "mod",
          enabled: true,
          modifiedAt: 100,
        },
        {
          id: "mr:iris",
          name: "Iris Shaders",
          filename: "iris-fabric-1.8.8.jar",
          source: "modrinth",
          projectId: "iris",
          versionId: "old-iris",
          versionName: "1.8.8",
          icon,
          author: "coderbot",
          kind: "mod",
          enabled: false,
          modifiedAt: 200,
        },
        {
          id: "mr:architectury",
          name: "Architectury API",
          filename: "architectury-13.0.8-fabric.jar",
          source: "modrinth",
          projectId: "architectury",
          versionId: "architectury-current",
          versionName: "13.0.8",
          icon,
          author: "architectury",
          kind: "mod",
          enabled: true,
          modifiedAt: 300,
        },
        {
          id: "local:fresh",
          name: "Fresh Animations",
          filename: "FreshAnimations-v1.9.2.zip",
          source: "local",
          projectId: "",
          versionId: "",
          versionName: "",
          icon: null,
          author: "",
          kind: "resourcepack",
          enabled: true,
          modifiedAt: 400,
        },
        {
          id: "local:private",
          name: "Private utility",
          filename: "private-utility.jar",
          source: "local",
          projectId: "",
          versionId: "",
          versionName: "2.4.0",
          icon: null,
          author: "My friend",
          kind: "mod",
          enabled: true,
          modifiedAt: 500,
        },
      ];
      for (let i = 0; i < extraRows; i++) {
        content.push({
          ...content[0],
          id: `mr:extra-${i}`,
          projectId: `extra-${i}`,
          name: `Extra mod ${String(i).padStart(3, "0")}`,
          filename: `extra-${i}.jar`,
        });
      }
      const updates = [
        {
          contentId: "mr:sodium",
          versionId: "new-sodium",
          versionName: "0.6.13",
        },
        { contentId: "mr:iris", versionId: "new-iris", versionName: "1.8.11" },
      ];
      const profile = {
        id: "profile-test",
        name: language === "en" ? "Cozy World" : "Уютный мир",
        minecraft: "1.21.1",
        loader: "fabric",
        loaderVersion: "0.16.14",
        installedVersion: "fabric-1.21.1",
        ramMb: null,
        jvmArgs: "",
        lastPlayed: null,
        cover: 0,
        icon: null,
        content,
      };
      const state = {
        profiles: [profile],
        accounts: [],
        selectedAccount: null,
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
        dataDir: "D:/Aurum-test",
        running: running ? [profile.id] : [],
        curseforgeConfigured: false,
      };
      const callbacks = new Map<number, Function>();
      let next = 0;
      w.requests = [];
      w.inspectFails = false;
      w.bulkFails = false;
      const apply = (id: string) => {
        const index = updates.findIndex((u) => u.contentId === id);
        if (index >= 0) {
          const update = updates[index];
          const item = content.find((c) => c.id === id)!;
          item.versionId = update.versionId;
          item.versionName = update.versionName;
          updates.splice(index, 1);
        }
      };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(fn: Function) {
          callbacks.set(++next, fn);
          return next;
        },
        async invoke(command: string, args: any) {
          if (command === "plugin:event|listen") return 1;
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.requests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "search") return { projects: [], total: 0 };
          if (action === "content") {
            if (w.pauseContent)
              await new Promise<void>((resolve) => {
                w.finishContent = resolve;
              });
            return structuredClone(content);
          }
          if (action === "inspectContent") {
            if (w.inspectFails) throw "Нет сети";
            return structuredClone({ content, updates, warnings: [] });
          }
          if (action === "manageContent") {
            const i = content.findIndex((c) => c.id === payload.contentId);
            if (payload.action === "toggle")
              content[i].enabled = !content[i].enabled;
            else {
              content.splice(i, 1);
              const u = updates.findIndex(
                (u) => u.contentId === payload.contentId,
              );
              if (u >= 0) updates.splice(u, 1);
            }
            return null;
          }
          if (action === "updateContent") {
            apply(payload.contentId);
            return null;
          }
          if (action === "installContent") {
            apply(`mr:${payload.projectId}`);
            return null;
          }
          if (action === "updateAllContent") {
            if (w.bulkFails) {
              apply("mr:sodium");
              return {
                updated: 1,
                failed: [
                  { name: "Iris Shaders", message: "Не удалось скачать файл" },
                ],
                cancelled: false,
              };
            }
            payload.contentIds.forEach(apply);
            return {
              updated: payload.contentIds.length,
              failed: [],
              cancelled: false,
            };
          }
          if (action === "project") {
            const item = content.find((c) => c.projectId === payload.id)!;
            return {
              project: {
                id: item.projectId,
                source: "modrinth",
                title: item.name,
                description: "",
                author: item.author,
                icon,
                downloads: 100,
                kind: "mod",
              },
              body: "Описание установленного мода",
              gallery: [],
              versions: [
                {
                  id:
                    item.projectId === "sodium" ? "new-sodium" : item.versionId,
                  name:
                    item.projectId === "sodium" ? "0.6.13" : item.versionName,
                  gameVersions: ["1.21.1"],
                  loaders: ["fabric"],
                },
              ],
              url: `https://modrinth.com/project/${item.projectId}`,
            };
          }
          throw `Unexpected action: ${action}`;
        },
      };
    },
    { theme, running, language, extraRows },
  );
  await page.goto("/");
  await page
    .getByRole("button", {
      name: language === "en" ? "My instances" : "Мои сборки",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", {
      name: language === "en" ? "Open Cozy World" : "Открыть Уютный мир",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("table", {
      name: language === "en" ? "Installed content" : "Установленный контент",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      language === "en" ? "Updates available: 2" : "Доступно обновлений: 2",
    ),
  ).toBeVisible();
}

test("English content controls and table headings are translated", async ({
  page,
}) => {
  await fixture(page, "light", false, "en");
  await expect(
    page.getByRole("button", { name: "Filter", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add file", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("columnheader")).toHaveText([
    "Project",
    "Version",
    "Actions",
  ]);
});

const rows = (page: Page) => page.locator(".installed-content-row");
const names = (page: Page) =>
  rows(page).locator(".installed-project-name").allTextContents();

test("project images and names are separate from versions; project page opens inside the launcher", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.getByRole("columnheader")).toHaveText([
    "Проект",
    "Версия",
    "Действия",
  ]);
  await expect(rows(page)).toHaveCount(5);
  const sodium = rows(page).filter({ hasText: "Sodium" });
  await expect(sodium.locator(".installed-content-project img")).toHaveCount(1);
  await expect(sodium.locator(".installed-content-version b")).toHaveText(
    "0.5.11",
  );
  await expect(sodium.locator(".installed-content-version")).toHaveAttribute(
    "title",
    /sodium-fabric-mc1.21.1-0.5.11.jar/,
  );
  expect((await sodium.boundingBox())!.height).toBeLessThanOrEqual(72);
  expect(
    (await sodium.locator(".installed-project-icon").boundingBox())!.width,
  ).toBeGreaterThan(44);
  await expect(
    rows(page)
      .filter({ hasText: "Fresh Animations" })
      .getByText("Версия неизвестна"),
  ).toBeVisible();
  await sodium.getByRole("button", { name: "Sodium", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sodium", exact: true });
  await expect(dialog.getByText("Описание установленного мода")).toBeVisible();
  await dialog.getByRole("button", { name: "Закрыть диалог" }).click();
  await expect(rows(page)).toHaveCount(5);
});

for (const theme of ["light", "dark"]) {
  test(`closing a mod page preserves the long list and scroll without refetching in ${theme} theme`, async ({
    page,
  }) => {
    await fixture(page, theme, false, "ru", 80);
    await page.getByRole("button", { name: "Моды", exact: true }).click();
    const sodium = rows(page).filter({ hasText: "Sodium" });
    const open = sodium.getByRole("button", { name: "Sodium", exact: true });
    await open.scrollIntoViewIfNeeded();
    const before = await page.evaluate(() => {
      const w = window as any;
      w.savedContentTable = document.querySelector(".installed-content-table");
      w.contentListReplaced = false;
      w.contentListObserver = new MutationObserver((records) => {
        for (const record of records) {
          if (
            [...record.removedNodes].includes(w.savedContentTable) ||
            [...record.addedNodes].some(
              (node) => node instanceof Element && node.matches(".loading"),
            )
          )
            w.contentListReplaced = true;
        }
      });
      w.contentListObserver.observe(
        document.querySelector(".instance-content-manager"),
        { childList: true },
      );
      return {
        scroll: document.querySelector(".content-scroll")!.scrollTop,
        requests: w.requests.filter((r: any) =>
          ["content", "inspectContent"].includes(r.action),
        ).length,
      };
    });
    expect(before.scroll).toBeGreaterThan(500);
    for (const close of ["button", "escape", "backdrop"]) {
      await open.click();
      const dialog = page.getByRole("dialog", { name: "Sodium", exact: true });
      await expect(
        dialog.getByText("Описание установленного мода"),
      ).toBeVisible();
      if (close === "button")
        await dialog.getByRole("button", { name: "Закрыть диалог" }).click();
      else if (close === "escape") await page.keyboard.press("Escape");
      else
        await page
          .locator(".modal-backdrop")
          .click({ position: { x: 5, y: 5 } });
      await expect(dialog).toHaveCount(0);
      const after = await page.evaluate(() => ({
        scroll: document.querySelector(".content-scroll")!.scrollTop,
        requests: (window as any).requests.filter((r: any) =>
          ["content", "inspectContent"].includes(r.action),
        ).length,
        sameTable:
          (window as any).savedContentTable ===
          document.querySelector(".installed-content-table"),
        replaced: (window as any).contentListReplaced,
      }));
      expect(after.scroll).toBeCloseTo(before.scroll, 0);
      expect(after.requests).toBe(before.requests);
      expect(after.sameTable).toBe(true);
      expect(after.replaced).toBe(false);
      await expect(rows(page)).toHaveCount(84);
      await expect(
        page.getByRole("button", { name: "Моды", exact: true }),
      ).toHaveClass(/active/);
    }
    await page.evaluate(() => (window as any).contentListObserver.disconnect());
  });
}

test("installing from a mod page refreshes content without hiding the list or resetting scroll", async ({
  page,
}) => {
  await fixture(page, "dark", false, "ru", 80);
  const sodium = rows(page).filter({ hasText: "Sodium" });
  const open = sodium.getByRole("button", { name: "Sodium", exact: true });
  await open.scrollIntoViewIfNeeded();
  const before = await page
    .locator(".content-scroll")
    .evaluate((e) => e.scrollTop);
  await page.evaluate(() => {
    (window as any).savedContentTable = document.querySelector(
      ".installed-content-table",
    );
    (window as any).pauseContent = true;
  });
  await open.click();
  const dialog = page.getByRole("dialog", { name: "Sodium", exact: true });
  await dialog
    .getByRole("button", { name: "Установить с зависимостями" })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).finishContent))
    .toBe("function");
  await expect(
    page.locator(".instance-content-manager > .loading"),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as any).savedContentTable ===
        document.querySelector(".installed-content-table"),
    ),
  ).toBe(true);
  expect(
    await page.locator(".content-scroll").evaluate((e) => e.scrollTop),
  ).toBeCloseTo(before, 0);
  await page.evaluate(() => {
    (window as any).pauseContent = false;
    (window as any).finishContent();
  });
  await expect(sodium.locator(".installed-content-version b")).toHaveText(
    "0.6.13",
  );
  await expect(
    page.getByText("Доступно обновлений: 1", { exact: true }),
  ).toBeVisible();
  expect(
    await page.locator(".content-scroll").evaluate((e) => e.scrollTop),
  ).toBeCloseTo(before, 0);
});

test("sorting, search, kind and simple state/source/author filters compose and reset", async ({
  page,
}) => {
  await fixture(page);
  expect(await names(page)).toEqual([
    "Architectury API",
    "Fresh Animations",
    "Iris Shaders",
    "Private utility",
    "Sodium",
  ]);
  await page.getByRole("combobox", { name: "Сортировка контента" }).click();
  await page
    .getByRole("option", { name: "Название (Я–А)", exact: true })
    .click();
  expect(await names(page)).toEqual([
    "Sodium",
    "Private utility",
    "Iris Shaders",
    "Fresh Animations",
    "Architectury API",
  ]);
  await page.getByRole("combobox", { name: "Сортировка контента" }).click();
  await page
    .getByRole("option", { name: "Сначала новые", exact: true })
    .click();
  expect((await names(page))[0]).toBe("Private utility");
  await page.getByRole("textbox", { name: "Поиск в сборке" }).fill("0.5.11");
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("textbox", { name: "Поиск в сборке" }).clear();
  await page.getByRole("button", { name: "Фильтр", exact: true }).click();
  await page.getByRole("combobox", { name: "Состояние контента" }).click();
  await page.getByRole("option", { name: "Отключённые", exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  expect(await names(page)).toEqual(["Iris Shaders"]);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await page.getByRole("combobox", { name: "Источник контента" }).click();
  await page
    .getByRole("option", { name: "Локальные файлы", exact: true })
    .click();
  await expect(rows(page)).toHaveCount(2);
  await page.getByRole("button", { name: "Сбросить", exact: true }).click();
  await page.getByRole("combobox", { name: "Автор контента" }).click();
  await page.getByRole("option", { name: "CaffeineMC", exact: true }).click();
  expect(await names(page)).toEqual(["Sodium"]);
  await page.getByRole("button", { name: "Ресурспаки", exact: true }).click();
  await expect(
    page.getByText("Ничего не найдено", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Сбросить фильтры" }).click();
  await expect(rows(page)).toHaveCount(5);
});

test("switches and nearby trash actions manage actual rows; update all covers disabled projects", async ({
  page,
}) => {
  await fixture(page);
  const toggle = page.getByRole("switch", {
    name: "Отключить Sodium",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(
    page.getByRole("switch", { name: "Включить Sodium", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  const remove = page.getByRole("button", {
    name: "Удалить Private utility",
    exact: true,
  });
  const box = await remove.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(38);
  expect(box!.height).toBeGreaterThanOrEqual(38);
  await remove.click();
  await expect(rows(page)).toHaveCount(4);
  const bulk = page.getByRole("button", {
    name: "Обновить всё 2",
    exact: true,
  });
  expect((await bulk.boundingBox())!.height).toBeLessThanOrEqual(40);
  await bulk.click();
  await expect(
    page.getByText("Обновлено проектов: 2", { exact: true }),
  ).toBeVisible();
  await expect(
    rows(page)
      .filter({ hasText: "Sodium" })
      .locator(".installed-content-version b"),
  ).toHaveText("0.6.13");
  await expect(
    rows(page)
      .filter({ hasText: "Iris Shaders" })
      .locator(".installed-content-version b"),
  ).toHaveText("1.8.11");
  await expect(
    page.getByRole("switch", { name: "Включить Iris Shaders", exact: true }),
  ).toHaveAttribute("aria-checked", "false");
  await expect(
    page.getByRole("button", { name: "Обновить всё", exact: true }),
  ).toBeDisabled();
  const request = await page.evaluate(() =>
    (window as any).requests.find((r: any) => r.action === "updateAllContent"),
  );
  expect(request.payload.contentIds).toEqual(["mr:sodium", "mr:iris"]);
});

test("single updates, partial bulk failure and offline recheck keep the content usable", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).bulkFails = true;
  });
  await page
    .getByRole("button", { name: "Обновить всё 2", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Iris Shaders: Не удалось скачать файл",
  );
  await expect(rows(page)).toHaveCount(5);
  await page
    .getByRole("button", { name: "Обновить Iris Shaders", exact: true })
    .click();
  await expect(
    rows(page)
      .filter({ hasText: "Iris Shaders" })
      .locator(".installed-content-version b"),
  ).toHaveText("1.8.11");
  await page.evaluate(() => {
    (window as any).inspectFails = true;
  });
  await page
    .getByRole("button", { name: "Проверить обновления", exact: true })
    .click();
  await expect(
    page.getByText("Обновления проверены не полностью"),
  ).toBeVisible();
  await expect(rows(page)).toHaveCount(5);
  await expect(
    page.getByRole("switch", { name: "Отключить Sodium", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() => {
    (window as any).inspectFails = false;
  });
  await page
    .getByRole("button", { name: "Проверить обновления", exact: true })
    .click();
  await expect(page.getByText("Совместимых обновлений нет")).toBeVisible();
});

test("a running game prevents updates, toggles and removal", async ({
  page,
}) => {
  await fixture(page, "dark", true);
  await expect(
    page.getByRole("button", { name: "Обновить всё 2", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("switch", { name: "Отключить Sodium", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Удалить Sodium", exact: true }),
  ).toBeDisabled();
});

for (const theme of ["light", "dark"]) {
  test(`content layout and filter panel fit minimum desktop size in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 });
    await fixture(page, theme);
    await page.getByRole("button", { name: "Фильтр", exact: true }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    for (const element of [
      page.getByRole("table"),
      page.locator(".installed-content-filters"),
      page.getByRole("button", { name: "Обновить всё 2", exact: true }),
    ]) {
      const box = await element.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(960);
    }
    await page.screenshot({
      path: `.test-data/screenshots/content-manager-${theme}.png`,
      animations: "disabled",
    });
  });
}

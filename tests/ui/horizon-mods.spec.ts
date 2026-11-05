import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  withMods = true,
  theme = "dark",
  language = "ru",
) {
  await page.addInitScript(
    ({ withMods, theme, language }) => {
      const w = window as any;
      localStorage.setItem("aurum:language", language);
      w.isTauri = true;
      w.requests = [];
      const makeMod = (id: string) => ({
        id: `horizon:${id}`,
        source: "horizon",
        projectId: id,
        versionId: "1.0",
        versionName: "1.0",
        name: id === "zoom" ? "Zoom" : "Veinminer",
        filename: `${id}.hnmod`,
        kind: "mod",
        enabled: true,
      });
      const profile = {
        id: "native",
        name: "Rust World",
        engine: "horizon",
        minecraft: "26.3",
        loader: "vanilla",
        loaderVersion: null,
        installedVersion: "nightly-test",
        ramMb: null,
        jvmArgs: "",
        cover: 0,
        lastPlayed: 1,
        content: withMods ? [makeMod("veinminer"), makeMod("zoom")] : [],
      };
      const state = {
        profiles: [profile],
        accounts: [
          {
            id: "owner",
            uuid: "owner",
            name: "Player",
            kind: "microsoft",
            skinModel: "steve",
            hasSkin: false,
          },
        ],
        selectedAccount: "owner",
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
        dataDir: "D:/Owned-fixture",
        running: [],
        curseforgeConfigured: false,
      };
      let dirty = withMods;
      let compiled = false;
      let resolveBuild: ((v: null) => void) | undefined;
      let rejectBuild: ((v: Error) => void) | undefined;
      const callbacks = new Map<number, Function>();
      let next = 0;
      let eventHandler = 0;
      w.finishNativeBuild = () => {
        dirty = false;
        compiled = true;
        resolveBuild?.(null);
      };
      w.failNativeBuild = () =>
        rejectBuild?.(
          new Error("Compiler fixture failed; previous build preserved"),
        );
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
          if (command === "plugin:event|listen") {
            if (args.event === "auren:event") eventHandler = args.handler;
            return 1;
          }
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.requests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "accountAvatar") throw new Error("No fixture avatar");
          if (action === "versions")
            return {
              latest: { release: "26.3" },
              versions: [{ id: "26.3", type: "release" }],
            };
          if (action === "catalogCategories") return [];
          if (action === "search")
            return payload.query.source === "horizon"
              ? {
                  projects: [
                    {
                      id: "veinminer",
                      source: "horizon",
                      title: "Veinminer",
                      description: "Native ore mining",
                      author: "Author",
                      icon: null,
                      downloads: 100,
                      kind: "mod",
                    },
                  ],
                  total: 1,
                }
              : { projects: [], total: 0 };
          if (action === "project")
            return {
              project: {
                id: "veinminer",
                source: "horizon",
                title: "Veinminer",
                description: "Native ore mining",
                author: "Author",
                icon: null,
                downloads: 100,
                kind: "mod",
              },
              body: "Rust source mod",
              gallery: [],
              versions: [
                {
                  id: "1.0",
                  name: "1.0",
                  gameVersions: ["26.3"],
                  loaders: ["horizon"],
                },
              ],
              url: "https://playhorizon.dev/mods/veinminer",
            };
          if (action === "horizonModStatus")
            return {
              mods: structuredClone(profile.content),
              enabled: profile.content.filter((m) => m.enabled).length,
              needsBuild: dirty && profile.content.some((m) => m.enabled),
              hasBuild: compiled,
              builtAt: compiled ? 1 : null,
              error: null,
            };
          if (action === "installContent") {
            profile.content.push(makeMod(payload.projectId));
            dirty = true;
            return null;
          }
          if (action === "manageContent") {
            if (payload.action === "remove")
              profile.content = profile.content.filter(
                (m) => m.id !== payload.contentId,
              );
            else {
              const mod = profile.content.find(
                (m) => m.id === payload.contentId,
              )!;
              mod.enabled = !mod.enabled;
            }
            dirty = true;
            return null;
          }
          if (action === "buildHorizonMods") {
            const result = new Promise<null>((resolve, reject) => {
              resolveBuild = resolve;
              rejectBuild = reject;
            });
            queueMicrotask(() =>
              callbacks.get(eventHandler)?.({
                event: "auren:event",
                id: 1,
                payload: {
                  id: payload.operationId,
                  profileId: profile.id,
                  phase: "horizon-build",
                  message: "Compiling native sources",
                  done: 0,
                  total: 0,
                },
              }),
            );
            return result;
          }
          if (action === "cancel") {
            rejectBuild?.(new Error("Операция отменена"));
            return null;
          }
          if (action === "horizonBuildLog")
            return "Compiling native sources\nfixture build log";
          if (action === "launch" || action === "openFolder") return null;
          if (action === "content") return [];
          return null;
        },
      };
    },
    { withMods, theme, language },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: language === "ru" ? "Главная" : "Home",
      exact: true,
    }),
  ).toBeVisible();
}

async function openProfile(page: Page) {
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть Rust World", exact: true })
    .first()
    .click();
  await expect(page.locator(".horizon-mods")).toBeVisible();
}

test("native catalog downloads sources only; explicit build shows progress and marks the exact selection ready", async ({
  page,
}) => {
  await fixture(page, false);
  await openProfile(page);
  await expect(page.locator(".native-mod-notice")).toContainText("20–30");
  const notice = page.locator(".native-mod-notice");
  await expect(notice.locator(":scope > p")).toHaveCount(1);
  await expect(notice.locator("details")).not.toHaveAttribute("open");
  await notice.getByText("Подробнее", { exact: true }).click();
  await expect(notice.locator(".native-code-trust")).toBeVisible();
  await notice.getByText("Подробнее", { exact: true }).click();
  await expect(notice.locator(".native-code-trust")).not.toBeVisible();
  await page
    .getByRole("button", { name: "Найти моды Horizon", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Источник проектов", exact: true }),
  ).toContainText("Horizon");
  await expect(
    page.getByRole("combobox", { name: "Фильтр загрузчика", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Поиск проектов", exact: true })
    .fill("vein");
  await page
    .getByRole("button", { name: "Скачать исходники · Veinminer", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: /Установлено: Veinminer/ }),
  ).toBeVisible();
  let requests = await page.evaluate(() => (window as any).requests);
  expect(
    requests.filter((r: any) => r.action === "buildHorizonMods"),
  ).toHaveLength(0);
  expect(
    requests.find((r: any) => r.action === "installContent").payload.source,
  ).toBe("horizon");
  await openProfile(page);
  await expect(page.locator(".native-build-state")).toContainText(
    "Изменения ещё не скомпилированы",
  );
  await page
    .getByRole("button", { name: "Скомпилировать", exact: true })
    .click();
  await expect(page.locator(".native-build-state")).toContainText(
    "Компилируем моды…",
  );
  await page
    .getByRole("button", { name: "Журнал компиляции", exact: true })
    .click();
  await expect(page.locator(".native-build-log")).toContainText(
    "fixture build log",
  );
  requests = await page.evaluate(() => (window as any).requests);
  expect(
    requests.find((r: any) => r.action === "buildHorizonMods").payload
      .trustNativeCode,
  ).toBe(true);
  expect(requests.filter((r: any) => r.action === "launch")).toHaveLength(0);
  await page.evaluate(() => (window as any).finishNativeBuild());
  await expect(page.locator(".native-build-state")).toContainText(
    "Сборка модов готова",
  );
  await page.screenshot({
    path: "target/branding-icons/horizon-mods-dark.png",
  });
});

test("dirty launch can explicitly postpone and play base Horizon without starting compilation", async ({
  page,
}) => {
  await fixture(page);
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Играть", exact: true })
    .click();
  const prompt = page.getByRole("dialog", {
    name: "Моды ещё не скомпилированы",
    exact: true,
  });
  await expect(prompt).toContainText("Veinminer");
  await expect(prompt).toContainText("20–30");
  await prompt
    .getByRole("button", { name: "Отложить и играть без модов", exact: true })
    .click();
  await expect(prompt).toHaveCount(0);
  const requests = await page.evaluate(() => (window as any).requests);
  expect(
    requests.filter((r: any) => r.action === "buildHorizonMods"),
  ).toHaveLength(0);
  expect(
    requests.find((r: any) => r.action === "launch").payload.skipHorizonMods,
  ).toBe(true);
});

test("compile-and-play waits for success; a failed build never starts a stale modded game", async ({
  page,
}) => {
  await fixture(page);
  await page
    .locator(".quick-launch")
    .getByRole("button", { name: "Играть", exact: true })
    .click();
  const prompt = page.getByRole("dialog", {
    name: "Моды ещё не скомпилированы",
    exact: true,
  });
  await prompt
    .getByRole("button", { name: "Скомпилировать и играть", exact: true })
    .click();
  await expect(
    prompt.getByRole("button", {
      name: "Скомпилировать и играть",
      exact: true,
    }),
  ).toBeDisabled();
  expect(
    (await page.evaluate(() => (window as any).requests)).filter(
      (r: any) => r.action === "launch",
    ),
  ).toHaveLength(0);
  await page.evaluate(() => (window as any).failNativeBuild());
  await expect(
    prompt.getByRole("button", {
      name: "Скомпилировать и играть",
      exact: true,
    }),
  ).toBeEnabled();
  expect(
    (await page.evaluate(() => (window as any).requests)).filter(
      (r: any) => r.action === "launch",
    ),
  ).toHaveLength(0);
  await prompt
    .getByRole("button", { name: "Скомпилировать и играть", exact: true })
    .click();
  await page.evaluate(() => (window as any).finishNativeBuild());
  await expect(prompt).toHaveCount(0);
  const requests = await page.evaluate(() => (window as any).requests);
  expect(
    requests.find((r: any) => r.action === "launch").payload.skipHorizonMods,
  ).toBe(false);
});

test("changed selection requires a new build and cancellation does not launch the game", async ({
  page,
}) => {
  await fixture(page);
  await openProfile(page);
  await page
    .getByRole("button", { name: "Удалить мод Zoom", exact: true })
    .click();
  await expect(page.locator(".native-mod-row")).toHaveCount(1);
  await page.getByRole("button", { name: "Играть", exact: true }).click();
  const prompt = page.getByRole("dialog", {
    name: "Моды ещё не скомпилированы",
    exact: true,
  });
  await prompt
    .getByRole("button", { name: "Скомпилировать и играть", exact: true })
    .click();
  await prompt
    .getByRole("button", { name: "Остановить компиляцию", exact: true })
    .click();
  await expect(
    prompt.getByRole("button", {
      name: "Скомпилировать и играть",
      exact: true,
    }),
  ).toBeEnabled();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests.filter((r: any) => r.action === "cancel")).toHaveLength(1);
  expect(requests.filter((r: any) => r.action === "launch")).toHaveLength(0);
});

test("native mod controls fit the minimum light English window", async ({
  page,
}) => {
  await fixture(page, true, "light", "en");
  await page.setViewportSize({ width: 960, height: 680 });
  await page.getByRole("button", { name: "My instances", exact: true }).click();
  await page
    .getByRole("button", { name: "Open Rust World", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Compile", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".native-mod-notice")).toContainText("several GB");
  await expect(page.locator(".native-mod-notice summary")).toHaveText("Details");
  expect(
    await page
      .locator(".content-scroll")
      .evaluate((el) => el.scrollWidth > el.clientWidth),
  ).toBe(false);
  await page.screenshot({
    path: "target/branding-icons/horizon-mods-light-en.png",
  });
});

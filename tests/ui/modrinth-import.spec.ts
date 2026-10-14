import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  mode: "normal" | "empty" | "partial" | "running" = "normal",
) {
  await page.addInitScript(
    ({ mode }) => {
      const w = window as any;
      w.isTauri = true;
      const profiles = [
        {
          id: "source-a",
          name: "Уютный мир",
          path: "D:/Modrinth/profiles/Cozy",
          minecraft: "1.21.1",
          loader: "fabric",
          loaderVersion: "0.16.14",
          mods: 42,
          worlds: 2,
          icon: null,
          issue: null,
          warnings: [],
        },
        {
          id: "source-b",
          name: "Приключения",
          path: "D:/Modrinth/profiles/Adventure",
          minecraft: "1.20.1",
          loader: "forge",
          loaderVersion: "47.4.0",
          mods: 156,
          worlds: 3,
          icon: null,
          issue: null,
          warnings: [],
        },
        {
          id: "source-c",
          name: "Творческая",
          path: "D:/Modrinth/profiles/Creative",
          minecraft: "1.21.4",
          loader: "vanilla",
          loaderVersion: null,
          mods: 0,
          worlds: 1,
          icon: null,
          issue: "Закройте Minecraft этой сборки и обновите список",
          warnings: [],
        },
      ];
      const state = {
        profiles: [] as any[],
        accounts: [],
        selectedAccount: null,
        settings: {
          theme: "light",
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          microsoftClientId: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
        dataDir: "D:/Aurum",
        running: [],
        curseforgeConfigured: false,
      };
      w.fixtureRequests = [];
      const callbacks = new Map<number, Function>();
      let nextCallback = 0;
      let eventHandler: number | undefined;
      let finishImport: ((value: any) => void) | undefined;
      w.emitProgress = (payload: any) => callbacks.get(eventHandler!)?.({
        event: "auren:event", id: 1, payload,
      });
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(callback: Function) {
          callbacks.set(++nextCallback, callback);
          return nextCallback;
        },
        async invoke(command: string, args: any) {
          if (command === "plugin:event|listen") {
            if (args.event === "auren:event") eventHandler = args.handler;
            return 1;
          }
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.fixtureRequests.push({ action, payload });
          if (action === "snapshot") return state;
          if (action === "scanModrinth")
            return {
              profiles:
                mode === "empty" && !payload.directories.length ? [] : profiles,
              directories: ["D:/Modrinth"],
              warnings: [],
            };
          if (action === "chooseModrinthDirectory") return "D:/Custom Modrinth";
          if (action === "saveSettings") {
            state.settings = payload.settings;
            return null;
          }
          if (action === "importModrinth") {
            if (mode === "running") {
              w.operationId = payload.operationId;
              queueMicrotask(() => w.emitProgress({ id: payload.operationId,
                profileId: null, phase: "import", message: "Уютный мир · config/example.toml",
                done: 1378059730, total: 15740408839 }));
              return new Promise(resolve => { finishImport = resolve; });
            }
            const successful = payload.selected.filter(
              (id: string) => mode !== "partial" || id !== "source-b",
            );
            const imported = successful.map((id: string) => ({
              ...profiles.find((p) => p.id === id),
              id: `imported-${id}`,
              installedVersion: null,
              content: [],
              ramMb: null,
              jvmArgs: "",
              lastPlayed: null,
              cover: 1,
            }));
            state.profiles.push(...imported);
            return {
              imported,
              importedSources: successful,
              failed:
                mode === "partial" && payload.selected.includes("source-b")
                  ? [{ name: "Приключения", message: "Недостаточно места" }]
                  : [],
              cancelled: false,
            };
          }
          if (action === "cancel") {
            finishImport?.({ imported: [], importedSources: [], failed: [], cancelled: true });
            return null;
          }
          throw new Error(`Unexpected action: ${action}`);
        },
      };
    },
    { mode },
  );
  await page.goto("/");
}
async function openImport(page: Page) {
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await page.getByRole("button", { name: "Из Modrinth" }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт из Modrinth" });
  await expect(dialog.getByText("Найдено сборок: 3")).toBeVisible();
  return dialog;
}

test("import is in the library menu, supports multiple selection and both themes", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await expect(page.locator(".library-import-options")).toHaveCount(0);
  const dialog = await openImport(page);
  await expect(
    dialog.getByRole("button", { name: "Импортировать", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("checkbox", { name: "Импортировать Творческая" }),
  ).toBeDisabled();
  await dialog
    .getByRole("checkbox", { name: "Импортировать Уютный мир" })
    .check();
  await dialog
    .getByRole("checkbox", { name: "Импортировать Приключения" })
    .check();
  await expect(dialog.getByText("Выбрано: 2")).toBeVisible();
  await expect(
    dialog.getByRole("heading", { name: "Импорт из Modrinth" }),
  ).toBeInViewport();
  await expect(
    dialog.getByRole("button", { name: "Импортировать · 2", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: "docs/screenshots/modrinth-import-light.png",
    animations: "disabled",
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: "docs/screenshots/modrinth-import-dark.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Импортировать · 2", exact: true })
    .click();
  await expect(
    dialog.getByText("Импорт завершён · добавлено: 2"),
  ).toBeVisible();
  const payload = await page.evaluate(
    () =>
      (window as any).fixtureRequests.find(
        (r: any) => r.action === "importModrinth",
      ).payload,
  );
  expect(payload.selected).toEqual(["source-a", "source-b"]);
  await dialog.getByRole("button", { name: "К сборкам", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Уютный мир", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Приключения", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("running import shows MB and keeps stop accessible above the floating progress card", async ({ page }) => {
  await fixture(page, "running");
  await page.evaluate(() => (window as any).emitProgress({
    id: "preview", profileId: null, phase: "import", message: "Копируем сборку",
    done: 1378059730, total: 15740408839,
  }));
  await expect(page.locator(".operation-panel .progress-meta")).toContainText("MB");
  await expect(page.locator(".operation-panel")).not.toContainText("15740408839");
  const dialog = await openImport(page);
  await dialog.getByRole("checkbox", { name: "Импортировать Уютный мир" }).check();
  await dialog.getByRole("button", { name: "Импортировать · 1", exact: true }).click();
  const stop = dialog.getByRole("button", { name: "Остановить импорт", exact: true });
  await expect(dialog.locator(".import-live .progress-meta")).toContainText("MB");
  for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width: 960, height: 680 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await expect(page.locator(".operation-panel")).toBeHidden();
    await expect(stop).toBeInViewport();
    await expect(dialog.locator(".import-live")).toBeInViewport();
    await page.screenshot({ path: `docs/screenshots/modrinth-progress-${theme}.png`, animations: "disabled" });
  }
  await stop.click();
  await expect(dialog.getByText("Импорт остановлен · добавлено: 0")).toBeVisible();
  const cancellation = await page.evaluate(() => {
    const w = window as any;
    return { request: w.fixtureRequests.find((r: any) => r.action === "cancel"), id: w.operationId };
  });
  expect(cancellation.request.payload.operationId).toBe(cancellation.id);
});

test("filtered select-all keeps other selections, fits minimum window, and retries only failures", async ({
  page,
}) => {
  await fixture(page, "partial");
  await page.setViewportSize({ width: 960, height: 680 });
  const dialog = await openImport(page);
  await dialog
    .getByRole("checkbox", { name: "Импортировать Уютный мир" })
    .check();
  await dialog
    .getByRole("textbox", { name: "Поиск профилей Modrinth" })
    .fill("Приключения");
  await dialog.getByRole("button", { name: "Выбрать показанные" }).click();
  await dialog
    .getByRole("textbox", { name: "Поиск профилей Modrinth" })
    .fill("");
  await expect(dialog.getByText("Выбрано: 2")).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    false,
  );
  await page.screenshot({
    path: "docs/screenshots/modrinth-import-small.png",
    animations: "disabled",
  });
  await dialog
    .getByRole("button", { name: "Импортировать · 2", exact: true })
    .click();
  await expect(
    dialog.getByText("Приключения: Недостаточно места"),
  ).toBeVisible();
  await expect(
    dialog.getByRole("checkbox", { name: "Импортировать Уютный мир" }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Импортировать Приключения" }),
  ).toBeChecked();
  await dialog
    .getByRole("button", { name: "Импортировать · 1", exact: true })
    .click();
  const requests = await page.evaluate(() =>
    (window as any).fixtureRequests
      .filter((r: any) => r.action === "importModrinth")
      .map((r: any) => r.payload.selected),
  );
  expect(requests).toEqual([["source-a", "source-b"], ["source-b"]]);
});

test("empty discovery offers a custom directory and rescans after picking it", async ({
  page,
}) => {
  await fixture(page, "empty");
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Импортировать", exact: true })
    .click();
  await page.getByRole("button", { name: "Из Modrinth" }).click();
  const dialog = page.getByRole("dialog", { name: "Импорт из Modrinth" });
  await expect(dialog.getByText("Сборки пока не найдены")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Выбрать папку Modrinth", exact: true })
    .click();
  await expect(dialog.getByText("Найдено сборок: 3")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).fixtureRequests
          .filter((r: any) => r.action === "scanModrinth")
          .at(-1).payload.directories,
    ),
  ).toEqual(["D:/Custom Modrinth"]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

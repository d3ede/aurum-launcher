import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, theme = "light") {
  await page.addInitScript(
    ({ theme }) => {
      localStorage.setItem("aurum:language", "ru");
      const w = window as any;
      w.isTauri = true;
      const state = {
        profiles: [] as any[],
        accounts: [],
        selectedAccount: null,
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
      const callbacks = new Map<number, Function>();
      let next = 0;
      let eventHandler = 0;
      let resolveInstall: Function | undefined;
      let rejectInstall: Function | undefined;
      w.requests = [];
      w.finishInstall = () => {
        state.profiles[0].installedVersion = "1.21.1";
        resolveInstall?.(null);
      };
      w.failInstall = () => rejectInstall?.("Не удалось загрузить Minecraft");
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
          if (action === "search") return { projects: [], total: 0 };
          if (action === "versions")
            return {
              latest: { release: "1.21.1" },
              versions: [{ id: "1.21.1", type: "release" }],
            };
          if (action === "content") return [];
          if (action === "createProfile") {
            const profile = {
              ...payload,
              id: "test-profile",
              installedVersion: null,
              ramMb: null,
              jvmArgs: "",
              lastPlayed: null,
              content: [],
            };
            state.profiles.push(profile);
            return structuredClone(profile);
          }
          if (action === "install") {
            const pending = new Promise((resolve, reject) => {
              resolveInstall = resolve;
              rejectInstall = reject;
            });
            queueMicrotask(() =>
              callbacks.get(eventHandler)?.({
                event: "auren:event",
                id: 1,
                payload: {
                  id: payload.operationId,
                  profileId: payload.id,
                  phase: "libraries",
                  message: "Загружаем Minecraft",
                  done: 1,
                  total: 5,
                },
              }),
            );
            return pending;
          }
          if (action === "openFolder") return null;
          if (action === "cancel") {
            rejectInstall?.("Операция отменена");
            return null;
          }
          throw `Unexpected action: ${action}`;
        },
      };
    },
    { theme },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
}

async function create(page: Page) {
  await page
    .getByRole("button", { name: "Создать сборку", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Новая сборка",
    exact: true,
  });
  await expect(
    dialog.getByText(
      "Minecraft и подходящая Java установятся сразу после создания сборки.",
    ),
  ).toBeVisible();
  await dialog
    .getByRole("textbox", { name: "Название сборки" })
    .fill("Своя сборка");
  await dialog
    .getByRole("button", { name: "Создать сборку", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Своя сборка", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Устанавливаем…", exact: true }),
  ).toBeDisabled();
}

test("creation immediately installs Minecraft without an account and folder stays available", async ({
  page,
}) => {
  await fixture(page);
  await create(page);
  await page.getByRole("button", { name: "Папка", exact: true }).click();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(
    requests.filter((r: any) => r.action === "createProfile"),
  ).toHaveLength(1);
  const installs = requests.filter((r: any) => r.action === "install");
  expect(installs).toHaveLength(1);
  expect(installs[0].payload.id).toBe("test-profile");
  expect(installs[0].payload.operationId).toBeTruthy();
  expect(requests.filter((r: any) => r.action === "openFolder")).toHaveLength(
    1,
  );
  expect(requests.filter((r: any) => r.action === "launch")).toHaveLength(0);
  await page.evaluate(() => (window as any).finishInstall());
  await expect(
    page.getByRole("button", { name: "Играть", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Minecraft установлен", { exact: true }),
  ).toBeVisible();
});

for (const result of ["error", "cancel"] as const) {
  test(`${result} preserves the created instance for retry`, async ({
    page,
  }) => {
    await fixture(page);
    await create(page);
    if (result === "error")
      await page.evaluate(() => (window as any).failInstall());
    else
      await page
        .getByRole("button", { name: "Отменить операцию", exact: true })
        .click();
    await expect(
      page.getByRole("button", { name: "Установить и играть", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByText(
        result === "error"
          ? "Не удалось загрузить Minecraft"
          : "Операция отменена",
        { exact: true },
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Проверить установку", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Устанавливаем…", exact: true }),
    ).toBeDisabled();
    await page.evaluate(() => (window as any).finishInstall());
    await expect(
      page.getByRole("button", { name: "Играть", exact: true }),
    ).toBeEnabled();
    const requests = await page.evaluate(() => (window as any).requests);
    expect(
      requests.filter((r: any) => r.action === "createProfile"),
    ).toHaveLength(1);
    expect(requests.filter((r: any) => r.action === "install")).toHaveLength(2);
  });
}

for (const theme of ["light", "dark"]) {
  test(`Modrinth import uses its monochrome logo in ${theme} theme`, async ({
    page,
  }) => {
    await fixture(page, theme);
    await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
    await page
      .getByRole("button", { name: "Импортировать", exact: true })
      .click();
    const option = page.getByRole("button", {
      name: "Из Modrinth Найти и перенести ваши сборки",
    });
    const logo = option.locator("svg.modrinth-logo");
    await expect(logo).toHaveAttribute("fill", "currentColor");
    expect(await logo.evaluate((e) => getComputedStyle(e).color)).toBe(
      await option.evaluate((e) => getComputedStyle(e).color),
    );
    await page.screenshot({
      path: `docs/screenshots/modrinth-logo-${theme}.png`,
      animations: "disabled",
    });
  });
}

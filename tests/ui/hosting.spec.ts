import { expect, test, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  options: {
    theme?: string;
    language?: string;
    external?: boolean;
    empty?: boolean;
    network?: boolean;
    verbatim?: boolean;
    players?: string[];
    playerCount?: number;
  } = {},
) {
  await page.addInitScript((options) => {
    localStorage.setItem("aurum:language", options.language || "ru");
    const target = window as any;
    target.isTauri = true;
    const profile = {
      id: "5d6daf03-a5db-4cda-aaca-13fa7447d00d",
      name: "Radiance",
      description: "Приватный сервер для друзей",
      root: options.verbatim
        ? "\\\\?\\X:\\Servers\\Friends"
        : "X:/Servers/Radiance",
      directory: ".",
      entrypoint: "paper.jar",
      core: "paper",
      version: "1.21.11",
      javaMajor: 25,
      javaPath: "",
      ramMb: 8192,
      jvmArgs: "",
      icon: { symbol: "core", color: "#e6c56f", background: "#302b20" },
      launches: 14,
      lastStarted: Math.floor(Date.now() / 1000) - 11520,
    };
    let profiles = options.empty
      ? []
      : [
          profile,
          {
            ...profile,
            id: "velocity",
            name: "Velocity",
            core: "velocity",
            ramMb: 1024,
          },
        ];
    if (options.network)
      profiles.push({
        ...profile,
        id: "network",
        name: "Friends",
        core: "network",
        network: {
          components: [profile.id, "velocity"],
          startupScript: "start.bat",
        },
      } as any);
    let trusted = false;
    const settings = {
      port: 25565,
      bind: "127.0.0.1",
      onlineMode: true,
      maxPlayers: 50,
      motd: options.network
        ? "<gradient:#ff3b30:#ff8c1a>Friends</gradient> <#ffb36b>Survival</#ffb36b>"
        : "Radiance",
    };
    let live = {
      status: options.network
        ? "stopped"
        : options.external
          ? "external"
          : "running",
      pid: options.external ? null : 12345,
      startedAt: Math.floor(Date.now() / 1000) - 11520,
      cpu: options.external ? null : 0.4,
      memoryBytes: options.external ? null : 3435973836,
      players:
        options.players ?? (options.external ? [] : ["D_EDE", "Steve", "Alex"]),
      playerCount: options.playerCount ?? 3,
      maxPlayers: 50,
      exitCode: null,
    };
    const state = {
      profiles: [],
      accounts: [],
      selectedAccount: null,
      running: [],
      dataDir: "X:/Test",
      curseforgeConfigured: false,
      hostingSupport: true,
      hostingRunning:
        options.external || options.empty || options.network
          ? []
          : [profile.id],
      settings: {
        language: options.language || "ru",
        theme: options.theme || "dark",
        javaPath: "",
        ramMb: 4096,
        jvmArgs: "",
        resolutionWidth: 1280,
        resolutionHeight: 720,
        showSnapshots: false,
      },
    };
    let messages = [
      {
        sequence: 1,
        time: Math.floor(Date.now() / 1000),
        level: "info",
        message: "[Server thread/INFO]: Done (1.2s)! For help, type help",
      },
      {
        sequence: 2,
        time: Math.floor(Date.now() / 1000),
        level: "warn",
        message: "Test warning: example",
      },
    ];
    target.hostingRequests = [];
    const callbacks = new Map<number, Function>();
    let identifier = 1;
    target.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    target.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback(callback: Function) {
        const result = identifier++;
        callbacks.set(result, callback);
        return result;
      },
      async invoke(command: string, args: any) {
        if (command !== "rpc")
          return command.includes("is_maximized") ? false : 1;
        const { action, payload } = args;
        target.hostingRequests.push({ action, payload });
        if (action === "snapshot") return structuredClone(state);
        if (action === "search") return { projects: [], total: 0 };
        if (action === "hostingProfiles") return structuredClone(profiles);
        if (action === "hostingFiles")
          return {
            entries:
              payload.path === "."
                ? [
                    { name: "world", directory: true, bytes: 0 },
                    { name: "server.properties", directory: false, bytes: 80 },
                  ]
                : [{ name: "level.dat", directory: false, bytes: 2048 }],
            truncated: false,
          };
        if (action === "hostingNetworkStopCommand") {
          Object.assign(
            (profiles.find((profile) => profile.id === payload.id) as any)
              .network,
            { stopCommand: payload.command },
          );
          return null;
        }
        if (action === "hostingScriptTrust")
          return {
            path: "X:/Servers/Friends/start.bat",
            hash: "fixture-hash",
            trusted,
          };
        if (action === "hostingTrustScript") {
          trusted = true;
          return null;
        }
        if (action === "hostingNetworkScript") {
          Object.assign(
            (profiles.find((profile) => profile.id === payload.id) as any)
              .network,
            { startupScript: payload.script },
          );
          trusted = false;
          return null;
        }
        if (action === "hostingSettings") return structuredClone(settings);
        if (action === "hostingConsole")
          return {
            lines: messages.filter((line) => line.sequence > payload.after),
            latest: messages.at(-1)?.sequence || 0,
            truncated: false,
            live: structuredClone(live),
          };
        if (action === "hostingControl") {
          if (["stop", "kill"].includes(payload.action)) {
            live = { ...live, status: "stopped", pid: null };
            state.hostingRunning = [];
          } else
            messages.push({
              sequence: (messages.at(-1)?.sequence || 0) + 1,
              time: Math.floor(Date.now() / 1000),
              level: "command",
              message: `> ${payload.command}`,
            });
          return null;
        }
        if (action === "hostingStart" || action === "hostingRestart") {
          live.status = "running";
          state.hostingRunning = [payload.id];
          return null;
        }
        if (
          action === "hostingPlayerAction" ||
          action === "hostingOpen" ||
          action === "hostingAcceptEula"
        )
          return null;
        if (action === "hostingUpdate") {
          profiles = profiles.map((item) =>
            item.id === payload.id ? { ...item, ...payload.update } : item,
          );
          Object.assign(settings, payload.update.settings);
          return null;
        }
        if (action === "hostingRemove") {
          profiles = profiles.filter((item) => item.id !== payload.id);
          return null;
        }
        if (action === "hostingVersions")
          return [{ version: "1.21.11" }, { version: "1.21.10" }];
        if (action === "hostingInstall") {
          const installed = {
            ...profile,
            ...payload.request,
            id: "installed",
            name: payload.request.name,
          };
          profiles.push(installed);
          return installed;
        }
        if (action === "hostingChooseFolder") return "X:/Servers/Network";
        if (action === "hostingInspect")
          return {
            root: payload.root,
            candidates: [
              {
                id: "paper",
                name: "Lobby",
                directory: "lobby",
                entrypoint: "distributions/paper.jar",
                core: "paper",
                version: "1.21.11",
                javaMajor: 25,
              },
              {
                id: "proxy",
                name: "Proxy",
                directory: "velocity",
                entrypoint: "distributions/velocity.jar",
                core: "velocity",
                version: "3.4.0",
                javaMajor: 21,
              },
              {
                id: "old",
                name: "Old server",
                directory: "archive",
                entrypoint: "archive/paper.jar",
                core: "paper",
                version: "1.20.1",
                javaMajor: 17,
              },
            ],
            warnings: [],
            networks: [{ directory: ".", componentIds: ["paper", "proxy"] }],
            startupScripts: ["start.bat"],
          };
        if (action === "hostingImport") {
          const added = payload.selected.map((id: string) => ({
            ...profile,
            id,
            name: id === "proxy" ? "Proxy" : "Lobby",
          }));
          profiles.push(...added);
          if (
            payload.selected.includes("paper") &&
            payload.selected.includes("proxy")
          ) {
            const parent = {
              ...profile,
              id: "network",
              name: "Network",
              core: "network",
              network: {
                components: ["paper", "proxy"],
                startupScript: "start.bat",
              },
            };
            profiles.push(parent as any);
            return [parent];
          }
          return added;
        }
        throw new Error(`Unexpected RPC: ${action}`);
      },
    };
  }, options);
  await page.goto("/");
  await page
    .getByRole("button", {
      name: options.language === "en" ? "Hosting" : "Хостинг",
      exact: true,
    })
    .click();
  await expect(page.locator(".hosting-page")).toBeVisible();
}

test("hosting matches the dark layout, console filtering, history and player confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page);
  await expect(page.locator(".hosting-summary")).toContainText("Radiance");
  await expect(page.getByRole("tab")).toHaveCount(6);
  await page.screenshot({
    path: ".test-data/hosting-dark.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Консоль", exact: true }).click();
  await expect(page.getByRole("log")).toContainText("Done (1.2s)");
  await page.getByLabel("Поиск в консоли").fill("warning");
  await expect(page.getByRole("log")).not.toContainText("Done (1.2s)");
  await page.getByLabel("Команда сервера", { exact: true }).fill("list");
  await page.getByLabel("Команда сервера", { exact: true }).press("Enter");
  await page.getByLabel("Команда сервера", { exact: true }).press("ArrowUp");
  await expect(page.getByLabel("Команда сервера", { exact: true })).toHaveValue(
    "list",
  );
  await page.getByRole("tab", { name: "Игроки", exact: true }).click();
  await page
    .locator(".hosting-player-list")
    .getByRole("button", { name: "Steve" })
    .click();
  await page.getByRole("combobox", { name: "Действие", exact: true }).click();
  await page.getByRole("option", { name: "Выдать OP", exact: true }).click();
  await page.getByRole("button", { name: "Выполнить", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Steve");
  expect(
    await page.evaluate(() =>
      (window as any).hostingRequests.some(
        (item: any) => item.action === "hostingPlayerAction",
      ),
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostingRequests.find(
            (item: any) => item.action === "hostingPlayerAction",
          )?.payload,
      ),
    )
    .toEqual({
      id: "5d6daf03-a5db-4cda-aaca-13fa7447d00d",
      player: "Steve",
      action: "op",
      target: "lobby",
    });
});

test("settings, icon colors and removal preserve server files", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Запустить", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Настройки", exact: true }).click();
  await page
    .getByLabel("Название сервера", { exact: true })
    .fill("Radiance Local");
  await page.getByRole("button", { name: "Лист", exact: true }).click();
  await page.getByLabel("Цвет значка HEX", { exact: true }).fill("#12ABCD");
  await page
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await expect(page.locator(".hosting-summary h2")).toHaveText(
    "Radiance Local",
  );
  await page
    .getByRole("button", { name: "Убрать профиль", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("не удаляются");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(page.locator(".hosting-list")).not.toContainText(
    "Radiance Local",
  );
});

test("network import selects components explicitly and never starts them", async ({
  page,
}) => {
  await fixture(page, { empty: true });
  await page
    .getByRole("button", { name: "Добавить сервер", exact: true })
    .click();
  await expect(
    page.getByPlaceholder("X:\\Servers\\MyServer", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Обзор", exact: true }).click();
  await expect(
    page.locator(".hosting-import-network .hosting-import-candidate"),
  ).toHaveCount(2);
  await expect(
    page.locator(".hosting-import-candidates input:checked"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Добавить выбранные", exact: true }),
  ).toBeDisabled();
  await expect(
    page
      .locator(".hosting-other-folders")
      .getByText("Old server", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("checkbox", { name: "Выбрать сеть", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Добавить выбранные", exact: false })
    .click();
  await expect(page.locator(".hosting-summary h2")).toHaveText("Network");
  await expect(page.locator(".hosting-list-item")).toHaveCount(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).hostingRequests.find(
          (item: any) => item.action === "hostingImport",
        ).payload.selected,
    ),
  ).toEqual(["paper", "proxy"]);
  expect(
    await page.evaluate(() =>
      (window as any).hostingRequests.some(
        (item: any) => item.action === "hostingStart",
      ),
    ),
  ).toBe(false);
});

test("official installer requires EULA and keeps experimental builds opt-in", async ({
  page,
}) => {
  await fixture(page, { empty: true });
  await page
    .getByRole("button", { name: "Установить сервер", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Название сервера", { exact: true })
    .fill("Clean Paper");
  await expect(
    dialog.getByRole("checkbox", {
      name: "Разрешить экспериментальные сборки",
    }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Установить сервер" }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "Я прочитал и принимаю" }).check();
  await dialog.getByRole("button", { name: "Установить сервер" }).click();
  await expect(page.locator(".hosting-summary h2")).toHaveText("Clean Paper");
  expect(
    await page.evaluate(
      () =>
        (window as any).hostingRequests.find(
          (item: any) => item.action === "hostingInstall",
        ).payload.request,
    ),
  ).toMatchObject({
    core: "paper",
    version: "1.21.11",
    acceptEula: true,
    experimental: false,
  });
});

test("external process cannot receive commands or be killed", async ({
  page,
}) => {
  await fixture(page, { external: true });
  await expect(page.locator(".hosting-summary")).toContainText(
    "Запущен вне Aurum",
  );
  await expect(
    page.getByRole("button", { name: "Запустить", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Действия", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Принудительно завершить", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "Консоль", exact: true }).click();
  await expect(
    page.getByLabel("Команда сервера", { exact: true }),
  ).toBeDisabled();
});

test("compact light English layout stays inside the viewport and supports keyboard tabs", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 760 });
  await fixture(page, { theme: "light", language: "en" });
  await expect(
    page.getByRole("heading", { name: "Hosting", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Information", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Console", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tab", { name: "Console", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".test-data/hosting-light-compact.png",
    fullPage: true,
  });
});

test("consistent core marks distinguish game servers from proxies and offer official Spigot setup", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await fixture(page, { empty: true });
  await page
    .getByRole("button", { name: "Установить сервер", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  const servers = dialog.locator(".hosting-core-group").filter({
    has: page.getByRole("heading", { name: "Игровые серверы", exact: true }),
  });
  await expect(servers.getByRole("button")).toHaveCount(5);
  await dialog.getByRole("checkbox", { name: "Я прочитал и принимаю" }).check();
  await expect(
    dialog.getByRole("checkbox", { name: "Я прочитал и принимаю" }),
  ).toBeChecked();
  for (const name of ["Paper", "Purpur", "Spigot", "Folia", "Vanilla"])
    await expect(
      servers.getByRole("button", { name, exact: true }),
    ).toBeVisible();
  const proxies = dialog.locator(".hosting-core-group").filter({
    has: page.getByRole("heading", { name: "Прокси", exact: true }),
  });
  await expect(
    proxies.getByRole("button", { name: "Velocity", exact: true }),
  ).toBeVisible();
  await expect(
    servers
      .getByRole("button", { name: "Folia", exact: true })
      .getByRole("img", { name: "Folia" }),
  ).toBeVisible();
  const foliaSource = await servers
    .getByRole("button", { name: "Folia", exact: true })
    .locator(".hosting-brand-mask")
    .getAttribute("style");
  expect(decodeURIComponent(foliaSource || "")).toContain("M17,8C8,10");
  await expect(
    servers
      .getByRole("button", { name: "Paper", exact: true })
      .getByRole("img", { name: "Paper" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Установить сервер", exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    animations: "disabled",
    path: ".test-data/hosting-core-selector.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Spigot", exact: true }).click();
  await expect(
    dialog.getByRole("link", { name: "BuildTools" }),
  ).toHaveAttribute("href", "https://www.spigotmc.org/wiki/buildtools/");
  await expect(
    dialog.getByRole("button", { name: "Установить сервер", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).hostingRequests.some(
        (request: any) =>
          request.action === "hostingVersions" &&
          request.payload.core === "spigot",
      ),
    ),
  ).toBe(false);
  await dialog
    .getByRole("button", { name: "Импортировать готовый сервер", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Добавить локальный сервер" }),
  ).toBeVisible();
});

test("Purpur installation and network group selection keep choices explicit", async ({
  page,
}) => {
  await fixture(page, { empty: true });
  await page
    .getByRole("button", { name: "Установить сервер", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Purpur", exact: true }).click();
  await dialog
    .getByLabel("Название сервера", { exact: true })
    .fill("Clean Purpur");
  await expect(
    dialog.getByRole("checkbox", {
      name: "Разрешить экспериментальные сборки",
    }),
  ).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "Я прочитал и принимаю" }).check();
  await dialog
    .getByRole("button", { name: "Установить сервер", exact: true })
    .click();
  await expect(page.locator(".hosting-summary h2")).toHaveText("Clean Purpur");
  expect(
    await page.evaluate(
      () =>
        (window as any).hostingRequests.find(
          (request: any) => request.action === "hostingInstall",
        ).payload.request.core,
    ),
  ).toBe("purpur");
  await page
    .getByRole("button", { name: "Добавить сервер", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Обзор", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Выбрать сеть", exact: true })
    .check();
  await expect(
    page.locator(".hosting-import-network input:checked"),
  ).toHaveCount(3);
  await expect(
    page.locator(".hosting-other-folders input:checked"),
  ).toHaveCount(0);
  await page.screenshot({
    animations: "disabled",
    path: ".test-data/hosting-network-import.png",
    fullPage: true,
  });
});

test("a network has one card and a consented whole-network launch, never component launches", async ({
  page,
}) => {
  await fixture(page, { network: true });
  await expect(page.locator(".hosting-list-item")).toHaveCount(1);
  await expect(page.locator(".hosting-summary h2")).toHaveText("Friends");
  await expect(
    page.getByRole("button", { name: "Запустить", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator(".hosting-network-tiles")).not.toBeVisible();
  await page.locator(".hosting-network-members > summary").first().click();
  await expect(page.locator(".hosting-network-tiles > details")).toHaveCount(2);
  await page.getByRole("button", { name: "Запустить", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("start.bat");
  expect(
    await page.evaluate(() =>
      (window as any).hostingRequests.filter(
        (request: any) => request.action === "hostingStart",
      ),
    ),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).hostingRequests
          .filter((request: any) => request.action === "hostingStart")
          .map((request: any) => request.payload.id),
      ),
    )
    .toEqual(["network"]);
  await page.getByRole("tab", { name: "Консоль", exact: true }).click();
  await expect(
    page.getByLabel("Команда сервера", { exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Запустить", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).hostingRequests.filter(
        (request: any) => request.action === "hostingControl",
      ),
    ),
  ).toHaveLength(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).hostingRequests.find(
          (request: any) => request.action === "hostingControl",
        ).payload.action,
    ),
  ).toBe("stop");
  await page.getByRole("button", { name: "Запустить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Остановить", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Дополнительные действия сервера",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Принудительно завершить", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("принудительно");
  await page.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Запустить", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Информация", exact: true }).click();
  await page.screenshot({
    path: ".test-data/hosting-single-network.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("network settings are compact and startup selection is generic", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await fixture(page, { network: true, theme: "light", language: "en" });
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("RAM (MB)", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Startup file", { exact: true })
    .fill("scripts/launch.cmd");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).hostingRequests.find(
            (request: any) => request.action === "hostingNetworkScript",
          )?.payload,
      ),
    )
    .toEqual({ id: "network", script: "scripts/launch.cmd" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

for (const theme of ["dark", "light"]) {
  test(`hosting dashboard follows the reference at normal window size in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await fixture(page, { network: true, verbatim: true, theme });
    await expect(page.locator(".hosting-server-title p")).toHaveText(
      "X:\\Servers\\Friends",
    );
    await expect(page.locator(".hosting-motd")).toHaveText("Friends Survival");
    const main = await page.locator(".hosting-summary").boundingBox();
    const aside = await page.locator(".hosting-aside").boundingBox();
    expect(aside!.x).toBeGreaterThanOrEqual(main!.x + main!.width);
    expect(Math.abs(aside!.y - main!.y)).toBeLessThan(5);
    await expect(page.locator(".hosting-list-heading")).toHaveCount(0);
    const buttonStyles = await page
      .locator(".hosting-list > .button")
      .evaluateAll((buttons) =>
        buttons.map((button) => {
          const style = getComputedStyle(button);
          return {
            font: style.font,
            height: button.getBoundingClientRect().height,
            width: button.getBoundingClientRect().width,
            padding: style.padding,
            align: style.justifyContent,
          };
        }),
      );
    expect(buttonStyles).toHaveLength(2);
    expect(buttonStyles[0]).toEqual(buttonStyles[1]);
    const metrics = page.locator(".hosting-metrics > div");
    const iconCenters: number[] = [];
    for (const metric of await metrics.all()) {
      const icon = await metric
        .locator(":scope > svg, :scope > .hosting-icon")
        .boundingBox();
      const label = await metric
        .locator(":scope > span:not(.hosting-icon) > small")
        .boundingBox();
      const value = await metric
        .locator(":scope > span:not(.hosting-icon) > b")
        .boundingBox();
      const text = await metric
        .locator(":scope > span:not(.hosting-icon)")
        .boundingBox();
      expect(icon!.x + icon!.width).toBeLessThan(text!.x);
      expect(label!.y + label!.height).toBeLessThanOrEqual(value!.y);
      iconCenters.push(icon!.y + icon!.height / 2);
    }
    expect(Math.max(...iconCenters) - Math.min(...iconCenters)).toBeLessThan(1);
    expect(
      await metrics
        .locator("small")
        .evaluateAll((labels) =>
          labels.every((label) => label.scrollWidth <= label.clientWidth),
        ),
    ).toBe(true);
    await expect(page.locator(".hosting-server-art .home-pattern")).toHaveCount(
      1,
    );
    await expect(page.locator(".hosting-server-art .landscape")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Редактировать сервер", exact: true })
      .click();
    await expect(
      page.getByLabel("Название сервера", { exact: true }),
    ).toBeFocused();
    await page
      .getByLabel("Название сервера", { exact: true })
      .fill("Friends network");
    await page
      .getByRole("button", { name: "Сохранить информацию", exact: true })
      .click();
    await expect(page.locator(".hosting-summary h2")).toHaveText(
      "Friends network",
    );
    await page
      .getByRole("button", {
        name: "Дополнительные действия сервера",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("menuitem", {
        name: "Принудительно завершить",
        exact: true,
      }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.screenshot({
      path: `.test-data/hosting-reference-${theme}.png`,
      fullPage: true,
      animations: "disabled",
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

for (const theme of ["dark", "light"]) {
  test(`summary pattern follows the real server status in ${theme}`, async ({
    page,
  }) => {
    await fixture(page, { theme });
    const summary = page.locator(".hosting-summary");
    const pattern = summary.locator(":scope > .home-pattern");
    await expect(summary).toHaveAttribute("data-status", "running");
    await expect(pattern).toBeVisible();
    await expect(pattern.locator("path").first()).toHaveCSS(
      "stroke",
      "rgb(65, 167, 117)",
    );
    await page.screenshot({
      path: `.test-data/hosting-status-running-${theme}.png`,
      animations: "disabled",
      fullPage: true,
    });
    await page.getByRole("button", { name: "Остановить", exact: true }).click();
    await expect(summary).toHaveAttribute("data-status", "stopped");
    await expect(pattern.locator("path").first()).toHaveCSS(
      "stroke",
      "rgb(179, 91, 90)",
    );
    await page.screenshot({
      path: `.test-data/hosting-status-stopped-${theme}.png`,
      animations: "disabled",
      fullPage: true,
    });
  });
}

test("network appearance colors save without changing the core metric or duplicating import", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fixture(page, { network: true });
  const list = page.locator(".hosting-list");
  expect((await list.boundingBox())!.width).toBeGreaterThanOrEqual(250);
  await expect(
    list.getByText("Paper · Velocity", { exact: true }),
  ).toBeVisible();
  const status = await list.locator(".hosting-status").boundingBox();
  const count = await list.locator(".hosting-list-state > small").boundingBox();
  expect(Math.abs(status!.y - count!.y)).toBeLessThan(4);
  await expect(
    page.getByRole("button", { name: "Импорт из папки", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".hosting-toolbar > button")).toHaveCount(2);
  const main = await page.locator(".hosting-summary").boundingBox();
  const aside = await page.locator(".hosting-aside").boundingBox();
  expect(aside!.x).toBeGreaterThanOrEqual(main!.x + main!.width);
  await expect(
    page
      .locator(".hosting-metrics")
      .getByRole("img", { name: "Paper", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".test-data/hosting-reference-wide.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Настройки", exact: true }).click();
  const paper = page
    .locator(".hosting-symbols")
    .getByRole("button", { name: "Paper", exact: true });
  await paper.click();
  const button = await paper.boundingBox();
  const mark = await paper.locator(".hosting-core-glyph").boundingBox();
  expect(
    Math.abs(button!.x + button!.width / 2 - mark!.x - mark!.width / 2),
  ).toBeLessThan(1);
  expect(
    Math.abs(button!.y + button!.height / 2 - mark!.y - mark!.height / 2),
  ).toBeLessThan(1);
  await expect(
    page.getByLabel("Цвет значка HEX", { exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Цвет значка HEX", { exact: true }).fill("#12ABCD");
  await page.getByLabel("Цвет фона HEX", { exact: true }).fill("#315B40");
  await expect(
    page.locator(".hosting-icon-editor > .hosting-icon .hosting-brand-mask"),
  ).toHaveCSS("background-color", "rgb(18, 171, 205)");
  await page.screenshot({
    path: ".test-data/hosting-icon-editor.png",
    animations: "disabled",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Сохранить настройки", exact: true })
    .click();
  await expect(page.locator(".hosting-server-title > .hosting-icon")).toHaveCSS(
    "color",
    "rgb(18, 171, 205)",
  );
  await expect(page.locator(".hosting-metrics .hosting-icon")).toHaveCSS(
    "color",
    await page
      .locator(".hosting-metrics > div > svg")
      .first()
      .evaluate((icon) => getComputedStyle(icon).color),
  );
  for (const name of ["Folia", "Spigot", "Purpur", "Лист"]) {
    await page
      .locator(".hosting-symbols")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByLabel("Цвет значка HEX", { exact: true }),
    ).toBeEnabled();
  }
  await page
    .locator(".hosting-symbols")
    .getByRole("button", { name: "Velocity", exact: true })
    .click();
  await expect(page.getByLabel("Цвет значка HEX", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.locator(".hosting-original-color")).toContainText(
    "Оригинальный цвет",
  );
  await expect(page.getByLabel("Цвет фона HEX", { exact: true })).toBeEnabled();
});

for (const playerCount of [0, 1]) {
  test(`player count ${playerCount} distinguishes an empty roster from unavailable names`, async ({
    page,
  }) => {
    await fixture(page, { players: [], playerCount });
    const aside = page.locator(".hosting-aside");
    await expect(aside.locator(".hosting-count")).toHaveText(
      String(playerCount),
    );
    const message = playerCount
      ? "Имена игроков пока недоступны"
      : "Нет игроков онлайн";
    await expect(aside).toContainText(message);
    await page.getByRole("tab", { name: "Игроки", exact: true }).click();
    await expect(
      page.locator(".hosting-players-layout .hosting-count"),
    ).toHaveText(String(playerCount));
    await expect(page.locator(".hosting-players-layout")).toContainText(
      message,
    );
    await expect(page.locator(".hosting-player-list > button")).toHaveCount(0);
  });
}

test("folder actions open a confined file browser without executing or modifying files", async ({
  page,
}) => {
  await fixture(page, { network: true });
  await page
    .getByRole("button", { name: "Открыть папку", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Файлы", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".hosting-file-list")).toContainText(
    "server.properties",
  );
  await page.getByRole("button", { name: "world", exact: true }).click();
  await expect(page.locator(".hosting-file-list")).toContainText("level.dat");
  await page
    .getByRole("button", { name: "На уровень выше", exact: true })
    .click();
  await expect(page.locator(".hosting-file-list")).toContainText(
    "server.properties",
  );
  await expect(
    page.getByRole("button", { name: "На уровень выше", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as any).hostingRequests.filter((request: any) =>
        ["hostingStart", "hostingControl", "hostingUpdate"].includes(
          request.action,
        ),
      ),
    ),
  ).toHaveLength(0);
});

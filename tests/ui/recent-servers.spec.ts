import { expect, test, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  options: {
    theme?: string;
    language?: string;
    running?: boolean;
    shortcut?: boolean;
  } = {},
) {
  await page.addInitScript((options) => {
    localStorage.setItem("aurum:language", options.language || "ru");
    const windowState = window as any;
    windowState.isTauri = true;
    const profile = {
      id: "95698e6a-9ac5-4418-b773-4346121b0220",
      name: "Radiance",
      minecraft: "1.21.11",
      loader: "fabric",
      loaderVersion: "0.19.5",
      installedVersion: "1.21.11",
      ramMb: 6144,
      jvmArgs: "",
      lastPlayed: 1,
      cover: 1,
      content: [],
    };
    const state = {
      profiles: [profile],
      accounts: [
        {
          id: "account",
          uuid: "fixture",
          name: "Player",
          kind: "offline",
          skinModel: "steve",
          hasSkin: false,
        },
      ],
      selectedAccount: "account",
      running: options.running ? [profile.id] : [],
      dataDir: "D:/test",
      curseforgeConfigured: false,
      serverManager: true,
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
    let servers = Array.from({ length: 7 }, (_, index) => ({
      id: `server-${index}`,
      address:
        index === 0 ? "play.example.org:25566" : `server-${index}.example.org`,
      name: [
        "TechnoSurvival",
        "PrisonEvo",
        "Fluff",
        "Monato",
        "Another server",
        "Sixth server",
        "Expired server",
      ][index],
      profileId: profile.id,
      lastPlayed:
        Math.floor(Date.now() / 1000) -
        (index === 6 ? 8 * 86400 : (index + 1) * 3600),
      icon: null,
    }));
    const callbacks = new Map<number, Function>();
    let callbackId = 1;
    let shortcut = options.shortcut
      ? { profileId: profile.id, address: "shortcut.example.org:25566" }
      : null;
    windowState.serverRequests = [];
    windowState.serverState = state;
    windowState.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    windowState.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback(callback: Function) {
        const id = callbackId++;
        callbacks.set(id, callback);
        return id;
      },
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") {
          if (args.event === "auren:event")
            windowState.serverEventCallback = callbacks.get(args.handler);
          return 1;
        }
        if (command !== "rpc")
          return command.includes("is_maximized") ? false : 1;
        const { action, payload } = args;
        windowState.serverRequests.push({ action, payload });
        if (action === "snapshot") return structuredClone(state);
        if (action === "recentServers") return structuredClone(servers);
        if (action === "takeServerShortcut") {
          const request = shortcut;
          shortcut = null;
          return request;
        }
        if (action === "serverStatus")
          return {
            online: payload.id !== "server-2",
            players: payload.id === "server-0" ? 0 : 12,
            maxPlayers: 100,
            latencyMs: 22,
            checkedAt: Math.floor(Date.now() / 1000),
            icon: null,
          };
        if (action === "removeRecentServer") {
          servers = servers.filter((server) => server.id !== payload.id);
          return null;
        }
        if (action === "createServerShortcut") return "Desktop/server.lnk";
        if (action === "launch") {
          state.running = [payload.id];
          return null;
        }
        if (action === "stop") {
          state.running = [];
          return null;
        }
        if (action === "search") return { total: 0, projects: [] };
        if (action === "content") return [];
        if (action === "inspectContent")
          return { content: [], updates: [], warnings: [] };
        if (action === "saveSettings") {
          state.settings = payload.settings;
          return null;
        }
        if (action === "accountAvatar")
          throw new Error("No texture in fixture");
        throw new Error(`Unexpected action: ${action}`);
      },
    };
    windowState.deliverServerShortcut = () => {
      shortcut = { profileId: profile.id, address: "reused.example.org" };
      windowState.serverEventCallback({
        event: "auren:event",
        payload: {
          id: "shortcut",
          phase: "server-shortcut",
          message: "",
          done: 0,
          total: 0,
          profileId: null,
        },
      });
    };
  }, options);
  await page.goto("/");
  await expect(page.locator(".recent-servers .recent-server-row")).toHaveCount(
    5,
  );
}

test("weekly list is limited to five and status, refresh, copy, shortcut and removal work", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await fixture(page);
  const list = page.locator(".recent-servers");
  const server = list.getByRole("article", {
    name: "TechnoSurvival",
    exact: true,
  });
  await expect(server).toContainText("Radiance");
  await expect(server.locator(".recent-server-status")).toContainText("0/100");
  await expect(list).not.toContainText("Expired server");
  await expect(list).not.toContainText("Sixth server");
  await server
    .getByRole("button", { name: "Действия сервера TechnoSurvival" })
    .click();
  await expect(page.getByRole("menuitem")).toHaveCount(6);
  await page.getByRole("menuitem", { name: "Обновить", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).serverRequests.filter(
            (request: any) =>
              request.action === "serverStatus" && request.payload.force,
          ).length,
      ),
    )
    .toBe(1);
  await server
    .getByRole("button", { name: "Действия сервера TechnoSurvival" })
    .click();
  await page.getByRole("menuitem", { name: "Копировать адрес" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "play.example.org:25566",
  );
  await server
    .getByRole("button", { name: "Действия сервера TechnoSurvival" })
    .click();
  await page.getByRole("menuitem", { name: "Создать ярлык" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).serverRequests.some(
          (request: any) =>
            request.action === "createServerShortcut" &&
            request.payload.id === "server-0",
        ),
      ),
    )
    .toBe(true);
  await server
    .getByRole("button", { name: "Действия сервера TechnoSurvival" })
    .click();
  await page.getByRole("menuitem", { name: "Убрать из списка" }).click();
  await expect(server).toHaveCount(0);
  await expect(list).toContainText("Sixth server");
});

test("play joins the selected server while the menu can launch the instance without a server", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("button", { name: "Играть на сервере TechnoSurvival" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).serverRequests
          .filter((request: any) => request.action === "launch")
          .map((request: any) => request.payload),
      ),
    )
    .toEqual([
      {
        id: "95698e6a-9ac5-4418-b773-4346121b0220",
        server: "play.example.org:25566",
      },
    ]);
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await page
    .getByRole("button", { name: "Действия сервера TechnoSurvival" })
    .click();
  await page
    .getByRole("menuitem", { name: "Запустить сборку", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).serverRequests
            .filter((request: any) => request.action === "launch")
            .at(-1).payload,
      ),
    )
    .toEqual({ id: "95698e6a-9ac5-4418-b773-4346121b0220" });
});

test("server menu supports keyboard dismissal, viewing its instance and all weekly entries", async ({
  page,
}) => {
  await fixture(page);
  const trigger = page.getByRole("button", {
    name: "Действия сервера TechnoSurvival",
  });
  await trigger.click();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("menuitem", { name: "Создать ярлык" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "Все серверы", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Серверы за последнюю неделю",
  });
  await expect(dialog.locator(".recent-server-row")).toHaveCount(6);
  await dialog
    .getByRole("button", { name: "Действия сервера Sixth server" })
    .click();
  await page.getByRole("menuitem", { name: "Посмотреть сборку" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".instance-page")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`compact server list and menu fit minimum size in ${theme} theme`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 680 });
    await fixture(page, { theme, language: "en", running: true });
    await expect(
      page.getByRole("button", { name: "Play on TechnoSurvival" }),
    ).toBeDisabled();
    await expect(page.locator(".recent-servers")).toContainText(
      "Recent servers",
    );
    await page
      .getByRole("button", { name: "Actions for TechnoSurvival" })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "Launch instance", exact: true }),
    ).toBeDisabled();
    const bounds = await page.getByRole("menu").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(960);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
    expect(
      await page
        .locator(".content-scroll")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await page.screenshot({
      path: `.test-data/screenshots/recent-servers-${theme}.png`,
      animations: "disabled",
    });
  });
}

test("startup and existing-window shortcuts dispatch one launch each", async ({
  page,
}) => {
  await fixture(page, { shortcut: true });
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).serverRequests
          .filter((request: any) => request.action === "launch")
          .map((request: any) => request.payload.server),
      ),
    )
    .toEqual(["shortcut.example.org:25566"]);
  await page.getByRole("button", { name: "Остановить", exact: true }).click();
  await page.evaluate(() => (window as any).deliverServerShortcut());
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).serverRequests
          .filter((request: any) => request.action === "launch")
          .map((request: any) => request.payload.server),
      ),
    )
    .toEqual(["shortcut.example.org:25566", "reused.example.org"]);
});

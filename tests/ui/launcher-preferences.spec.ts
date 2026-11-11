import { expect, test, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  options: { theme?: string; language?: string } = {},
) {
  await page.addInitScript((options) => {
    const w = window as any;
    localStorage.setItem("aurum:language", options.language || "ru");
    w.isTauri = true;
    w.windowCalls = [];
    w.preferenceRequests = [];
    w.readySounds = 0;
    w.notificationSounds = 0;
    const AudioBase = window.AudioContext;
    w.AudioContext = class extends AudioBase {
      decodeAudioData(bytes: ArrayBuffer) {
        return super.decodeAudioData(bytes).then((buffer) => {
          w.readyDecoded = true;
          return buffer;
        });
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args: Parameters<typeof start>) => {
          w.readySounds++;
          start(...args);
        };
        return source;
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (...args: Parameters<typeof start>) => {
          w.notificationSounds++;
          start(...args);
        };
        return oscillator;
      }
    };
    const state = {
      profiles: [],
      accounts: [],
      selectedAccount: null,
      running: [] as string[],
      dataDir: "D:/launcher-preferences-fixture",
      curseforgeConfigured: false,
      settings: JSON.parse(
        localStorage.getItem("test:launcher-settings") || "null",
      ) || {
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
    const callbacks = new Map<number, Function>();
    const listeners = new Map<number, { event: string; handler: number }>();
    let next = 0;
    w.emitNative = (event: string, payload: unknown) => {
      for (const [id, listener] of listeners)
        if (listener.event === event)
          callbacks.get(listener.handler)?.({ event, id, payload });
    };
    w.emitGame = (phase: string, id = "jvm-one", profileId = "game-one") =>
      w.emitNative("aurum:event", {
        phase,
        id,
        profileId,
        message: "Fixture game event",
        done: 0,
        total: 0,
      });
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener(_event: string, id: number) {
        listeners.delete(id);
      },
    };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback(callback: Function) {
        callbacks.set(++next, callback);
        return next;
      },
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") {
          const id = ++next;
          listeners.set(id, { event: args.event, handler: args.handler });
          return id;
        }
        if (command === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return null;
        }
        if (command !== "rpc") {
          w.windowCalls.push(command);
          return command.includes("is_maximized") ||
            command.includes("is_fullscreen")
            ? false
            : null;
        }
        const { action, payload } = args;
        w.preferenceRequests.push({ action, payload });
        if (action === "snapshot") return structuredClone(state);
        if (action === "saveSettings") {
          if (w.failPreferenceSave) throw new Error("Settings write failed");
          state.settings = structuredClone(payload.settings);
          localStorage.setItem(
            "test:launcher-settings",
            JSON.stringify(state.settings),
          );
          return null;
        }
        if (action === "search") return { projects: [], total: 0 };
        if (action === "confirmLauncherClose") return null;
        if (action === "takeServerShortcut" || action === "social.takeLink")
          return null;
        if (action === "social.snapshot")
          return {
            enabled: false,
            privacy: { notifications: true },
            people: [],
            invitations: [],
            online: [],
            activity: {},
            activeTunnels: 0,
          };
        throw new Error(`Unexpected fixture action: ${action}`);
      },
    };
  }, options);
  await page.goto("/");
  await page
    .getByRole("heading", {
      name: options.language === "en" ? "Home" : "Главная",
      exact: true,
    })
    .waitFor();
}

async function settings(page: Page, language = "ru") {
  await page
    .getByRole("button", {
      name: language === "en" ? "Settings" : "Настройки",
      exact: true,
    })
    .click();
  await page.locator(".launcher-preferences").scrollIntoViewIfNeeded();
}

for (const theme of ["light", "dark"]) {
  test(`compact switches have the requested defaults, animate and persist in ${theme}`, async ({
    page,
  }) => {
    await fixture(page, { theme });
    await settings(page);
    const block = page.locator(".launcher-preferences");
    await expect(block.getByRole("switch")).toHaveCount(7);
    await expect(block.getByRole("switch", { checked: true })).toHaveCount(2);
    const storage = (await page
      .getByRole("button", { name: /^Хранилище/ })
      .boundingBox())!;
    const box = (await block.boundingBox())!;
    const memory = (await page
      .getByRole("heading", { name: "Память и запуск", exact: true })
      .boundingBox())!;
    expect(box.y).toBeGreaterThan(storage.y + storage.height);
    expect(memory.y).toBeGreaterThan(box.y + box.height);
    expect(box.height).toBeLessThanOrEqual(240);
    await block.screenshot({
      path: `.test-data/screenshots/launcher-preferences-${theme}.png`,
    });
    const minimize = block.getByRole("switch", {
      name: "Сворачивать при запуске игры",
      exact: true,
    });
    await minimize.check();
    await expect(minimize).toBeEnabled();
    await expect(minimize.locator("+ span")).toHaveCSS(
      "transition-duration",
      "0.2s, 0.2s",
    );
    await page
      .getByRole("button", { name: "Сохранить настройки", exact: true })
      .click();
    await page.reload();
    await settings(page);
    await expect(
      page.getByRole("switch", {
        name: "Сворачивать при запуске игры",
        exact: true,
      }),
    ).toBeChecked();
    await page.evaluate(() => {
      (window as any).failPreferenceSave = true;
    });
    const remember = page.getByRole("switch", {
      name: "Запоминать последнюю страницу",
      exact: true,
    });
    await remember.click();
    await expect(remember).toBeEnabled();
    await expect(remember).not.toBeChecked();
    await page.setViewportSize({ width: 960, height: 680 });
    await expect(block).toHaveJSProperty(
      "scrollWidth",
      await block.evaluate((el) => el.clientWidth),
    );
  });
}

test("window actions, separate sounds, close confirmation and remembered routes use saved preferences", async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).readyDecoded))
    .toBe(true);
  await page.evaluate(() => (window as any).emitGame("game-ready"));
  await expect
    .poll(() => page.evaluate(() => (window as any).readySounds))
    .toBe(1);
  await settings(page);
  await page
    .getByRole("switch", { name: "Звук готовности игры", exact: true })
    .uncheck();
  await expect(
    page.getByRole("switch", { name: "Звук готовности игры", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    (window as any).emitGame("game-ready", "muted-session"),
  );
  expect(await page.evaluate(() => (window as any).readySounds)).toBe(1);
  for (const name of [
    "Сворачивать при запуске игры",
    "Возвращать после выхода из игры",
    "Спрашивать перед закрытием",
    "Запоминать последнюю страницу",
  ]) {
    const control = page.getByRole("switch", { name, exact: true });
    await control.check();
    await expect(control).toBeEnabled();
  }
  await page.evaluate(() => (window as any).emitGame("running"));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).windowCalls.filter((command: string) =>
            command.endsWith("|minimize"),
          ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(() => (window as any).emitGame("exited"));
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).windowCalls.filter((command: string) =>
            command.endsWith("|unminimize"),
          ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(() =>
    (window as any).emitNative("aurum:close-requested", null),
  );
  const confirmation = page.getByRole("dialog", {
    name: "Закрыть Aurum?",
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Отмена", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      (window as any).preferenceRequests.some(
        (request: any) => request.action === "confirmLauncherClose",
      ),
    ),
  ).toBe(false);
  await page.evaluate(() =>
    (window as any).emitNative("aurum:close-requested", null),
  );
  await page
    .getByRole("button", { name: "Закрыть лаунчер", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  const saves = () =>
    page.getByRole("button", { name: "Сохранить настройки", exact: true });
  await saves().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Настройки сохранены" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).notificationSounds),
  ).toBeGreaterThan(0);
  const notifications = page.getByRole("switch", {
    name: "Звук уведомлений лаунчера",
    exact: true,
  });
  await notifications.uncheck();
  await expect(notifications).toBeEnabled();
  const played = await page.evaluate(() => (window as any).notificationSounds);
  await saves().click();
  await expect(
    page.getByRole("status").filter({ hasText: "Настройки сохранены" }),
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).notificationSounds)).toBe(
    played,
  );
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Мои сборки", exact: true }),
  ).toBeVisible();
  await settings(page);
  const remember = page.getByRole("switch", {
    name: "Запоминать последнюю страницу",
    exact: true,
  });
  await remember.uncheck();
  await expect(remember).toBeEnabled();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Главная", exact: true }),
  ).toBeVisible();
});

test("disabling animations applies to new screens and can be reversed with keyboard", async ({
  page,
}) => {
  await fixture(page, { language: "en" });
  await settings(page, "en");
  const control = page.getByRole("switch", {
    name: "Disable all animations",
    exact: true,
  });
  await control.focus();
  await page.keyboard.press("Space");
  await expect(control).toBeEnabled();
  await expect(page.locator("html")).toHaveAttribute("data-animations", "off");
  await expect(control.locator("+ span")).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-animations", "off");
  await settings(page, "en");
  await page
    .getByRole("switch", { name: "Disable all animations", exact: true })
    .uncheck();
  await expect(page.locator("html")).toHaveAttribute("data-animations", "on");
});

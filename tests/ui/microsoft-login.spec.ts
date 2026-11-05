import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, mode: "waiting" | "error" = "waiting", theme = "light") {
  await page.addInitScript(({ mode, theme }) => {
    localStorage.setItem("aurum:language", "ru");
    const w = window as any;
    w.isTauri = true;
    const state = {
      profiles: [], accounts: [] as any[], selectedAccount: null as string | null,
      settings: { language: "ru", theme, javaPath: "", ramMb: 4096, jvmArgs: "", resolutionWidth: 1280, resolutionHeight: 720, showSnapshots: false },
      dataDir: "D:/Aurum-test", running: [], curseforgeConfigured: false,
    };
    const callbacks = new Map<number, Function>();
    let next = 0;
    let eventHandler: number | undefined;
    let resolveLogin: Function | undefined;
    let rejectLogin: Function | undefined;
    let operationId = "";
    w.requests = [];
    w.loginMode = mode;
    w.reopenFails = false;
    w.authPhase = (phase: string) => callbacks.get(eventHandler!)?.({ event: "auren:event", id: 1, payload: { id: operationId, profileId: null, phase, message: "", done: 0, total: 0 } });
    w.finishLogin = () => {
      const account = { id: "test-player", uuid: "test-player", name: "CozyPlayer", kind: "microsoft", skinModel: "steve", hasSkin: false };
      state.accounts = [account]; state.selectedAccount = account.id;
      resolveLogin?.(account);
    };
    w.denyLogin = () => rejectLogin?.("Вход отменён в Microsoft");
    w.failLogin = (message: string) => rejectLogin?.(message);
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback(fn: Function) { callbacks.set(++next, fn); return next; },
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") { if (args.event === "auren:event") eventHandler = args.handler; return 1; }
        if (command !== "rpc") return command.includes("is_maximized") ? false : 1;
        const { action, payload } = args; w.requests.push({ action, payload });
        if (action === "snapshot") return state;
        if (action === "search") return { projects: [], total: 0 };
        if (action === "skin") return [];
        if (action === "saveSettings") { state.settings = payload.settings; return null; }
        if (action === "loginMicrosoft") {
          operationId = payload.operationId;
          if (w.loginMode === "error") throw "В этой сборке Aurum вход Microsoft ещё не подключён. Используйте сборку с поддержкой Microsoft-входа.";
          const result = new Promise((resolve, reject) => { resolveLogin = resolve; rejectLogin = reject; });
          queueMicrotask(() => w.authPhase("auth-waiting"));
          return result;
        }
        if (action === "reopenMicrosoft") { if (w.reopenFails) throw "Не удалось показать окно Microsoft"; return null; }
        if (action === "cancel") { rejectLogin?.("Операция отменена"); return null; }
        throw `Unexpected action: ${action}`;
      },
    };
  }, { mode, theme });
  await page.goto("/");
  await page.getByRole("button", { name: "Профили", exact: true }).click();
  await expect(page.getByRole("button", { name: "Войти с Microsoft", exact: true })).toBeVisible();
}

async function start(page: Page) {
  await page.getByRole("button", { name: "Войти с Microsoft", exact: true }).click();
  return page.getByRole("dialog", { name: "Вход с Microsoft", exact: true });
}

test("one click starts sign-in, can reopen, finishes automatically and selects the account", async ({ page }) => {
  await fixture(page);
  const dialog = await start(page);
  await expect(dialog.getByText("Ждём подтверждения в окне Microsoft")).toBeVisible();
  await expect(dialog.locator("input, code")).toHaveCount(0);
  await expect(page.locator(".operation-panel")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Вернуться к окну Microsoft" }).click();
  const requests = await page.evaluate(() => (window as any).requests);
  expect(requests.filter((r: any) => r.action === "loginMicrosoft")).toHaveLength(1);
  expect(Object.keys(requests.find((r: any) => r.action === "loginMicrosoft").payload)).toEqual(["operationId"]);
  expect(requests.filter((r: any) => r.action === "reopenMicrosoft")).toHaveLength(1);
  await page.evaluate(() => (window as any).authPhase("auth-profile"));
  await expect(dialog.getByText("Завершаем вход")).toBeVisible();
  await page.evaluate(() => (window as any).finishLogin());
  const success = page.getByRole("dialog", { name: "Вы в игре", exact: true });
  await expect(success.getByText("Привет, CozyPlayer!")).toBeVisible();
  await success.getByRole("button", { name: "К моим сборкам" }).click();
  await expect(success).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Мои сборки", exact: true })).toBeVisible();
});

test("cancel and Microsoft denial leave no account, retry starts a fresh operation", async ({ page }) => {
  await fixture(page);
  const dialog = await start(page);
  await dialog.getByRole("button", { name: "Отменить вход", exact: true }).click();
  const cancelled = page.getByRole("dialog", { name: "Вход отменён", exact: true });
  await expect(cancelled.getByText("Аккаунт не был добавлен.")).toBeVisible();
  await cancelled.getByRole("button", { name: "Попробовать снова" }).click();
  await expect(page.getByRole("dialog", { name: "Вход с Microsoft" })).toBeVisible();
  await page.evaluate(() => (window as any).denyLogin());
  await expect(cancelled).toBeVisible();
  const ids = await page.evaluate(() => (window as any).requests.filter((r: any) => r.action === "loginMicrosoft").map((r: any) => r.payload.operationId));
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  await cancelled.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(page.getByText("Нет аккаунтов")).toBeVisible();
});

test("sign-in window failure is actionable and Escape cancels the active request", async ({ page }) => {
  await fixture(page);
  const dialog = await start(page);
  await page.evaluate(() => { (window as any).reopenFails = true; });
  await dialog.getByRole("button", { name: "Вернуться к окну Microsoft" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Не удалось показать окно Microsoft");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Вход отменён" })).toBeVisible();
});

test("build configuration errors stay in the dialog without asking the player for a Client ID", async ({ page }) => {
  await fixture(page, "error");
  await start(page);
  const error = page.getByRole("dialog", { name: "Не удалось войти" });
  await expect(error.getByRole("alert")).toContainText("вход Microsoft ещё не подключён");
  await expect(error.locator("input")).toHaveCount(0);
  await error.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.getByRole("button", { name: "Настройки", exact: true }).click();
  await expect(page.getByText("Microsoft OAuth Client ID")).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  test(`Minecraft server diagnostics remain visible in the ${theme} sign-in dialog`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 });
    await fixture(page, "waiting", theme);
    await start(page);
    // Fixture only: this is not evidence of Aurum's real server response.
    const message = "Minecraft Services: HTTP 403 Forbidden. error: ForbiddenOperationException; errorMessage: Invalid app registration, see https://aka.ms/AppRegInfo; path: /authentication/login_with_xbox; requestId: fixture-request-123";
    await page.evaluate((message) => (window as any).failLogin(message), message);
    const dialog = page.getByRole("dialog", { name: "Не удалось войти", exact: true });
    await expect(dialog.getByRole("alert")).toContainText(message);
    await expect(dialog.getByRole("button", { name: "Попробовать снова" })).toBeVisible();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(960);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `.test-data/screenshots/microsoft-server-error-${theme}.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Попробовать снова" }).click();
    await expect(page.getByRole("dialog", { name: "Вход с Microsoft", exact: true })).toBeVisible();
  });

  test(`sign-in layout in ${theme} theme fits the minimum desktop size`, async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 680 });
    await fixture(page, "waiting", theme);
    await page.screenshot({ path: `.test-data/screenshots/microsoft-accounts-${theme}.png`, animations: "disabled" });
    const dialog = await start(page);
    await expect(dialog.getByText("Ждём подтверждения в окне Microsoft")).toBeVisible();
    await expect(dialog.locator(".terrain-pattern path")).toHaveCount(12);
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(960);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(680);
    expect(await dialog.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
    await page.screenshot({ path: `.test-data/screenshots/microsoft-login-${theme}.png`, animations: "disabled" });
    await page.evaluate(() => (window as any).finishLogin());
    await expect(page.getByRole("dialog", { name: "Вы в игре" })).toBeVisible();
    await page.screenshot({ path: `.test-data/screenshots/microsoft-success-${theme}.png`, animations: "disabled" });
  });
}

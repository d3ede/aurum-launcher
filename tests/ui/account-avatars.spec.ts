import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, failed = false) {
  await page.addInitScript(
    ({ failed }) => {
      localStorage.setItem("aurum:language", "ru");
      const browser = window as any;
      browser.isTauri = true;
      browser.avatarRequests = [];
      const skin = document.createElement("canvas");
      skin.width = skin.height = 64;
      const context = skin.getContext("2d")!;
      context.fillStyle = "#d02030";
      context.fillRect(8, 8, 8, 8);
      context.fillStyle = "#2070e0";
      context.fillRect(40, 8, 4, 4);
      let texture = skin.toDataURL();
      const state = {
        profiles: [],
        accounts: [
          {
            id: "microsoft-test",
            uuid: "microsoft-test",
            name: "Player",
            kind: "microsoft",
            skinModel: "steve",
            hasSkin: false,
          },
          {
            id: "offline-test",
            uuid: "offline-test",
            name: "Local",
            kind: "offline",
            skinModel: "alex",
            hasSkin: false,
          },
        ],
        selectedAccount: "microsoft-test",
        running: [],
        dataDir: "D:/Aurum-test",
        curseforgeConfigured: false,
        settings: {
          language: "ru",
          theme: "light",
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
      };
      browser.changeAvatar = () => {
        context.fillStyle = "#20c060";
        context.fillRect(8, 8, 8, 8);
        texture = skin.toDataURL();
      };
      browser.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      browser.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback() {
          return 1;
        },
        async invoke(command: string, args: any) {
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          if (action === "snapshot") return structuredClone(state);
          if (action === "search") return { projects: [], total: 0 };
          if (action === "accountAvatar") {
            browser.avatarRequests.push(payload.id);
            if (failed) throw new Error("offline");
            return texture;
          }
          if (action === "selectAccount") {
            state.selectedAccount = payload.id;
            return null;
          }
          if (action === "saveSettings") {
            state.settings = payload.settings;
            return null;
          }
          throw new Error(`Unexpected action ${action}`);
        },
      };
    },
    { failed },
  );
  await page.goto("/");
  await expect(
    page.locator(".mini-avatar canvas[data-head-ready=true]"),
  ).toHaveCount(1);
}

async function pixel(page: Page, selector: string, left: number, top: number) {
  return page
    .locator(selector)
    .evaluate(
      (element, point) =>
        Array.from(
          (element as HTMLCanvasElement)
            .getContext("2d")!
            .getImageData(
              Math.floor(
                ((point.left + 0.5) * (element as HTMLCanvasElement).width) / 8,
              ),
              Math.floor(
                ((point.top + 0.5) * (element as HTMLCanvasElement).height) / 8,
              ),
              1,
              1,
            ).data,
        ),
      { left, top },
    );
}

test("skin heads share requests, compose the hat layer and refresh across account changes", async ({
  page,
}) => {
  await fixture(page);
  await expect
    .poll(() => pixel(page, ".mini-avatar canvas", 1, 1))
    .toEqual([32, 112, 224, 255]);
  expect(await pixel(page, ".mini-avatar canvas", 6, 6)).toEqual([
    208, 32, 48, 255,
  ]);
  expect(await page.evaluate(() => (window as any).avatarRequests)).toEqual([
    "microsoft-test",
  ]);
  await expect(
    page.locator(".home-account-avatar canvas[data-head-ready=true]"),
  ).toHaveCount(1);
  expect(await pixel(page, ".home-account-avatar canvas", 1, 1)).toEqual([
    32, 112, 224, 255,
  ]);
  await page
    .getByRole("button", { name: "Аккаунты и скины", exact: true })
    .click();
  await expect(
    page.locator(".account-avatar canvas[data-head-ready=true]"),
  ).toHaveCount(2);
  expect(
    await pixel(page, '.account-card:has-text("Player") canvas', 6, 6),
  ).toEqual([208, 32, 48, 255]);
  await page.screenshot({
    path: ".test-data/screenshots/account-heads-light.png",
  });
  await page.evaluate(() => (window as any).changeAvatar());
  await page
    .getByRole("button", { name: "Переключить тему", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect
    .poll(() => pixel(page, ".mini-avatar canvas", 6, 6))
    .toEqual([32, 192, 96, 255]);
  await page.screenshot({
    path: ".test-data/screenshots/account-heads-dark.png",
  });
  await page.locator('.account-card:has-text("Local")').click();
  await page.getByRole("button", { name: "Использовать для игры" }).click();
  await expect(page.locator(".user-button")).toContainText("Local");
  await expect(
    page.locator(".mini-avatar canvas[data-head-ready=true]"),
  ).toHaveCount(1);
  expect(await pixel(page, ".mini-avatar canvas", 6, 6)).not.toEqual([
    32, 192, 96, 255,
  ]);
});

test("unavailable Microsoft textures retain a visible default head", async ({
  page,
}) => {
  await fixture(page, true);
  await expect(page.locator(".mini-avatar svg")).toHaveCount(0);
  expect((await pixel(page, ".mini-avatar canvas", 3, 3))[3]).toBe(255);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

for (const scale of [1, 1.25, 1.5, 1.75, 2]) {
  test(`heads keep uniform pixels and compact frames at display scale ${scale}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 820 },
      deviceScaleFactor: scale,
    });
    try {
      const page = await context.newPage();
      await fixture(page);
      await expect
        .poll(() => pixel(page, ".mini-avatar canvas", 1, 1))
        .toEqual([32, 112, 224, 255]);
      const sizes = await page
        .locator(".account-skin-head canvas")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const canvas = element as HTMLCanvasElement;
            const pixels = canvas
              .getContext("2d")!
              .getImageData(0, 0, canvas.width, canvas.height).data;
            const colors = new Set<string>();
            for (let offset = 0; offset < pixels.length; offset += 4) {
              colors.add(
                Array.from(pixels.slice(offset, offset + 4)).join(","),
              );
            }
            return {
              width: canvas.getBoundingClientRect().width,
              height: canvas.getBoundingClientRect().height,
              backing: canvas.width,
              colors: Array.from(colors).sort(),
            };
          }),
        );
      expect(sizes).toHaveLength(2);
      for (const [index, size] of sizes.entries()) {
        const backing =
          index === 0 ? 32 * scale : 8 * Math.round((40 * scale) / 8);
        expect(size.width).toBeCloseTo(backing / scale, 1);
        expect(size.height).toBeCloseTo(backing / scale, 1);
        expect(size.backing).toBe(backing);
        expect(size.colors).toEqual(["208,32,48,255", "32,112,224,255"]);
      }
      await expect(page.locator(".mini-avatar")).toHaveCSS("width", "36px");
      await expect(page.locator(".home-account-avatar")).toHaveCSS(
        "width",
        "48px",
      );
      await expect(page.locator(".account-skin-head").first()).toHaveCSS(
        "border-top-width",
        "1px",
      );
      await page.screenshot({
        path: `.test-data/screenshots/account-heads-scale-${scale}.png`,
      });
      await page
        .getByRole("button", { name: "Переключить тему", exact: true })
        .click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.screenshot({
        path: `.test-data/screenshots/account-heads-scale-${scale}-dark.png`,
      });
    } finally {
      await context.close();
    }
  });
}

import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  failed = false,
  theme = "light",
  accountCount = 2,
) {
  await page.addInitScript(
    ({ failed, theme, accountCount }) => {
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
        ].slice(0, accountCount),
        selectedAccount: "microsoft-test",
        running: [],
        dataDir: "D:/Aurum-test",
        curseforgeConfigured: false,
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
          if (action === "skinLibrary")
            return { skins: [], capes: [], selections: {} };
          if (action === "accountAppearance" || action === "accountSkinPreview")
            return { texture, model: "steve", capes: [] };
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
    { failed, theme, accountCount },
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

for (const theme of ["light", "garnet"]) {
  test(`skin access stays in Accounts with a taller animated card in ${theme}`, async ({
    page,
  }) => {
    await fixture(page, false, theme, theme === "light" ? 1 : 2);
    const nav = page.getByRole("navigation");
    await expect(
      nav.getByRole("button", { name: "Скины и плащи", exact: true }),
    ).toHaveCount(0);
    await nav.getByRole("button", { name: "Профили", exact: true }).click();
    const card = page.getByRole("region", {
      name: "Скины и плащи",
      exact: true,
    });
    const open = card.getByRole("button", {
      name: "Открыть скины",
      exact: true,
    });
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card).toContainText("Загрузка PNG и библиотека");
    await expect(card).toContainText("Поиск по названию и нику");
    await expect(card).toContainText("Плащи и 3D-просмотр");
    await expect(
      page.getByText("Отдельная библиотека ваших образов"),
    ).toHaveCount(0);
    await expect(page.getByText("Ваш Minecraft начинается здесь")).toHaveCount(
      0,
    );
    for (const width of [1280, 960]) {
      await page.setViewportSize({ width, height: width === 960 ? 680 : 820 });
      await page.mouse.move(0, 0);
      const bounds = (await card.boundingBox())!;
      const hero = (await page
        .locator(".microsoft-account-card")
        .boundingBox())!;
      const accounts = (await page.locator(".account-list").boundingBox())!;
      expect(Math.abs(bounds.y - hero.y)).toBeLessThanOrEqual(1);
      expect(bounds.height).toBeGreaterThanOrEqual(294);
      expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(
        accounts.y + accounts.height - 1,
      );
      expect(
        await page
          .locator(".content-scroll")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      const pattern = open.locator(".wardrobe-button-pattern");
      await expect(pattern).toHaveCSS("opacity", "0");
      await card.getByRole("heading").hover();
      await expect(pattern).toHaveCSS("opacity", "0");
      await expect(card.locator(":scope > .terrain-pattern")).toHaveCount(0);
      await open.hover();
      await expect(pattern).toHaveCSS("opacity", "1");
      const trace = pattern.locator(".wardrobe-button-trace").first();
      await expect
        .poll(async () => {
          const offset = await trace.evaluate((el) =>
            parseFloat(getComputedStyle(el).strokeDashoffset),
          );
          return offset > 0 && offset < 1;
        })
        .toBe(true);
      if (width === 1280)
        await page.screenshot({
          path: `.test-data/screenshots/accounts-skin-button-drawing-${theme}.png`,
        });
      await expect
        .poll(() =>
          trace.evaluate((el) =>
            parseFloat(getComputedStyle(el).strokeDashoffset),
          ),
        )
        .toBe(0);
      const buttonBounds = (await open.boundingBox())!;
      const patternBounds = (await pattern.boundingBox())!;
      expect(
        Math.abs(patternBounds.width - buttonBounds.width),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(patternBounds.height - buttonBounds.height),
      ).toBeLessThanOrEqual(2);
      await page.screenshot({
        path: `.test-data/screenshots/accounts-skin-access-${theme}-${width}.png`,
      });
    }
    await open.click();
    await expect(
      page.getByRole("heading", { name: "Скины и плащи", exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("button", { name: "Профили", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      nav.getByRole("button", { name: "Скины и плащи", exact: true }),
    ).toHaveCount(0);
    await nav.getByRole("button", { name: "Профили", exact: true }).click();
    await expect(card).toBeVisible();
  });
}

test("skin access supports keyboard activation and reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Профили", exact: true })
    .click();
  const open = page.getByRole("button", { name: "Открыть скины", exact: true });
  await open.focus();
  expect(
    await open.locator(".wardrobe-button-pattern").evaluate((el) =>
      Math.max(
        ...getComputedStyle(el)
          .transitionDuration.split(",")
          .map((value) => parseFloat(value)),
      ),
    ),
  ).toBeLessThanOrEqual(0.001);
  await expect(open.locator(".wardrobe-button-glow").first()).toHaveCSS(
    "animation-name",
    "none",
  );
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Скины и плащи", exact: true }),
  ).toBeVisible();
});

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
  await page.getByRole("button", { name: "Профили", exact: true }).click();
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

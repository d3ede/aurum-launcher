import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("aurum:language", "ru");
    const w = window as any;
    w.isTauri = true;
    const profile = {
      id: "icon-test",
      name: "Мир значков",
      minecraft: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
      installedVersion: null,
      ramMb: null,
      jvmArgs: "",
      lastPlayed: null,
      cover: 2,
      icon: null,
      content: [],
    };
    const saved = localStorage.getItem("icon-editor-profile");
    const state = {
      profiles: saved ? [JSON.parse(saved)] : [profile],
      accounts: [],
      selectedAccount: null,
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
      dataDir: "D:/Aurum",
      running: [],
      curseforgeConfigured: false,
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
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
        if (action === "snapshot") return state;
        if (action === "content") return [];
        if (action === "saveSettings") {
          state.settings = payload.settings;
          return null;
        }
        if (action === "chooseProfileIcon") {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 128;
          const context = canvas.getContext("2d")!;
          context.fillStyle = "#F3CC69";
          context.fillRect(32, 32, 64, 64);
          return canvas.toDataURL("image/png");
        }
        if (action === "versions")
          return {
            latest: { release: "1.21.1" },
            versions: [{ id: "1.21.1", type: "release" }],
          };
        if (action === "updateProfile") {
          state.profiles = [payload.profile];
          localStorage.setItem(
            "icon-editor-profile",
            JSON.stringify(payload.profile),
          );
          return null;
        }
        if (action === "createProfile") {
          const created = { ...profile, ...payload, id: "new-icon-test" };
          state.profiles.push(created);
          w.createdIconProfile = created;
          return created;
        }
        return null;
      },
    };
  });
}

test("symbol and independent custom colors persist and render on cards", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть Мир значков", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Изменить значок сборки" }).click();
  const editor = page.locator(".icon-editor");
  await expect(editor.locator(".icon-symbols button")).toHaveCount(16);
  await editor.getByRole("button", { name: "Ракета", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Цвет символа HEX" })
    .fill("#ABCDEF");
  await editor.getByRole("textbox", { name: "Цвет фона HEX" }).fill("#123456");
  const preview = editor.locator(".profile-icon");
  await expect(preview).toHaveCSS("color", "rgb(171, 205, 239)");
  await expect(preview).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await expect(preview.locator("svg")).toHaveClass(/lucide-rocket/);
  await editor.screenshot({
    path: "target/branding-icons/icon-editor-light.png",
  });
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  const cardIcon = page
    .getByRole("button", { name: "Открыть Мир значков", exact: true })
    .first()
    .locator(".profile-icon");
  await expect(cardIcon).toHaveCSS("color", "rgb(171, 205, 239)");
  await expect(cardIcon).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await expect(cardIcon.locator("svg")).toHaveClass(/lucide-rocket/);
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(cardIcon).toHaveCSS("background-color", "rgb(18, 52, 86)");
  await page
    .getByRole("button", { name: "Открыть Мир значков", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Изменить значок сборки" }).click();
  await expect(preview.locator("svg")).toBeVisible();
  await expect(preview.locator("svg")).toHaveCSS("color", "rgb(171, 205, 239)");
  await editor.screenshot({
    path: "target/branding-icons/icon-editor-dark.png",
    animations: "disabled",
  });
  await editor.getByRole("button", { name: "Сбросить значок" }).click();
  await expect(preview.locator("svg")).toHaveClass(/lucide-mountain/);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  const style = await page.evaluate(
    () => JSON.parse(localStorage.getItem("icon-editor-profile")!).iconStyle,
  );
  expect(style).toBeNull();
});

test("new instance submits selected symbol and colors", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await page.getByRole("button", { name: "Новая сборка", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Кристалл", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Цвет символа #F3CC69", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Цвет фона #3E3256", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Создать сборку", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).createdIconProfile.iconStyle),
  ).toEqual({ symbol: "gem", color: "#F3CC69", background: "#3E3256" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

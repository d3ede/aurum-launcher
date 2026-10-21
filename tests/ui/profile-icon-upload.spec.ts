import { test, expect } from "@playwright/test";

// Keep the native fixture alongside the editor flows; this case exercises the
// uploaded image branch without opening a platform file dialog in the browser.
test("uploaded image keeps its pixels while the background is editable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("aurum:language", "ru");
    const w = window as any;
    w.isTauri = true;
    const profile = {
      id: "upload",
      name: "Image test",
      minecraft: "1.21.1",
      loader: "vanilla",
      loaderVersion: null,
      installedVersion: null,
      cover: 0,
      icon: null,
      content: [],
      ramMb: null,
      jvmArgs: "",
      lastPlayed: null,
    };
    const state = {
      profiles: [profile],
      accounts: [],
      selectedAccount: null,
      settings: {
        language: "ru",
        theme: "light",
        javaPath: "",
        ramMb: 4096,
        jvmArgs: "",
        resolutionWidth: 1280,
        resolutionHeight: 820,
        showSnapshots: false,
      },
      dataDir: "D:/test",
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
      async invoke(cmd: string, args: any) {
        if (cmd !== "rpc") return false;
        if (args.action === "snapshot") return state;
        if (args.action === "content") return [];
        if (args.action === "chooseProfileIcon") {
          const c = document.createElement("canvas");
          c.width = c.height = 128;
          c.getContext("2d")!.fillRect(32, 32, 64, 64);
          return c.toDataURL("image/png");
        }
        return null;
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть Image test", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Изменить значок сборки" }).click();
  const editor = page.locator(".icon-editor");
  await editor
    .getByRole("button", { name: "Свой значок", exact: true })
    .click();
  const image = editor.locator(".profile-icon img");
  await expect(image).toBeVisible();
  const source = await image.getAttribute("src");
  await expect(
    editor.getByRole("textbox", { name: "Цвет символа HEX" }),
  ).toBeDisabled();
  await editor.getByRole("textbox", { name: "Цвет фона HEX" }).fill("#FEDCBA");
  await expect(image).toHaveAttribute("src", source!);
  await expect(editor.locator(".profile-icon")).toHaveCSS(
    "background-color",
    "rgb(254, 220, 186)",
  );
  await editor.getByRole("button", { name: "Луна", exact: true }).click();
  await expect(image).toHaveCount(0);
  await expect(
    editor.getByRole("textbox", { name: "Цвет символа HEX" }),
  ).toBeEnabled();
  await expect(editor.locator(".profile-icon")).toHaveCSS(
    "background-color",
    "rgb(254, 220, 186)",
  );
});

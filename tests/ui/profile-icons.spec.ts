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
  const tiles = editor.locator(".icon-symbols button");
  await expect(tiles).toHaveCount(23);
  const randomizer = editor.getByRole("button", {
    name: "Случайный значок",
    exact: true,
  });
  await expect(tiles.last()).toHaveAccessibleName("Случайный значок");
  await expect(editor.locator(".icon-editor-actions")).not.toContainText(
    "Случайный значок",
  );
  await expect(randomizer).toHaveText("");
  const geometry = await tiles.evaluateAll((buttons) =>
    buttons.map((button) => {
      const tile = button.getBoundingClientRect();
      const glyph = button.firstElementChild!.getBoundingClientRect();
      return {
        square: Math.abs(tile.width - tile.height),
        x: Math.abs(tile.x + tile.width / 2 - glyph.x - glyph.width / 2),
        y: Math.abs(tile.y + tile.height / 2 - glyph.y - glyph.height / 2),
      };
    }),
  );
  for (const tile of geometry) {
    expect(tile.square).toBeLessThan(1);
    expect(tile.x).toBeLessThan(1);
    expect(tile.y).toBeLessThan(1);
  }
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

test("new instances start randomized and dice save the visible variant", async ({
  page,
}) => {
  await fixture(page);
  await page.setViewportSize({ width: 960, height: 680 });
  await page.goto("/");
  await page.getByRole("button", { name: "Новая сборка", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const preview = dialog.locator(".icon-editor-preview .profile-icon");
  const appearance = () =>
    preview.evaluate((el) => ({
      color: (el as HTMLElement).style.color,
      background: (el as HTMLElement).style.backgroundColor,
      symbol: el.querySelector("svg")?.getAttribute("class"),
    }));
  await expect(preview).toBeVisible();
  const initial = await appearance();
  expect(initial.color).toBeTruthy();
  expect(initial.background).toBeTruthy();
  await dialog.getByRole("textbox", { name: "Название сборки" }).fill("Кубики");
  expect(await appearance()).toEqual(initial);
  await dialog
    .getByRole("button", { name: "Случайный значок", exact: true })
    .click();
  const rolled = await appearance();
  expect(rolled).not.toEqual(initial);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    expect(await appearance()).toEqual(rolled);
    await dialog
      .locator(".icon-editor")
      .screenshot({ path: `.test-data/screenshots/random-icon-${theme}.png` });
  }
  const color = await dialog
    .getByRole("textbox", { name: "Цвет символа HEX" })
    .inputValue();
  const background = await dialog
    .getByRole("textbox", { name: "Цвет фона HEX" })
    .inputValue();
  await dialog
    .getByRole("button", { name: "Создать сборку", exact: true })
    .click();
  expect(
    await page.evaluate(() => (window as any).createdIconProfile.iconStyle),
  ).toMatchObject({ color, background });
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await page.getByRole("button", { name: "Новая сборка", exact: true }).click();
  expect(await appearance()).not.toEqual(rolled);
});

test("dice replace an uploaded image and persist after reopening", async ({
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
  await editor
    .getByRole("button", { name: "Свой значок", exact: true })
    .click();
  await expect(editor.locator(".profile-icon img")).toBeVisible();
  const previousColor = await editor
    .getByRole("textbox", { name: "Цвет символа HEX" })
    .inputValue();
  const previousBackground = await editor
    .getByRole("textbox", { name: "Цвет фона HEX" })
    .inputValue();
  await editor
    .getByRole("button", { name: "Случайный значок", exact: true })
    .click();
  await expect(editor.locator(".profile-icon img")).toHaveCount(0);
  await expect(
    editor.getByRole("textbox", { name: "Цвет символа HEX" }),
  ).not.toHaveValue(previousColor);
  await expect(
    editor.getByRole("textbox", { name: "Цвет фона HEX" }),
  ).not.toHaveValue(previousBackground);
  const color = await editor
    .getByRole("textbox", { name: "Цвет символа HEX" })
    .inputValue();
  const background = await editor
    .getByRole("textbox", { name: "Цвет фона HEX" })
    .inputValue();
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  const profile = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("icon-editor-profile")!),
  );
  expect(profile.icon).toBeNull();
  expect(profile.iconStyle).toMatchObject({ color, background });
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  const cardIcon = page
    .getByRole("button", { name: "Открыть Мир значков", exact: true })
    .first()
    .locator(".profile-icon");
  await expect(cardIcon.locator("svg")).toBeVisible();
  expect(
    await cardIcon.evaluate((el) => (el as HTMLElement).style.backgroundColor),
  ).toBeTruthy();
});

test("loader symbols retain selected colors after saving and reopening", async ({
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
  for (const name of [
    "Vanilla",
    "Fabric",
    "Forge",
    "NeoForge",
    "Quilt",
    "Horizon",
  ]) {
    await editor.getByRole("button", { name, exact: true }).click();
    await editor
      .getByRole("textbox", { name: "Цвет символа HEX" })
      .fill("#ABCDEF");
    await editor
      .getByRole("textbox", { name: "Цвет фона HEX" })
      .fill("#123456");
    await expect(editor.locator(".profile-icon .loader-glyph")).toHaveCSS(
      "color",
      "rgb(171, 205, 239)",
    );
    await expect(editor.locator(".profile-icon")).toHaveCSS(
      "background-color",
      "rgb(18, 52, 86)",
    );
  }
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  const icon = page
    .getByRole("button", { name: "Открыть Мир значков", exact: true })
    .first()
    .locator(".profile-icon");
  await expect(icon.locator(".loader-glyph")).toHaveCSS(
    "color",
    "rgb(171, 205, 239)",
  );
  await expect(icon).toHaveCSS("background-color", "rgb(18, 52, 86)");
});

test("Fabric texture keeps opaque highlights and shadows on either background", async ({
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
  await editor.getByRole("button", { name: "Fabric", exact: true }).click();
  await editor
    .getByRole("textbox", { name: "Цвет символа HEX" })
    .fill("#7394BD");
  const texture = editor.locator(".profile-icon svg.loader-texture");
  let previous: number[][] | undefined;
  for (const background of ["#FFFFFF", "#000000"]) {
    await editor
      .getByRole("textbox", { name: "Цвет фона HEX" })
      .fill(background);
    const samples = await texture.evaluate(async (element) => {
      const clone = element.cloneNode(true) as SVGSVGElement;
      const sourcePaths = element.querySelectorAll("path");
      clone.querySelectorAll("path").forEach((path, index) => {
        path.setAttribute("fill", getComputedStyle(sourcePaths[index]).fill);
      });
      clone.setAttribute("width", "150");
      clone.setAttribute("height", "160");
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml",
        }),
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 150;
        canvas.height = 160;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        // Cloth surface, dark fold, lower rim and the highlighted rolled edge.
        return [
          [55, 85],
          [85, 45],
          [55, 125],
          [95, 35],
        ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
      } finally {
        URL.revokeObjectURL(url);
      }
    });
    for (const pixel of samples) expect(pixel[3]).toBe(255);
    expect(
      new Set(samples.map((pixel) => pixel.slice(0, 3).join(","))).size,
    ).toBeGreaterThanOrEqual(3);
    if (previous) expect(samples).toEqual(previous);
    previous = samples;
  }
});

import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, language = "ru") {
  await page.route("https://media.example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#61885c"/><path d="M0 440 240 170 460 370 700 100 960 330V540H0" fill="#304632"/><circle cx="790" cy="100" r="46" fill="#f3cc69"/></svg>`,
    }),
  );
  await page.addInitScript(
    ({ language }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      w.catalogRequests = [];
      const projects = Array.from({ length: 9 }, (_, i) => ({
        id: `project-${i}`,
        source: "modrinth",
        kind: "mod",
        title: i === 0 ? "Forest adventures" : "Project " + (i + 1),
        description:
          "A project with a longer description to check responsive cards, readable text and balanced spacing next to the filter panel.",
        author: "Community",
        icon: "https://media.example.test/icon.svg",
        downloads: 123456 + i * 9000,
      }));
      const state = {
        profiles: [],
        accounts: [],
        selectedAccount: null,
        running: [],
        settings: {
          language,
          theme: "light",
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 820,
          showSnapshots: false,
        },
        dataDir: "D:/fixture",
        curseforgeConfigured: true,
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
          if (cmd !== "rpc") return cmd.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.catalogRequests.push({ action, payload });
          if (action === "snapshot") return state;
          if (action === "saveSettings") {
            state.settings = payload.settings;
            return null;
          }
          if (action === "search") return { projects, total: 9 };
          if (action === "versions")
            return {
              latest: { release: "1.21.1" },
              versions: [{ id: "1.21.1", type: "release" }],
            };
          if (action === "catalogCategories")
            return [
              { id: "game-mechanics", name: "game-mechanics" },
              { id: "colored-lighting", name: "colored-lighting" },
              { id: "new-category", name: "new-category" },
            ];
          if (action === "project")
            return {
              project: projects[0],
              body: '<center><img src="https://media.example.test/description.svg" width="600" alt="Description screenshot" onerror="window.mediaUnsafe=true" /></center><script>window.mediaUnsafe=true</script>\n\n# Details\n\nNormal **Markdown** with HTML images.\n\n| Name | Value |\n| --- | --- |\n| Test | 1 |',
              gallery: [
                "https://media.example.test/first.svg",
                "https://media.example.test/second.svg",
                "https://media.example.test/third.svg",
              ],
              versions: [],
              url: "https://modrinth.com/project/test",
            };
          return null;
        },
      };
    },
    { language },
  );
  await page.goto("/");
  await page.locator(".sidebar nav button").nth(2).click();
  await page.locator(".catalog-result").first().waitFor();
}

test("list/grid persist, adapt beside filters and preserve dropdown pointer/toggle", async ({
  page,
}) => {
  await fixture(page);
  await expect(page.locator(".catalog-result-list")).not.toHaveClass(
    /catalog-result-grid/,
  );
  await page.getByRole("button", { name: "Плитки", exact: true }).click();
  await expect(page.locator(".catalog-result-list")).toHaveClass(
    /catalog-result-grid/,
  );
  for (const width of [960, 1280, 1680]) {
    await page.setViewportSize({ width, height: 900 });
    const filters = await page
      .getByRole("complementary", { name: "Фильтры проектов" })
      .boundingBox();
    const results = await page.locator(".catalog-results").boundingBox();
    expect(filters!.x).toBeGreaterThanOrEqual(results!.x + results!.width);
    expect(
      await page.evaluate(
        () =>
          document.querySelector(".content-scroll")!.scrollWidth <=
          document.querySelector(".content-scroll")!.clientWidth,
      ),
    ).toBe(true);
    const columns = await page
      .locator(".catalog-result-grid")
      .evaluate(
        (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBeGreaterThanOrEqual(2);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(".catalog-workspace").screenshot({
    path: "target/branding-icons/catalog-grid-light.png",
    animations: "disabled",
  });
  await page.reload();
  await page
    .getByRole("button", { name: "Каталог проектов", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Плитки", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const sort = page.getByRole("combobox", {
    name: "Сортировка проектов",
    includeHidden: true,
  });
  await sort.click();
  await expect(sort).toHaveCSS("cursor", "pointer");
  await expect(sort).toHaveCSS("pointer-events", "auto");
  await expect(page.getByRole("listbox")).toBeVisible();
  await sort.click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await sort.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await expect(
    page.getByRole("option", { name: "По загрузкам", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    page.getByRole("option", { name: "Новые проекты", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(sort).toHaveText("Новые проекты");
  const category = page.getByRole("combobox", { name: "Категория проекта" });
  await category.click();
  await expect(
    page.getByRole("option", { name: "Игровые механики", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Цветное освещение", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "New category", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".catalog-workspace").screenshot({
    path: "target/branding-icons/catalog-grid-dark.png",
    animations: "disabled",
  });
});

test("source has original logos, animated options and localized coming-soon spacing", async ({
  page,
}) => {
  await fixture(page);
  const source = page.getByRole("combobox", { name: "Источник проектов" });
  const checkSourceAlignment = async () => {
    const spacing = await source.evaluate((button) => {
      const label = button.querySelector(".select-option-label")!;
      const logo = label.querySelector("img")!.getBoundingClientRect();
      const text = [...label.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      )!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const name = range.getBoundingClientRect();
      const bounds = button.getBoundingClientRect();
      return {
        left: logo.left - bounds.left,
        gap: name.left - logo.right,
        vertical: Math.abs(
          logo.y + logo.height / 2 - bounds.y - bounds.height / 2,
        ),
      };
    });
    expect(spacing.left).toBeGreaterThanOrEqual(10);
    expect(spacing.left).toBeLessThanOrEqual(15);
    expect(spacing.gap).toBeGreaterThanOrEqual(3);
    expect(spacing.gap).toBeLessThanOrEqual(6);
    expect(spacing.vertical).toBeLessThanOrEqual(2);
  };
  await checkSourceAlignment();
  await source.screenshot({
    path: "target/branding-icons/source-modrinth.png",
  });
  await source.click();
  await expect(
    page.getByRole("option", { name: "Modrinth", exact: true }).locator("img"),
  ).toBeVisible();
  await expect(
    page
      .getByRole("option", { name: "CurseForge", exact: true })
      .locator("img"),
  ).toBeVisible();
  await expect(page.getByRole("listbox")).toHaveCSS(
    "animation-name",
    "dropdown-in",
  );
  await page.getByRole("option", { name: "CurseForge", exact: true }).click();
  await checkSourceAlignment();
  await source.screenshot({
    path: "target/branding-icons/source-curseforge.png",
  });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await checkSourceAlignment();
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(
    page.getByRole("heading", { name: "Ожидается в скором времени" }),
  ).toBeVisible();
  const toolbar = await page.locator(".catalog-results-toolbar").boundingBox();
  const empty = await page
    .locator(".catalog-results > .empty-state")
    .boundingBox();
  expect(empty!.y - toolbar!.y - toolbar!.height).toBeGreaterThanOrEqual(19);
  expect(
    await page.evaluate(
      () =>
        (window as any).catalogRequests.filter(
          (r: any) =>
            r.action === "search" && r.payload.query.source === "curseforge",
        ).length,
    ),
  ).toBe(0);
  await page.locator(".catalog-workspace").screenshot({
    path: "target/branding-icons/catalog-curseforge.png",
    animations: "disabled",
  });
});

test("safe HTML images render; gallery carousel and zoom restore modal and focus", async ({
  page,
}) => {
  await fixture(page);
  await page.locator(".catalog-card").first().click();
  const dialog = page.getByRole("dialog", {
    name: "Forest adventures",
    exact: true,
  });
  await expect(
    dialog.locator('.markdown img[alt="Description screenshot"]'),
  ).toBeVisible();
  await expect(dialog.locator(".markdown script")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as any).mediaUnsafe),
  ).toBeUndefined();
  await expect(dialog.locator(".markdown table")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Увеличить изображение", exact: true })
    .click();
  let lightbox = page.getByRole("dialog", {
    name: "Просмотр изображения",
    exact: true,
  });
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Галерея · 3" }).click();
  const stage = dialog.locator(".project-media-stage");
  await expect(stage.locator("img")).toHaveAttribute("src", /first/);
  await stage.getByRole("button", { name: "Следующее изображение" }).click();
  await expect(stage.locator("img")).toHaveAttribute("src", /second/);
  const open = stage.getByRole("button", { name: "Открыть изображение 2" });
  await expect(open).toHaveCSS("cursor", "zoom-in");
  await open.click();
  lightbox = page.getByRole("dialog", {
    name: "Просмотр изображения",
    exact: true,
  });
  await expect(lightbox.locator("img")).toHaveAttribute("src", /second/);
  await page.keyboard.press("ArrowRight");
  await expect(lightbox.locator("img")).toHaveAttribute("src", /third/);
  await lightbox
    .locator(".lightbox-toolbar")
    .getByRole("button", { name: "Увеличить изображение" })
    .click();
  await expect(lightbox.locator(".lightbox-stage")).toHaveClass(/zoomed/);
  await lightbox.screenshot({
    path: "target/branding-icons/catalog-lightbox.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(open).toBeFocused();
  await dialog.locator(".project-carousel").screenshot({
    path: "target/branding-icons/catalog-gallery.png",
    animations: "disabled",
  });
});

test("English source placeholder and categories are localized", async ({
  page,
}) => {
  await fixture(page, "en");
  await page.getByRole("combobox", { name: "Project category" }).click();
  await expect(
    page.getByRole("option", { name: "Game mechanics", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Project source" }).click();
  await page.getByRole("option", { name: "CurseForge", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Coming soon", exact: true }),
  ).toBeVisible();
});

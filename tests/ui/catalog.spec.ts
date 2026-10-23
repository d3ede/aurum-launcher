import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  language = "ru",
  withProfiles = false,
  running = false,
) {
  await page.route("https://media.example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540"><rect width="960" height="540" fill="#61885c"/><path d="M0 440 240 170 460 370 700 100 960 330V540H0" fill="#304632"/><circle cx="790" cy="100" r="46" fill="#f3cc69"/></svg>`,
    }),
  );
  await page.addInitScript(
    ({ language, withProfiles, running }) => {
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
      const content = (projectId: string) => ({
        id: `content:${projectId}`,
        source: "modrinth",
        projectId,
        versionId: "version-1",
        name: projectId,
        filename: `${projectId}.jar`,
        kind: "mod",
        enabled: true,
      });
      const profiles = withProfiles
        ? [
            {
              id: "radiance",
              name: "Radiance",
              content: [content("project-0")],
            },
            {
              id: "other",
              name: "Other instance",
              content: [content("project-1")],
            },
          ].map((p) => ({
            ...p,
            minecraft: "1.21.1",
            loader: "fabric",
            loaderVersion: "0.16.14",
            installedVersion: "1.21.1",
            ramMb: null,
            jvmArgs: "",
            lastPlayed: null,
            cover: 0,
          }))
        : [];
      const state = {
        profiles,
        accounts: [],
        selectedAccount: null,
        running: running ? ["radiance"] : [],
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
          if (action === "snapshot") return structuredClone(state);
          if (action === "installContent" || action === "manageContent") {
            await new Promise<void>((resolve, reject) => {
              w.finishCatalogAction = (fail = false) =>
                fail ? reject(new Error("Fixture action failed")) : resolve();
            });
            const profile = profiles.find((p) => p.id === payload.id)!;
            if (action === "installContent")
              profile.content.push({
                ...content(payload.projectId),
                source: payload.source,
              });
            else
              profile.content = profile.content.filter(
                (c) => c.id !== payload.contentId,
              );
            return null;
          }
          if (action === "saveSettings") {
            state.settings = payload.settings;
            return null;
          }
          if (action === "search") {
            if (w.failedSource === payload.query.source)
              throw new Error("Source offline");
            return {
              projects: projects.map((p) => ({
                ...p,
                source: payload.query.source,
                kind: payload.query.kind,
              })),
              total: 9,
            };
          }
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
              project: {
                ...(projects.find((p) => p.id === payload.id) || projects[0]),
                source: payload.source,
              },
              body:
                w.projectBody ??
                '<center><img src="https://media.example.test/description.svg" width="600" alt="Description screenshot" onerror="window.mediaUnsafe=true" /></center><script>window.mediaUnsafe=true</script>\n\n# Details\n\nNormal **Markdown** with HTML images.\n\n| Name | Value |\n| --- | --- |\n| Test | 1 |',
              gallery: [
                "https://media.example.test/first.svg",
                "https://media.example.test/second.svg",
                "https://media.example.test/third.svg",
              ],
              versions: withProfiles
                ? [
                    {
                      id: "version-1",
                      name: "1.0",
                      gameVersions: ["1.21.1"],
                      loaders: ["fabric"],
                    },
                  ]
                : [],
              url: "https://modrinth.com/project/test",
            };
          return null;
        },
      };
    },
    { language, withProfiles, running },
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

test("source has original logos, animated options and an active CurseForge catalog", async ({
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
  for (const name of ["ATLauncher", "FTB", "Technic"]) {
    const option = page.getByRole("option", { name, exact: true });
    await expect(option.locator(".catalog-source-logo img")).toBeVisible();
    await expect
      .poll(() =>
        option
          .locator("img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect(option.locator(".catalog-source-monogram")).toHaveCount(0);
  }
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") {
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Переключить тему" }).click();
      await source.click();
    }
    await page
      .getByRole("listbox")
      .evaluate((menu) =>
        menu.getAnimations().forEach((animation) => animation.finish()),
      );
    const rows = await page
      .getByRole("listbox")
      .locator(".select-option-label")
      .evaluateAll((labels) =>
        labels.map((label) => {
          const icon = label
            .querySelector(".catalog-source-logo")!
            .getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(
            [...label.childNodes].find(
              (node) =>
                node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
            )!,
          );
          return {
            width: icon.width,
            height: icon.height,
            labelOffset:
              range.getBoundingClientRect().left -
              label.getBoundingClientRect().left,
          };
        }),
      );
    expect(rows).toHaveLength(6);
    expect(new Set(rows.map((row) => row.labelOffset)).size).toBe(1);
    expect(rows.every((row) => row.width === 24 && row.height === 24)).toBe(
      true,
    );
    await page.getByRole("listbox").screenshot({
      path: `target/branding-icons/source-menu-${theme}.png`,
      animations: "disabled",
    });
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Переключить тему" }).click();
  for (const name of ["ATLauncher", "FTB", "Technic"]) {
    await source.click();
    await page.getByRole("option", { name, exact: true }).click();
    await expect(source.locator(".catalog-source-logo img")).toBeVisible();
    await checkSourceAlignment();
  }
  await source.click();
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
  await expect(page.locator(".catalog-result")).toHaveCount(9);
  await expect(
    page.getByRole("heading", { name: "Ожидается в скором времени" }),
  ).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).catalogRequests.filter(
            (r: any) =>
              r.action === "search" && r.payload.query.source === "curseforge",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).catalogRequests.filter(
            (r: any) =>
              r.action === "catalogCategories" &&
              r.payload.source === "curseforge",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
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

test("description images load without a local referrer on hotlink-protected hosts", async ({
  page,
}) => {
  await fixture(page);
  const imageHeaders: Record<string, string>[] = [];
  await page.route("https://i.imgur.com/**", (route) => {
    const headers = route.request().headers();
    imageHeaders.push(headers);
    return headers.referer
      ? route.fulfill({ status: 403, body: "Hotlink denied" })
      : route.fulfill({
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="28"><rect width="120" height="28" fill="#5865f2"/></svg>',
        });
  });
  await page.evaluate(() => {
    (window as any).projectBody =
      "[![Discord](https://i.imgur.com/vU8pcbf.png)](https://discord.com/invite/example) ![separator](https://i.imgur.com/yZzzW4Q.pngg)";
  });
  await page.locator(".catalog-card").first().click();
  const dialog = page.getByRole("dialog", {
    name: "Forest adventures",
    exact: true,
  });
  for (const alt of ["Discord", "separator"]) {
    const img = dialog.locator(`.markdown img[alt="${alt}"]`);
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
      .toBe(120);
    await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
  }
  expect(imageHeaders).toHaveLength(2);
  expect(imageHeaders.every((headers) => !headers.referer)).toBe(true);
  await expect(dialog.locator(".media-unavailable")).toHaveCount(0);
  await dialog.locator('.markdown img[alt="Discord"]').click();
  const lightbox = page.getByRole("dialog", {
    name: "Просмотр изображения",
    exact: true,
  });
  await expect(lightbox.locator("img")).toHaveAttribute(
    "referrerpolicy",
    "no-referrer",
  );
  await expect
    .poll(() =>
      lightbox
        .locator("img")
        .evaluate((e) => (e as HTMLImageElement).naturalWidth),
    )
    .toBe(120);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`gallery viewer fills the window for small, portrait and large images in ${theme} theme`, async ({
    page,
  }) => {
    await fixture(page);
    const sizes = [
      [350, 110],
      [600, 1200],
      [2560, 1440],
    ];
    for (const [index, name] of ["first", "second", "third"].entries()) {
      const [width, height] = sizes[index];
      await page.route(`https://media.example.test/${name}.svg`, (route) =>
        route.fulfill({
          contentType: "image/svg+xml",
          body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#61885c"/><path d="M0 ${height} ${width / 2} 0 ${width} ${height}" fill="#304632"/></svg>`,
        }),
      );
    }
    if (theme === "dark")
      await page.getByRole("button", { name: "Переключить тему" }).click();
    await page.locator(".catalog-card").first().click();
    const dialog = page.getByRole("dialog", {
      name: "Forest adventures",
      exact: true,
    });
    await dialog.getByRole("button", { name: "Галерея · 3" }).click();
    const preview = dialog.locator(".project-media-open");
    expect((await preview.boundingBox())!.height).toBeGreaterThan(400);
    await preview.click();
    const lightbox = page.getByRole("dialog", {
      name: "Просмотр изображения",
      exact: true,
    });
    const stage = lightbox.locator(".lightbox-stage");
    const img = lightbox.locator(".lightbox-image img");
    for (let i = 0; i < sizes.length; i++) {
      if (i) await page.keyboard.press("ArrowRight");
      await expect
        .poll(() => img.evaluate((e) => (e as HTMLImageElement).naturalWidth))
        .toBe(sizes[i][0]);
      const frame = (await stage.boundingBox())!;
      const picture = (await img.boundingBox())!;
      expect(picture.width).toBeGreaterThanOrEqual(frame.width - 1);
      expect(picture.height).toBeGreaterThanOrEqual(frame.height - 1);
      await expect(img).toHaveCSS("object-fit", "contain");
      expect(frame.x).toBeGreaterThanOrEqual(0);
      expect(frame.y + frame.height).toBeLessThanOrEqual(820);
    }
    await lightbox.screenshot({
      path: `target/branding-icons/gallery-fit-${theme}.png`,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 960, height: 680 });
    const resized = (await stage.boundingBox())!;
    expect(resized.x + resized.width).toBeLessThanOrEqual(960);
    expect(resized.y + resized.height).toBeLessThanOrEqual(680);
    await expect(
      lightbox.getByRole("button", { name: "Закрыть изображение" }),
    ).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
  });
}

test("English CurseForge catalog and categories are localized", async ({
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
  ).toHaveCount(0);
  await expect(page.locator(".catalog-result")).toHaveCount(9);
});

async function bindRadiance(page: Page, resultCount = 9) {
  await page
    .getByRole("combobox", { name: "Установить в", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Radiance · 1.21.1 · Fabric", exact: true })
    .click();
  await expect(page.locator(".catalog-result")).toHaveCount(resultCount);
}

test("catalog installs, animates and removes only from the selected instance", async ({
  page,
}) => {
  await fixture(page, "ru", true);
  const second = page.locator(".catalog-result").nth(1);
  const button = second.locator(".catalog-install-button");
  // An unbound install opens the existing instance/version chooser.
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Project 2", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Установить в сборку" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await bindRadiance(page);
  await expect(button).toHaveClass(/is-available/);
  await button.click();
  await expect(button).toHaveAttribute("aria-busy", "true");
  await expect(button).toContainText("Установка…");
  await expect(button.locator("svg")).toHaveCSS(
    "animation-name",
    "catalog-action-spin",
  );
  await expect(button).toBeDisabled();
  await expect(page.locator(".catalog-install-button").first()).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).finishCatalogAction))
    .toBe("function");
  await page.evaluate(() => (window as any).finishCatalogAction());
  await page.mouse.move(0, 0);
  await expect(button).toHaveClass(/is-installed/);
  await expect(button).toBeEnabled();
  await page.locator(".catalog-workspace").screenshot({
    path: "target/branding-icons/catalog-installed-light.png",
    animations: "disabled",
  });
  await button.hover();
  await expect(button.locator(".catalog-action-remove")).toHaveCSS(
    "opacity",
    "1",
  );
  await expect(button.locator(".catalog-action-label")).toHaveCSS(
    "opacity",
    "0",
  );
  const danger = await button.evaluate((e) =>
    getComputedStyle(e).getPropertyValue("--danger").trim(),
  );
  await expect
    .poll(() => button.evaluate((e) => getComputedStyle(e).color))
    .toBe(
      await button.evaluate((e, color) => {
        const probe = document.createElement("span");
        probe.style.color = color;
        e.append(probe);
        const value = getComputedStyle(probe).color;
        probe.remove();
        return value;
      }, danger),
    );
  await button.screenshot({
    path: "target/branding-icons/catalog-remove-hover.png",
  });
  // Removal is keyboard-accessible and uses the same trash action as instance content.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveClass(/is-removing/);
  await expect(button).toContainText("Удаление…");
  await page.evaluate(() => (window as any).finishCatalogAction());
  await expect(button).toHaveClass(/is-available/);
  const requests = await page.evaluate(() => (window as any).catalogRequests);
  expect(
    requests.find((r: any) => r.action === "installContent").payload,
  ).toMatchObject({
    id: "radiance",
    projectId: "project-1",
    versionId: "version-1",
  });
  expect(
    requests.find((r: any) => r.action === "manageContent").payload,
  ).toEqual({
    id: "radiance",
    contentId: "content:project-1",
    action: "remove",
  });
  await page
    .getByRole("combobox", { name: "Установить в", exact: true })
    .click();
  await page
    .getByRole("option", {
      name: "Other instance · 1.21.1 · Fabric",
      exact: true,
    })
    .click();
  await expect(button).toHaveClass(/is-installed/);
});

test("failed catalog actions restore controls, including installed state after failed removal", async ({
  page,
}) => {
  await fixture(page, "ru", true);
  await bindRadiance(page);
  for (const index of [1, 0]) {
    const button = page.locator(".catalog-install-button").nth(index);
    await button.click();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect
      .poll(() =>
        page.evaluate(() => typeof (window as any).finishCatalogAction),
      )
      .toBe("function");
    await page.evaluate(() => {
      (window as any).finishCatalogAction(true);
      delete (window as any).finishCatalogAction;
    });
    await expect(button).toBeEnabled();
    await expect(button).toHaveClass(index ? /is-available/ : /is-installed/);
    await expect(page.locator(".toast")).toContainText("Fixture action failed");
  }
});

test("large block tiles fit both themes and respect reduced motion", async ({
  page,
}) => {
  await fixture(page, "ru", true);
  await bindRadiance(page);
  await page.getByRole("button", { name: "Плитки", exact: true }).click();
  await expect(page.locator(".catalog-card .project-icon").first()).toHaveCSS(
    "width",
    "100px",
  );
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Переключить тему" }).click();
    await page.mouse.move(0, 0);
    await page.locator(".catalog-workspace").screenshot({
      path: `target/branding-icons/catalog-actions-grid-${theme}.png`,
      animations: "disabled",
    });
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const button = page.locator(".catalog-install-button").nth(1);
  await button.click();
  await expect(button.locator("svg")).toHaveCSS("animation-name", "none");
  expect(
    await button.evaluate((e) => getComputedStyle(e, "::before").animationName),
  ).toBe("none");
  await page.evaluate(() => (window as any).finishCatalogAction());
  await expect(button).toHaveClass(/is-installed/);
});

test("running instances disable catalog mutations and English action labels translate", async ({
  page,
}) => {
  await fixture(page, "en", true, true);
  await page
    .getByRole("combobox", { name: "Install into", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Radiance · 1.21.1 · Fabric", exact: true })
    .click();
  await expect(page.locator(".catalog-install-button").first()).toContainText(
    "Installed",
  );
  await expect(page.locator(".catalog-install-button").nth(1)).toContainText(
    "Install",
  );
  await expect(page.locator(".catalog-install-button").first()).toBeDisabled();
  await expect(page.locator(".catalog-install-button").nth(1)).toBeDisabled();
});

test("CurseForge opens project versions and installs into the selected instance", async ({
  page,
}) => {
  await fixture(page, "ru", true);
  await page
    .getByRole("combobox", { name: "Источник проектов", exact: true })
    .click();
  await page.getByRole("option", { name: "CurseForge", exact: true }).click();
  await bindRadiance(page);
  await expect(page.locator(".catalog-result")).toHaveCount(9);
  await page.locator(".catalog-card").nth(1).click();
  const dialog = page.getByRole("dialog", { name: "Project 2", exact: true });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).catalogRequests.some(
          (r: any) =>
            r.action === "project" &&
            r.payload.source === "curseforge" &&
            r.payload.id === "project-1",
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  const install = page
    .locator(".catalog-result")
    .nth(1)
    .locator(".catalog-install-button");
  await install.click();
  await expect(install).toHaveAttribute("aria-busy", "true");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).finishCatalogAction))
    .toBe("function");
  await page.evaluate(() => (window as any).finishCatalogAction());
  await expect(install).toHaveClass(/is-installed/);
  const requests = await page.evaluate(() => (window as any).catalogRequests);
  expect(
    requests.find((r: any) => r.action === "installContent").payload,
  ).toMatchObject({
    source: "curseforge",
    projectId: "project-1",
    versionId: "version-1",
    id: "radiance",
  });
});

test("all sources shows origin badges, keeps project origins and handles partial failure", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("combobox", { name: "Источник проектов", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Все источники", exact: true })
    .click();
  await expect(page.locator(".catalog-result")).toHaveCount(18);
  await expect(
    page.getByRole("img", { name: "Источник: Modrinth", exact: true }),
  ).toHaveCount(9);
  await expect(
    page.getByRole("img", { name: "Источник: CurseForge", exact: true }),
  ).toHaveCount(9);
  await expect(
    page.getByRole("combobox", { name: "Категория проекта", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Далее", exact: true }),
  ).toBeDisabled();
  await page.locator(".catalog-result").nth(1).locator(".catalog-card").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).catalogRequests.some(
          (r: any) =>
            r.action === "project" && r.payload.source === "curseforge",
        ),
      ),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Плитки", exact: true }).click();
  await page.screenshot({
    path: ".test-data/screenshots/catalog-all-light.png",
  });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await page.setViewportSize({ width: 960, height: 680 });
  await page.screenshot({
    path: ".test-data/screenshots/catalog-all-dark.png",
  });
  await page.evaluate(() => {
    (window as any).failedSource = "curseforge";
  });
  await page
    .getByRole("textbox", { name: "Поиск проектов", exact: true })
    .fill("only here");
  await expect(page.locator(".catalog-source-warning")).toContainText(
    "CurseForge",
  );
  await expect(page.locator(".catalog-result")).toHaveCount(9);
  await page.evaluate(() => {
    (window as any).failedSource = null;
  });
  await page
    .getByRole("button", { name: "Попробовать снова", exact: true })
    .click();
  await expect(page.locator(".catalog-result")).toHaveCount(18);
  await expect(page.locator(".catalog-source-warning")).toHaveCount(0);
  await page.getByRole("button", { name: "Модпаки", exact: true }).click();
  await expect(page.locator(".catalog-result")).toHaveCount(45);
  const sources = await page.evaluate(() => [
    ...new Set(
      (window as any).catalogRequests
        .filter(
          (r: any) =>
            r.action === "search" && r.payload.query.kind === "modpack",
        )
        .map((r: any) => r.payload.query.source),
    ),
  ]);
  expect(sources).toHaveLength(5);
});

test("combined results install from their actual source into the selected instance", async ({
  page,
}) => {
  await fixture(page, "ru", true);
  await page
    .getByRole("combobox", { name: "Источник проектов", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Все источники", exact: true })
    .click();
  await bindRadiance(page, 18);
  await expect(page.locator(".catalog-result")).toHaveCount(18);
  const result = page.locator(".catalog-result").nth(1);
  await expect(
    result.getByRole("img", { name: "Источник: CurseForge", exact: true }),
  ).toBeVisible();
  const install = result.locator(".catalog-install-button");
  await install.click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).finishCatalogAction))
    .toBe("function");
  await page.evaluate(() => (window as any).finishCatalogAction());
  await expect(install).toHaveClass(/is-installed/);
  const requests = await page.evaluate(() => (window as any).catalogRequests);
  expect(
    requests.find((r: any) => r.action === "installContent").payload,
  ).toMatchObject({
    source: "curseforge",
    projectId: "project-0",
    id: "radiance",
  });
  expect(
    requests
      .filter((r: any) => r.action === "search")
      .every((r: any) => r.payload.query.source !== "all"),
  ).toBe(true);
});

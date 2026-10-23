import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, language = "ru", sixProfiles = false) {
  await page.addInitScript(
    ({ language, sixProfiles }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const state = {
        profiles: [
          "Zulu",
          "Alpha",
          "Beta",
          "Gamma",
          ...(sixProfiles ? ["Delta", "Epsilon"] : []),
        ].map((name, index) => ({
          id: name,
          name,
          minecraft: "1.21.1",
          loader: "vanilla",
          loaderVersion: null,
          installedVersion: "1.21.1",
          ramMb: null,
          jvmArgs: "",
          lastPlayed: index === 0 ? 999 : null,
          cover: 0,
          icon: null,
          content: [],
        })),
        accounts: [
          {
            id: "preview-account",
            uuid: "preview",
            name: "Player",
            kind: "offline",
            hasSkin: false,
          },
        ],
        selectedAccount: "preview-account",
        settings: {
          language,
          theme: "light",
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
        dataDir: "D:/Aurum",
        running: [] as string[],
        curseforgeConfigured: false,
      };
      w.profileCardRequests = [];
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
          if (args.action === "snapshot") return structuredClone(state);
          w.profileCardRequests.push(args);
          if (args.action === "launch") state.running.push(args.payload.id);
          if (args.action === "stop")
            state.running = state.running.filter(
              (id: string) => id !== args.payload.id,
            );
          if (args.action === "updateProfile")
            state.profiles = state.profiles.map((profile) =>
              profile.id === args.payload.profile.id
                ? args.payload.profile
                : profile,
            );
          if (args.action === "deleteProfile")
            state.profiles = state.profiles.filter(
              (profile) => profile.id !== args.payload.id,
            );
          if (args.action === "saveSettings") {
            state.settings = args.payload.settings;
            return null;
          }
          if (args.action === "content") return [];
          return null;
        },
      };
    },
    { language, sixProfiles },
  );
  await page.goto("/");
  await openLibrary(page, language, sixProfiles ? 6 : 4);
}

async function openLibrary(page: Page, language = "ru", count = 4) {
  await page
    .getByRole("button", {
      name: language === "ru" ? "Мои сборки" : "My instances",
      exact: true,
    })
    .click();
  await expect(page.locator(".library .instance-card")).toHaveCount(count);
}

const cards = (page: Page) => page.locator(".library h3");
const handle = (page: Page, name: string) =>
  page.getByRole("button", { name: `Переместить сборку ${name}`, exact: true });
const sort = (page: Page) =>
  page.getByRole("combobox", { name: "Сортировка сборок" });
async function chooseSort(page: Page, label: string) {
  await sort(page).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

async function startDrag(
  page: Page,
  source: string,
  target: string,
  fromEdge = false,
) {
  const from = (await handle(page, source).boundingBox())!;
  const to = (await page
    .locator(`[data-profile-id="${target}"]`)
    .boundingBox())!;
  await page.mouse.move(
    from.x + from.width / 2,
    from.y + (fromEdge ? 8 : from.height / 2),
  );
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
}

test("defaults to newest, dragging immediately selects custom and persists across reload and sort switches", async ({
  page,
}) => {
  await fixture(page);
  await expect(cards(page)).toHaveText(["Gamma", "Beta", "Alpha", "Zulu"]);
  await expect(sort(page)).toHaveText("Сначала новые");
  await startDrag(page, "Gamma", "Zulu", true);
  await expect(page.locator(".profile-drag-preview")).toBeVisible();
  expect(
    (await page.locator(".profile-drag-preview").boundingBox())!.x,
  ).toBeGreaterThan(
    (await page.locator('[data-profile-id="Gamma"]').boundingBox())!.x + 100,
  );
  await page.screenshot({
    path: ".test-data/screenshots/profile-drag.png",
    animations: "disabled",
  });
  await expect(sort(page)).toHaveText("Пользовательская");
  await expect(page.locator('[data-profile-id="Zulu"]')).toHaveClass(
    /is-drop-target/,
  );
  await page.mouse.up();
  await expect(page.locator(".profile-drag-preview")).toHaveCount(0);
  await expect(cards(page)).toHaveText(["Beta", "Alpha", "Zulu", "Gamma"]);
  await page.reload();
  await openLibrary(page);
  await expect(sort(page)).toHaveText("Пользовательская");
  await expect(cards(page)).toHaveText(["Beta", "Alpha", "Zulu", "Gamma"]);
  await chooseSort(page, "По названию");
  await expect(cards(page)).toHaveText(["Alpha", "Beta", "Gamma", "Zulu"]);
  await chooseSort(page, "Пользовательская");
  await expect(cards(page)).toHaveText(["Beta", "Alpha", "Zulu", "Gamma"]);
  await chooseSort(page, "Сначала новые");
  await page.reload();
  await openLibrary(page);
  await expect(cards(page)).toHaveText(["Gamma", "Beta", "Alpha", "Zulu"]);
});

test("dragging from name sort keeps its baseline; Escape cancels; keyboard and filtered moves keep all profiles", async ({
  page,
}) => {
  await fixture(page);
  await chooseSort(page, "По названию");
  await startDrag(page, "Zulu", "Alpha");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(sort(page)).toHaveText("По названию");
  await expect(cards(page)).toHaveText(["Alpha", "Beta", "Gamma", "Zulu"]);
  await startDrag(page, "Zulu", "Alpha");
  await page.mouse.up();
  await expect(cards(page)).toHaveText(["Zulu", "Alpha", "Beta", "Gamma"]);
  await handle(page, "Gamma").focus();
  await page.keyboard.press("ArrowUp");
  await expect(cards(page)).toHaveText(["Zulu", "Alpha", "Gamma", "Beta"]);
  await expect(handle(page, "Gamma")).toBeFocused();
  await page.getByRole("textbox", { name: "Поиск сборок" }).fill("a");
  await startDrag(page, "Beta", "Alpha");
  await page.mouse.up();
  await expect(cards(page)).toHaveText(["Beta", "Alpha", "Gamma"]);
  await page.getByRole("textbox", { name: "Поиск сборок" }).clear();
  await expect(cards(page)).toHaveText(["Zulu", "Beta", "Alpha", "Gamma"]);
  await page.screenshot({ path: "target/profile-order-light.png" });
  await page.getByRole("button", { name: "Переключить тему" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: "target/profile-order-dark.png" });
});

test("custom sort and reorder controls have English labels", async ({
  page,
}) => {
  await fixture(page, "en");
  const dropdown = page.getByRole("combobox", { name: "Sort instances" });
  await expect(dropdown).toHaveText("Newest first");
  await page
    .getByRole("button", { name: "Move instance Gamma", exact: true })
    .press("ArrowRight");
  await expect(dropdown).toHaveText("Custom");
  await expect(cards(page)).toHaveText(["Beta", "Gamma", "Alpha", "Zulu"]);
});

test("horizontal cards launch and stop the chosen instance without opening it and fit both themes", async ({
  page,
}) => {
  await fixture(page);
  const card = page.locator('[data-profile-id="Gamma"]');
  const play = card.getByRole("button", { name: "Играть", exact: true });
  await expect(play).toHaveText("Играть");
  await play.click();
  await expect(
    card.getByRole("button", { name: "Стоп", exact: true }),
  ).toBeEnabled();
  await expect(card.locator(".instance-card-status")).toHaveText("Запущена");
  await card.getByRole("button", { name: "Стоп", exact: true }).click();
  await expect(play).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as any).profileCardRequests
        .filter((request: any) => ["launch", "stop"].includes(request.action))
        .map((request: any) => [request.action, request.payload.id]),
    ),
  ).toEqual([
    ["launch", "Gamma"],
    ["stop", "Gamma"],
  ]);
  await expect(page.locator(".library")).toBeVisible();

  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Переключить тему" }).click();
    for (const width of [960, 1280, 1560]) {
      await page.setViewportSize({ width, height: 900 });
      await page.mouse.move(20, 800);
      const geometry = await card.evaluate((element) => {
        const button = element
          .querySelector(".instance-card-play")!
          .getBoundingClientRect();
        const title = element.querySelector("h3")!.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        const next = element.nextElementSibling!.getBoundingClientRect();
        const grip = element
          .querySelector(".profile-sort-handle")!
          .getBoundingClientRect();
        const menu = element
          .querySelector(".profile-card-more")!
          .getBoundingClientRect();
        const arrow = element
          .querySelector(".instance-card-chevron")!
          .getBoundingClientRect();
        return {
          rectangular: button.width > button.height,
          separate: title.right <= button.left,
          inside: button.right < bounds.right,
          overflow: document.documentElement.scrollWidth > innerWidth,
          twoInRow:
            Math.abs(next.top - bounds.top) < 1 && next.left > bounds.left,
          compact: bounds.height <= 108,
          fullHeightGrip: grip.height >= bounds.height - 2,
          actionOrder: button.right <= menu.left && menu.right < arrow.left,
        };
      });
      expect(geometry).toEqual({
        rectangular: true,
        separate: true,
        inside: true,
        overflow: false,
        twoInRow: true,
        compact: true,
        fullHeightGrip: true,
        actionOrder: true,
      });
      await page.screenshot({
        path: `.test-data/screenshots/profile-rows-${theme}-${width}.png`,
        animations: "disabled",
      });
    }
  }
  await card
    .getByRole("button", { name: "Открыть Gamma", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Gamma", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".library")).toHaveCount(0);
});

test("card gaps open the instance while its menu manages it without navigation", async ({
  page,
}) => {
  await fixture(page);
  const card = page.locator('[data-profile-id="Gamma"]');
  const more = card.getByRole("button", {
    name: "Действия сборки Gamma",
    exact: true,
  });
  await more.click();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await page
    .getByRole("menuitem", { name: "Открыть папку", exact: true })
    .click();
  await expect(page.locator(".library")).toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as any).profileCardRequests
        .filter((request: any) => request.action === "openFolder")
        .map((request: any) => request.payload.id),
    ),
  ).toEqual(["Gamma"]);
  await more.click();
  await page
    .getByRole("menuitem", { name: "Переименовать", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Название", exact: true })
    .fill("Renamed instance");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(card.locator("h3")).toHaveText("Renamed instance");
  await card
    .getByRole("button", {
      name: "Действия сборки Renamed instance",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Проверить установку", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).profileCardRequests.filter(
            (request: any) => request.action === "install",
          ).length,
      ),
    )
    .toBe(1);
  await expect(
    card.getByRole("button", { name: "Играть", exact: true }),
  ).toBeEnabled();
  const launch = (await card.locator(".instance-card-launch").boundingBox())!;
  await page.mouse.click(launch.x + 3, launch.y + launch.height / 2);
  await expect(
    page.getByRole("heading", { name: "Renamed instance", exact: true }),
  ).toBeVisible();
});

test("delete requires confirmation and destructive menu actions are disabled while running", async ({
  page,
}) => {
  await fixture(page);
  const card = page.locator('[data-profile-id="Gamma"]');
  const more = card.getByRole("button", {
    name: "Действия сборки Gamma",
    exact: true,
  });
  await card.getByRole("button", { name: "Играть", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Стоп", exact: true }),
  ).toBeEnabled();
  await more.click();
  for (const name of ["Переименовать", "Проверить установку", "Удалить сборку"])
    await expect(
      page.getByRole("menuitem", { name, exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByRole("menuitem", { name: "Открыть папку", exact: true }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await card.getByRole("button", { name: "Стоп", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Играть", exact: true }),
  ).toBeEnabled();
  await more.click();
  await page
    .getByRole("menuitem", { name: "Удалить сборку", exact: true })
    .click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as any).profileCardRequests.filter(
        (request: any) => request.action === "deleteProfile",
      ),
    ),
  ).toEqual([]);
  await more.click();
  await page
    .getByRole("menuitem", { name: "Удалить сборку", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Удалить сборку", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await expect(page.locator(".library .instance-card")).toHaveCount(3);
});

test("six cards use a card-local matte finish, an unframed menu and a clickable trailing arrow", async ({
  page,
}) => {
  await fixture(page, "ru", true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const first = page.locator(".library .instance-card").first();
  const pattern = await first.evaluate((element) => {
    const style = getComputedStyle(element, "::before");
    return {
      image: style.backgroundImage,
      attachment: style.backgroundAttachment,
      size: style.backgroundSize,
    };
  });
  expect(pattern.image).toContain("radial-gradient");
  expect(pattern.image).not.toContain("repeating-linear-gradient");
  expect(pattern.image).not.toContain("url(");
  expect(
    pattern.attachment.split(",").every((value) => value.trim() === "scroll"),
  ).toBe(true);
  expect(pattern.size).toContain("100%");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark")
      await page.getByRole("button", { name: "Переключить тему" }).click();
    const more = first.locator(".profile-card-more");
    await more.hover();
    await expect(more).toHaveCSS("border-top-width", "0px");
    await expect(more).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const menuBounds = (await more.boundingBox())!;
    const arrowBounds = (await first
      .locator(".instance-card-chevron")
      .boundingBox())!;
    expect(menuBounds.x + menuBounds.width).toBeLessThan(arrowBounds.x);
    await page.mouse.move(20, 800);
    await page.screenshot({
      path: `.test-data/screenshots/profile-pattern-six-${theme}.png`,
      animations: "disabled",
    });
  }
  const arrow = (await first.locator(".instance-card-chevron").boundingBox())!;
  await page.mouse.click(arrow.x + arrow.width / 2, arrow.y + arrow.height / 2);
  await expect(
    page.getByRole("heading", { name: "Epsilon", exact: true }),
  ).toBeVisible();
});

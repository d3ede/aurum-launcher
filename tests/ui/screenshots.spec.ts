import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, theme = "dark", notifications = true) {
  await page.addInitScript(
    ({ theme, notifications }) => {
      localStorage.setItem("aurum:language", "en");
      const w = window as any;
      w.isTauri = true;
      const profile = (id: string, name: string) => ({
        id,
        name,
        minecraft: "1.21.1",
        loader: "vanilla",
        loaderVersion: null,
        installedVersion: "1.21.1",
        content: [],
        cover: 0,
      });
      const profiles = [
        profile("11111111-1111-4111-8111-111111111111", "Vanilla world"),
        profile("22222222-2222-4222-8222-222222222222", "Adventure world"),
      ];
      const state = {
        profiles,
        accounts: [{ id: "player", name: "Player", kind: "offline" }],
        selectedAccount: "player",
        running: [],
        dataDir: "C:/test-screenshots-only",
        settings: {
          language: "en",
          theme,
          javaPath: "",
          ramMb: 4096,
          jvmArgs: "",
          resolutionWidth: 1280,
          resolutionHeight: 720,
          showSnapshots: false,
        },
      };
      const social = {
        enabled: false,
        status: "disabled",
        error: null,
        id: `aur1${"a".repeat(59)}`,
        name: "Player",
        contactLink: null,
        avatar: null,
        privacy: {
          incomingRequests: true,
          shareActivity: false,
          publicRelays: true,
          invisible: false,
          notifications,
        },
        people: [
          {
            id: `aur1${"b".repeat(59)}`,
            name: "Alice",
            state: "friend",
            updated: 1,
          },
        ],
        online: [],
        activity: {},
        activeTunnels: 0,
        invitations: [],
        deliveries: {},
      };
      w.shotItems = Array.from({ length: 12 }, (_, i) => ({
        id: `local:${profiles[i < 7 ? 0 : 1].id}:shot${i}`,
        profileId: profiles[i < 7 ? 0 : 1].id,
        profileName: profiles[i < 7 ? 0 : 1].name,
        name: `2026-11-${String(i + 1).padStart(2, "0")}_12.00.00.png`,
        createdAt: 1794000000000 + i * 86400000,
        bytes: 1024 + i,
        width: 1920,
        height: 1080,
        source: "local",
        from: null,
      }));
      w.shotRequests = [];
      w.shotTransfers = [];
      w.shotSounds = [];
      w.AudioContext = class {
        state = "running";
        currentTime = 0;
        destination = {};
        resume() {
          return Promise.resolve();
        }
        close() {
          return Promise.resolve();
        }
        createOscillator() {
          const note = {
            type: "sine",
            frequency: { value: 0 },
            connect() {},
            disconnect() {},
            start() {
              w.shotSounds.push(note.frequency.value);
            },
            stop() {},
            onended: null,
          };
          return note;
        }
        createGain() {
          return {
            connect() {},
            disconnect() {},
            gain: {
              setValueAtTime() {},
              linearRampToValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
          };
        }
      };
      const callbacks = new Map<number, Function>();
      const events = new Map<string, Function>();
      let next = 1;
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
        transformCallback(fn: Function) {
          const id = next++;
          callbacks.set(id, fn);
          return id;
        },
        async invoke(command: string, args: any) {
          if (command === "plugin:event|listen") {
            events.set(args.event, callbacks.get(args.handler)!);
            return next++;
          }
          if (command !== "rpc")
            return command.includes("is_maximized") ? false : 1;
          const { action, payload } = args;
          w.shotRequests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "content") return [];
          if (action === "inspectContent")
            return { content: [], updates: [], warnings: [] };
          if (action === "social.snapshot") return structuredClone(social);
          if (action === "social.pending") return [];
          if (action === "social.takeLink" || action === "takeServerShortcut")
            return null;
          if (action === "screenshots.list")
            return {
              items: structuredClone(
                w.shotItems.filter(
                  (item: any) =>
                    !payload.profileId || item.profileId === payload.profileId,
                ),
              ),
              warnings: [],
            };
          if (action === "screenshots.image") {
            if (w.shotImageFail) throw "Screenshot no longer exists";
            if (!payload.thumbnail && w.holdShotImage === payload.id) {
              await new Promise<void>((resolve) => {
                w.releaseShotImage = resolve;
              });
            }
            const index = Number(payload.id.match(/shot(\d+)/)?.[1] || 0);
            const color = index % 2 ? "#347563" : "#758c46";
            return (
              "data:image/svg+xml," +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#9cceea"/><path fill="${color}" d="M0 480L180 260 340 400 550 180 800 350 1000 230 1280 420V720H0Z"/><path fill="#3c6450" d="M0 560L220 430 500 520 820 340 1280 550V720H0Z"/><rect x="120" y="330" width="35" height="230" fill="#6d5941"/><rect x="50" y="245" width="180" height="150" fill="#42704d"/><text x="900" y="650" fill="white" font-size="50">${index + 1}</text></svg>`,
              )
            );
          }
          if (action === "screenshots.transfers")
            return structuredClone(w.shotTransfers);
          if (action === "screenshots.decide") {
            for (const item of w.shotTransfers.filter(
              (item: any) =>
                item.batch === payload.batch && item.direction === "incoming",
            )) {
              item.decision = payload.accept;
              item.status = payload.accept ? "accepted" : "rejected";
            }
            return null;
          }
          if (action === "screenshots.send") {
            w.shotTransfers = payload.ids.map((id: string, i: number) => {
              const shot = w.shotItems.find((s: any) => s.id === id);
              return {
                ...shot,
                id: `delivery${i}`,
                sourceId: id,
                count: payload.ids.length,
                decision: null,
                batch: "batch1",
                peer: payload.friend,
                direction: "outgoing",
                status: "queued",
                transferred: 0,
                error: null,
              };
            });
            return w.shotTransfers.map((item: any) => item.id);
          }
          if (action === "screenshots.cancel") {
            w.shotTransfers.find((item: any) => item.id === payload.id).status =
              "cancelled";
            return null;
          }
          if (action === "screenshots.removeReceived") {
            w.shotTransfers = w.shotTransfers.filter(
              (item: any) => item.id !== payload.id,
            );
            return null;
          }
          if (action === "screenshots.save") return w.shotSaveResult ?? true;
          if (action === "screenshots.copy") {
            if (w.shotCopyError) throw new Error(w.shotCopyError);
            return null;
          }
          if (action === "search") return { projects: [], total: 0 };
          return [];
        },
      };
    },
    { theme, notifications },
  );
  await page.goto("/");
}
const nav = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("button", { name, exact: true });

for (const theme of ["light", "dark"]) {
  test(`screenshot batches require consent and confirm their saved location (${theme})`, async ({
    page,
  }) => {
    await fixture(page, theme);
    await nav(page, "Friends").click(); // Unlock the application's notification audio.
    await page.evaluate(() => {
      const w = window as any;
      w.shotTransfers = w.shotItems.slice(0, 2).map((shot: any, i: number) => ({
        ...shot,
        id: `incoming${i}`,
        batch: "consent-batch",
        count: 2,
        peer: `aur1${"b".repeat(59)}`,
        direction: "incoming",
        status: "requested",
        decision: null,
        transferred: 0,
        error: null,
      }));
    });
    const request = page.locator(".shot-notifications .shot-request-card");
    await expect(request).toContainText("Alice");
    await expect(request).toContainText("Would like to share 2 screenshots");
    await expect(request.locator(".social-avatar")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).shotSounds.length))
      .toBe(1);
    expect(
      await page.evaluate(() =>
        (window as any).shotRequests.filter(
          (r: any) => r.action === "screenshots.image",
        ),
      ),
    ).toHaveLength(0);
    await page.screenshot({
      path: `.test-data/screenshots/screenshot-request-${theme}.png`,
      animations: "disabled",
    });
    await request.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(request).toHaveCount(0);
    await expect(
      page.getByText("Screenshots saved", { exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        (window as any).shotRequests
          .filter((r: any) => r.action === "screenshots.decide")
          .map((r: any) => r.payload),
      ),
    ).toEqual([{ batch: "consent-batch", accept: true }]);
    await page.evaluate(() => {
      for (const shot of (window as any).shotTransfers)
        shot.status = "received";
    });
    const saved = page
      .locator(".shot-notice")
      .filter({ hasText: "Screenshots saved" });
    await expect(saved).toContainText("Screenshots → From friends");
    await expect
      .poll(() => page.evaluate(() => (window as any).shotSounds.length))
      .toBe(2);
    await saved
      .getByRole("button", { name: "Open screenshots", exact: true })
      .click();
    await expect(page.locator(".screenshot-card")).toHaveCount(2);
    await expect(page.locator(".shot-source-tabs .active")).toContainText(
      "From friends",
    );
  });
  test(`delivery replies and original previews (${theme})`, async ({
    page,
  }) => {
    await fixture(page, theme);
    await nav(page, "Screenshots").click();
    await page.evaluate(() => {
      const w = window as any;
      w.shotTransfers = w.shotItems.slice(0, 3).map((shot: any, i: number) => ({
        ...shot,
        id: `outgoing${i}`,
        sourceId: shot.id,
        batch: `out-batch${i}`,
        count: 1,
        peer: `aur1${"b".repeat(59)}`,
        direction: "outgoing",
        status: "awaiting",
        decision: null,
        transferred: 0,
        error: null,
      }));
    });
    await page.getByRole("button", { name: "Deliveries", exact: true }).click();
    await expect(page.locator(".shot-delivery-preview img")).toHaveCount(3);
    await page.evaluate(() => {
      const entries = (window as any).shotTransfers;
      entries[0].status = "delivered";
      entries[0].decision = true;
      entries[1].status = "rejected";
      entries[1].decision = false;
      entries[2].status = "failed";
      entries[2].error = "Offline";
    });
    await expect(
      page.locator(".shot-notice").filter({ hasText: "Screenshots accepted" }),
    ).toContainText("Alice");
    await expect(
      page
        .locator(".shot-notice")
        .filter({ hasText: "Screenshot request declined" }),
    ).toContainText("Alice");
    await expect(
      page
        .locator(".shot-notice")
        .filter({ hasText: "Could not send screenshots" }),
    ).toContainText("Alice");
    await expect
      .poll(() => page.evaluate(() => (window as any).shotSounds.length))
      .toBe(3);
    await expect(
      page.locator(
        ".shot-delivery.delivered .shot-delivery-icon .lucide-circle-check",
      ),
    ).toBeVisible();
    await expect(
      page.locator(".shot-delivery.rejected .shot-delivery-icon .lucide-x"),
    ).toBeVisible();
    await expect(
      page.locator(".shot-delivery.failed .shot-delivery-icon .lucide-x"),
    ).toBeVisible();
    await page.screenshot({
      path: `.test-data/screenshots/screenshot-replies-${theme}.png`,
      animations: "disabled",
    });
    await page
      .locator(".shot-delivery.delivered .shot-delivery-preview")
      .click();
    await expect(page.locator("[data-image-lightbox] img")).toBeVisible();
    await page.keyboard.press("Escape");
    // Polling and a UI remount must not replay the same reply sounds.
    await nav(page, "Friends").click();
    await nav(page, "Screenshots").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).shotRequests.filter(
              (r: any) => r.action === "screenshots.transfers",
            ).length,
        ),
      )
      .toBeGreaterThan(5);
    expect(await page.evaluate(() => (window as any).shotSounds.length)).toBe(
      3,
    );
  });
}

test("disabled notifications keep consent available in Screenshots", async ({
  page,
}) => {
  await fixture(page, "dark", false);
  await nav(page, "Friends").click();
  await page.evaluate(() => {
    const w = window as any;
    w.shotTransfers = [
      {
        ...w.shotItems[0],
        id: "quiet-request",
        batch: "quiet-batch",
        count: 1,
        peer: `aur1${"b".repeat(59)}`,
        direction: "incoming",
        status: "requested",
        decision: null,
        transferred: 0,
        error: null,
      },
    ];
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).shotRequests.filter(
            (r: any) => r.action === "screenshots.transfers",
          ).length,
      ),
    )
    .toBeGreaterThan(2);
  await expect(
    page.locator(".shot-notifications .shot-request-card"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).shotSounds)).toHaveLength(0);
  await nav(page, "Screenshots").click();
  const request = page.locator(".shot-page-requests .shot-request-card");
  await expect(request).toContainText("Alice");
  await request.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(request).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).shotSounds)).toHaveLength(0);
});

test("reply notifications stay acknowledged after restarting the UI", async ({
  page,
}) => {
  await fixture(page);
  const receivedReply = () =>
    page.evaluate(() => {
      const w = window as any;
      w.shotTransfers = [
        {
          ...w.shotItems[0],
          id: "persisted-reply",
          batch: "persisted-batch",
          count: 1,
          peer: `aur1${"b".repeat(59)}`,
          direction: "outgoing",
          status: "delivered",
          decision: true,
          transferred: 1024,
          error: null,
        },
      ];
    });
  await nav(page, "Friends").click();
  await receivedReply();
  await expect(page.locator(".shot-notice")).toContainText(
    "Screenshots accepted",
  );
  await page.reload();
  await nav(page, "Friends").click();
  await receivedReply();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).shotRequests.filter(
            (r: any) => r.action === "screenshots.transfers",
          ).length,
      ),
    )
    .toBeGreaterThan(2);
  await expect(page.locator(".shot-notice")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).shotSounds)).toHaveLength(0);
});

test("declining a request never adds received images", async ({ page }) => {
  await fixture(page);
  await nav(page, "Screenshots").click();
  await page.evaluate(() => {
    const w = window as any;
    w.shotTransfers = [
      {
        ...w.shotItems[0],
        id: "decline-me",
        batch: "declined",
        count: 1,
        peer: `aur1${"b".repeat(59)}`,
        direction: "incoming",
        status: "requested",
        decision: null,
        transferred: 0,
        error: null,
      },
    ];
  });
  const request = page.locator(".shot-page-requests .shot-request-card");
  await expect(request).toContainText("1 screenshot");
  await request.getByRole("button", { name: "Decline", exact: true }).click();
  await expect(request).toHaveCount(0);
  await page.getByRole("button", { name: "From friends", exact: true }).click();
  await expect(page.locator(".screenshot-card")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (window as any).shotRequests
        .filter((r: any) => r.action === "screenshots.decide")
        .map((r: any) => r.payload),
    ),
  ).toEqual([{ batch: "declined", accept: false }]);
  expect(
    await page.evaluate(() => (window as any).shotTransfers[0].status),
  ).toBe("rejected");
});

test("global screenshot library sits below the catalog and filters, sorts and groups", async ({
  page,
}) => {
  await fixture(page);
  await nav(page, "Screenshots").click();
  const names = await page
    .getByRole("navigation")
    .getByRole("button")
    .allTextContents();
  expect(names.findIndex((name) => name.trim() === "Screenshots")).toBe(
    names.findIndex((name) => name.trim() === "Browse projects") + 1,
  );
  await expect(page.locator(".screenshot-card")).toHaveCount(12);
  await page.getByRole("combobox", { name: "Instance", exact: true }).click();
  await page
    .getByRole("option", { name: "Adventure world", exact: true })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(5);
  await page.getByRole("combobox", { name: "Sort screenshots" }).click();
  await page.getByRole("option", { name: "Oldest first", exact: true }).click();
  await expect(page.locator(".shot-select").first()).toHaveAttribute(
    "aria-label",
    "2026-11-08_12.00.00.png",
  );
  await page
    .getByRole("textbox", { name: "Search screenshots" })
    .fill("2026-11-10");
  await expect(page.locator(".screenshot-card")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Search screenshots" })
    .fill("missing screenshot");
  await expect(
    page.getByRole("heading", { name: "No matching screenshots" }),
  ).toBeVisible();
});

test("instance screenshots tab is between Content and Settings and only requests its instance", async ({
  page,
}) => {
  await fixture(page);
  await nav(page, "My instances").click();
  await page
    .getByRole("button", { name: "Open Vanilla world", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Screenshots", exact: true })
    .last()
    .click();
  const labels = await page
    .locator(".instance-page > .tabs button")
    .allTextContents();
  expect(labels.map((label) => label.trim())).toEqual([
    "Content",
    "Screenshots",
    "Settings",
    "Log",
  ]);
  await expect(page.locator(".screenshot-card")).toHaveCount(7);
  const requests = await page.evaluate(() =>
    (window as any).shotRequests.filter(
      (r: any) => r.action === "screenshots.list",
    ),
  );
  expect(requests.at(-1).payload.profileId).toBe(
    "11111111-1111-4111-8111-111111111111",
  );
});

for (const theme of ["dark", "light"]) {
  test(`offline friend picker selects at most ten and preserves selection while zooming (${theme})`, async ({
    page,
  }) => {
    await fixture(page, theme);
    await page.setViewportSize({ width: 960, height: 680 });
    await nav(page, "Friends").click();
    const share = page.getByRole("button", {
      name: "Send screenshots: Alice",
      exact: true,
    });
    await expect(share).toBeEnabled();
    const left = await share.boundingBox();
    const invite = await page
      .getByRole("button", { name: "Invite", exact: true })
      .boundingBox();
    if (left && invite) expect(left.x).toBeLessThan(invite.x);
    await share.click();
    const dialog = page.getByRole("dialog", { name: "Screenshots for Alice" });
    await expect(
      dialog.getByRole("button", { name: "Send 0 screenshots", exact: true }),
    ).toBeDisabled();
    const shots = dialog.locator(".shot-select");
    await expect(shots).toHaveCount(12);
    for (let i = 0; i < 10; i++) await shots.nth(i).click();
    await expect(
      dialog.getByText("Selected: 10 / 10", { exact: true }),
    ).toBeVisible();
    await expect(shots.nth(10)).toBeDisabled();
    await shots.nth(3).click();
    await expect(shots.nth(10)).toBeEnabled();
    await shots.nth(10).click();
    const inspect = dialog.locator(".shot-inspect").nth(10);
    await inspect.scrollIntoViewIfNeeded();
    await inspect.hover();
    await expect(inspect).toHaveCSS("opacity", "1");
    await inspect.click();
    await expect(page.locator("[data-image-lightbox] img")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Selected: 10 / 10", { exact: true }),
    ).toBeVisible();
    await dialog
      .locator(".screenshot-picker-scroll")
      .evaluate((element) => element.scrollTo(0, 0));
    await page.screenshot({
      path: `.test-data/screenshots/screenshot-picker-${theme}.png`,
      animations: "disabled",
    });
    await dialog
      .getByRole("button", { name: "Send 10 screenshots", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const sends = await page.evaluate(() =>
      (window as any).shotRequests.filter(
        (r: any) => r.action === "screenshots.send",
      ),
    );
    expect(sends).toHaveLength(1);
    expect(sends[0].payload.ids).toHaveLength(10);
    const calls = await page.evaluate(() =>
      (window as any).shotRequests.map((r: any) => r.action),
    );
    expect(calls).not.toContain("social.enable");
    await nav(page, "Screenshots").click();
    await page.getByRole("button", { name: "Deliveries", exact: true }).click();
    await expect(page.locator(".shot-delivery")).toHaveCount(10);
    await expect(page.locator(".shot-deliveries")).toContainText(
      "Waiting for connection",
    );
    await page.getByRole("button", { name: "Cancel delivery" }).first().click();
    await expect(page.locator(".shot-delivery.cancelled")).toHaveCount(1);
  });
}
test("empty libraries explain Minecraft F2", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => ((window as any).shotItems = []));
  await nav(page, "Screenshots").click();
  await expect(
    page.getByText("Take a screenshot in Minecraft with F2.", { exact: false }),
  ).toBeVisible();
});

test("received screenshots are independent of local filters and can be removed", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.shotTransfers = [
      {
        ...w.shotItems[0],
        id: "received1",
        batch: "batch1",
        peer: `aur1${"b".repeat(59)}`,
        direction: "incoming",
        status: "received",
        transferred: 1024,
        error: null,
      },
    ];
  });
  await nav(page, "Screenshots").click();
  await page.getByRole("combobox", { name: "Instance", exact: true }).click();
  await page
    .getByRole("option", { name: "Adventure world", exact: true })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(5);
  await page
    .getByRole("button", { name: "From friends", exact: false })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(1);
  await expect(page.locator(".shot-caption")).toContainText("Alice");
  await page.locator(".screenshot-card").hover();
  await page.locator(".shot-remove").click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete received screenshot", exact: true })
    .click();
  await expect(page.locator(".screenshot-card")).toHaveCount(0);
});

test("a missing screenshot preview preserves the picker and its selection", async ({
  page,
}) => {
  await fixture(page);
  await nav(page, "Friends").click();
  await page
    .getByRole("button", { name: "Send screenshots: Alice", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Screenshots for Alice" });
  await picker.locator(".shot-select").first().click();
  await page.evaluate(() => {
    (window as any).shotImageFail = true;
  });
  await picker.locator(".shot-inspect").first().click();
  await expect(
    page.getByText("Screenshot no longer exists", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    picker.getByText("Selected: 1 / 10", { exact: true }),
  ).toBeVisible();
});

test("paging preloads nearby screenshots and keeps the picture visible during a slow read", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.holdShotImage = w.shotItems[8].id;
  });
  await nav(page, "Screenshots").click();
  await page.locator(".shot-select").nth(2).click();
  const viewer = page.locator("[data-image-lightbox]");
  const image = viewer.locator(".lightbox-picture img");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseShotImage))
    .toBe("function");
  await expect(image).toBeVisible();
  const original = await image.getAttribute("src");
  await page.keyboard.press("ArrowRight");
  await expect(
    viewer.locator(".lightbox-toolbar button").last(),
  ).not.toBeFocused();
  await expect(image).toHaveAttribute("src", original!);
  await expect(viewer.locator(".lightbox-message")).toHaveCount(0);
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 3 of 12",
  );
  await page.evaluate(() => {
    (window as any).releaseShotImage();
    (window as any).holdShotImage = null;
  });
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 4 of 12",
  );
  await expect(image).not.toHaveAttribute("src", original!);
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 3 of 12",
  );
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 4 of 12",
  );
  expect(
    await page.evaluate(() => {
      const w = window as any;
      return w.shotRequests.filter(
        (r: any) =>
          r.action === "screenshots.image" &&
          !r.payload.thumbnail &&
          r.payload.id === w.shotItems[8].id,
      ).length;
    }),
  ).toBe(1);
  await expect(
    viewer.getByText("Loading screenshot…", { exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  const search = page.locator(".shot-search input");
  await search.click();
  await expect(search).toHaveCSS("outline-style", "none");
});

test("viewer uses all screenshots, keyboard paging and unobtrusive side arrows", async ({
  page,
}) => {
  await fixture(page);
  await nav(page, "Screenshots").click();
  await page.locator(".shot-select").nth(2).click();
  const viewer = page.locator("[data-image-lightbox]");
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 3 of 12",
  );
  await expect(viewer.locator(".lightbox-picture img")).toBeVisible();
  const requests = await page.evaluate(() =>
    (window as any).shotRequests.filter(
      (r: any) => r.action === "screenshots.image" && !r.payload.thumbnail,
    ),
  );
  expect(
    new Set(
      requests.map(
        (request: { payload: { id: string } }) => request.payload.id,
      ),
    ).size,
  ).toBeLessThanOrEqual(4);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 4 of 12",
  );
  await expect(viewer.locator(".lightbox-slide.entering")).toHaveCSS(
    "animation-name",
    "lightbox-enter",
  );
  await viewer
    .getByRole("button", { name: "Previous image", exact: true })
    .click();
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 3 of 12",
  );
  await expect(viewer.locator(".lightbox-arrow").first()).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(viewer.locator(".lightbox-arrow").first()).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("combobox", { name: "Instance", exact: true }).click();
  await page
    .getByRole("option", { name: "Adventure world", exact: true })
    .click();
  await page.locator(".shot-select").nth(1).click();
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 2 of 5",
  );
});

test("viewer dismisses clicks in letterboxing instead of treating it as the image", async ({
  page,
}) => {
  await fixture(page);
  await nav(page, "Screenshots").click();
  await page.locator(".shot-select").first().click();
  const viewer = page.locator("[data-image-lightbox]");
  const image = viewer.locator(".lightbox-picture img");
  await expect(image).toBeVisible();
  await expect
    .poll(async () => (await image.boundingBox())!.width)
    .toBeGreaterThan(1000);
  const bounds = (await image.boundingBox())!;
  const hitbox = (await viewer.locator(".lightbox-picture").boundingBox())!;
  expect(Math.abs(hitbox.height - bounds.height)).toBeLessThan(1);
  const stage = (await viewer.locator(".lightbox-stage").boundingBox())!;
  expect(bounds.y - stage.y).toBeGreaterThan(10);
  await page.mouse.click(stage.x + stage.width / 2, stage.y + 3);
  await expect(viewer).toHaveCount(0);
});

test("wheel zoom caps at fifty, shows multipliers and leaves left click for panning", async ({
  page,
}) => {
  await fixture(page);
  await nav(page, "Screenshots").click();
  await page.locator(".shot-select").first().click();
  const viewer = page.locator("[data-image-lightbox]");
  const picture = viewer.locator(".lightbox-picture");
  await expect(picture.locator("img")).toBeVisible();
  await expect
    .poll(async () => (await picture.boundingBox())!.width)
    .toBeGreaterThan(1000);
  await expect(picture).toHaveCSS("cursor", "default");
  await picture.click({ position: { x: 300, y: 250 } });
  await expect(viewer).toHaveAttribute("data-scale", "1");
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(viewer).toHaveAttribute("data-scale", "2");
  await expect(viewer.locator(".lightbox-scale")).toHaveText("×2.0");
  await expect(viewer.locator(".lightbox-scale")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(viewer.locator(".lightbox-scale")).toHaveCSS(
    "font-weight",
    "600",
  );
  await expect(viewer.locator(".lightbox-scale")).toHaveCSS(
    "font-size",
    "28px",
  );
  await expect(viewer.locator(".lightbox-scale")).toHaveCSS(
    "text-shadow",
    "none",
  );
  const x = () =>
    picture.evaluate(
      (element) => new DOMMatrix(getComputedStyle(element).transform).m41,
    );
  expect(await x()).toBe(0);
  const stage = (await viewer.locator(".lightbox-stage").boundingBox())!;
  const indicator = (await viewer.locator(".lightbox-scale").boundingBox())!;
  expect(
    Math.abs(indicator.x + indicator.width / 2 - (stage.x + stage.width / 2)),
  ).toBeLessThan(1);
  expect(
    Math.abs(indicator.y + indicator.height / 2 - (stage.y + stage.height / 2)),
  ).toBeLessThan(1);
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  const browserScale = await page.evaluate(() => window.visualViewport!.scale);
  await page.mouse.wheel(0, -1200);
  await expect
    .poll(async () => Number(await viewer.getAttribute("data-scale")))
    .toBeGreaterThan(10);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(
    browserScale,
  );
  await expect(viewer.locator(".lightbox-scale")).toBeVisible();
  await page.mouse.wheel(0, -10000);
  await expect(viewer).toHaveAttribute("data-scale", "50");
  await expect(viewer.locator(".lightbox-scale")).toHaveText("×50.0");
  await page.mouse.wheel(0, -10000);
  await expect(viewer).toHaveAttribute("data-scale", "50");
  await page.screenshot({
    path: ".test-data/screenshots/viewer-multiplier.png",
    animations: "disabled",
  });
  await expect(picture).toHaveCSS("cursor", "grab");
  const before = await x();
  await page.mouse.down();
  await expect(picture).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(
    stage.x + stage.width / 2 + 70,
    stage.y + stage.height / 2 + 30,
    { steps: 5 },
  );
  await page.mouse.up();
  expect((await x()) - before).toBeCloseTo(70, 0);
  await expect(viewer.locator(".lightbox-scale")).toHaveCount(0, {
    timeout: 3000,
  });
  await page.keyboard.press("Control+0");
  await expect(viewer).toHaveAttribute("data-scale", "1");
  expect(await x()).toBe(0);
  await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
  await viewer
    .getByRole("button", { name: "Reset zoom (Ctrl+0)", exact: true })
    .click();
  await expect(viewer).toHaveAttribute("data-scale", "1");
  await page.screenshot({
    path: ".test-data/screenshots/viewer-fit.png",
    animations: "disabled",
  });
});

test("paging reaches images beyond the thumbnail page", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    const source = w.shotItems[0];
    w.shotItems = Array.from({ length: 85 }, (_, i) => ({
      ...source,
      id: `local:${source.profileId}:shot${i}`,
      name: `screenshot-${i}.png`,
      createdAt: source.createdAt + i * 1000,
    }));
  });
  await nav(page, "Screenshots").click();
  await expect(page.locator(".shot-select")).toHaveCount(80);
  await page.locator(".shot-select").nth(79).click();
  const viewer = page.locator("[data-image-lightbox]");
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 80 of 85",
  );
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 81 of 85",
  );
});

for (const theme of ["dark", "light"]) {
  test(`screenshot context menu copies, saves and dismisses without zooming (${theme})`, async ({
    page,
  }) => {
    await fixture(page, theme);
    await nav(page, "Screenshots").click();
    await page.locator(".shot-select").first().click();
    const viewer = page.locator("[data-image-lightbox]");
    const picture = viewer.locator(".lightbox-picture");
    await expect(picture.locator("img")).toBeVisible();
    await picture.click({ button: "right", position: { x: 300, y: 200 } });
    const menu = viewer.getByRole("menu", { name: "Screenshot actions" });
    await expect(menu).toBeVisible();
    await expect(viewer).toHaveAttribute("data-scale", "1");
    await expect(
      menu.getByRole("menuitem", { name: "Copy screenshot" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      menu.getByRole("menuitem", { name: "Save as…" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(viewer).toBeVisible();
    const copy = viewer.getByRole("button", {
      name: "Copy screenshot",
      exact: true,
    });
    const zoom = viewer.getByRole("button", { name: "Zoom in", exact: true });
    expect((await copy.boundingBox())!.x).toBeLessThan(
      (await zoom.boundingBox())!.x,
    );
    await copy.click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).shotRequests.filter(
              (r: any) => r.action === "screenshots.copy",
            ).length,
        ),
      )
      .toBe(1);
    const expected = await page.evaluate(
      () => (window as any).shotItems[11].id,
    );
    expect(
      await page.evaluate(
        () =>
          (window as any).shotRequests.find(
            (r: any) => r.action === "screenshots.copy",
          ).payload.id,
      ),
    ).toBe(expected);
    await picture.click({ button: "right", position: { x: 300, y: 200 } });
    await menu.getByRole("menuitem", { name: "Copy screenshot" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).shotRequests.filter(
              (r: any) => r.action === "screenshots.copy",
            ).length,
        ),
      )
      .toBe(2);
    await picture.click({ button: "right", position: { x: 300, y: 200 } });
    await page.screenshot({
      path: ".test-data/screenshots/context-menu-" + theme + ".png",
      animations: "disabled",
    });
    await menu.getByRole("menuitem", { name: "Save as…" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as any).shotRequests.filter(
              (r: any) => r.action === "screenshots.save",
            ).length,
        ),
      )
      .toBe(1);
    await expect(menu).toHaveCount(0);
    await expect(viewer).toHaveAttribute("data-scale", "1");
    await picture.click({ button: "right", position: { x: 300, y: 200 } });
    await page.keyboard.press("ArrowRight");
    await expect(menu).toHaveCount(0);
    await expect(viewer.locator(".lightbox-toolbar")).toContainText(
      "Image 2 of 12",
    );
  });
}

test("copy acts on the visible frame during a slow read and reports errors", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.holdShotImage = w.shotItems[8].id;
  });
  await nav(page, "Screenshots").click();
  await page.locator(".shot-select").nth(2).click();
  const viewer = page.locator("[data-image-lightbox]");
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).releaseShotImage))
    .toBe("function");
  await page.keyboard.press("ArrowRight");
  await viewer
    .getByRole("button", { name: "Copy screenshot", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).shotRequests.find(
          (r: any) => r.action === "screenshots.copy",
        ).payload.id,
    ),
  ).toBe(await page.evaluate(() => (window as any).shotItems[9].id));
  await page.evaluate(() => {
    const w = window as any;
    w.releaseShotImage();
    w.holdShotImage = null;
    w.shotCopyError = "Clipboard is busy";
  });
  await expect(viewer.locator(".lightbox-toolbar")).toContainText(
    "Image 4 of 12",
  );
  await viewer
    .getByRole("button", { name: "Copy screenshot", exact: true })
    .click();
  await expect(viewer.getByRole("status")).toContainText("Clipboard is busy");
  await expect(viewer).toBeVisible();
});

test("received screenshots support edge-clamped menus and cancelling Save as", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    const w = window as any;
    w.shotSaveResult = false;
    w.shotTransfers = [
      {
        ...w.shotItems[0],
        id: "received1",
        batch: "batch1",
        peer: `aur1${"b".repeat(59)}`,
        direction: "incoming",
        status: "received",
        transferred: 1024,
        error: null,
      },
    ];
  });
  await nav(page, "Screenshots").click();
  await page
    .getByRole("button", { name: "From friends", exact: false })
    .click();
  await page.locator(".shot-select").click();
  const viewer = page.locator("[data-image-lightbox]");
  const picture = viewer.locator(".lightbox-picture");
  await expect
    .poll(async () => (await picture.boundingBox())!.width)
    .toBeGreaterThan(1000);
  await viewer
    .getByRole("button", { name: "Copy screenshot", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).shotRequests.find(
            (r: any) => r.action === "screenshots.copy",
          )?.payload.id,
      ),
    )
    .toBe("received:received1");
  const bounds = (await picture.boundingBox())!;
  await picture.click({
    button: "right",
    position: { x: bounds.width - 3, y: bounds.height - 3 },
  });
  const menu = viewer.getByRole("menu");
  const menuBounds = (await menu.boundingBox())!;
  expect(menuBounds.x + menuBounds.width).toBeLessThanOrEqual(
    page.viewportSize()!.width - 7,
  );
  expect(menuBounds.y + menuBounds.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 7,
  );
  await menu.getByRole("menuitem", { name: "Save as…" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).shotRequests.find(
            (r: any) => r.action === "screenshots.save",
          )?.payload.id,
      ),
    )
    .toBe("received:received1");
  await expect(page.locator(".toast")).not.toContainText("Screenshot saved");
  await expect(viewer).toBeVisible();
  await picture.click({ button: "right", position: { x: 300, y: 200 } });
  await picture.click({ position: { x: 30, y: 30 } });
  await expect(menu).toHaveCount(0);
  await expect(viewer).toBeVisible();
});

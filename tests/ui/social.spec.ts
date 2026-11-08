// UI contract fixtures only. Network/isolation evidence comes from the native labs.
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const avatarFixture =
  "data:image/jpeg;base64," +
  readFileSync("crates/aurum-social-worker/src/fixtures/avatar.jpg").toString(
    "base64",
  );
async function fixture(
  page: Page,
  enabled = false,
  theme = "dark",
  language = "en",
) {
  await page.addInitScript(
    ({ enabled, theme, language }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const state = {
        profiles: [
          {
            id: "vanilla",
            name: "Vanilla test",
            minecraft: "1.21.1",
            loader: "vanilla",
            loaderVersion: null,
            installedVersion: "1.21.1",
            content: [],
            cover: 0,
          },
        ],
        accounts: [{ id: "player", name: "Player", kind: "offline" }],
        selectedAccount: "player",
        running: ["vanilla"],
        dataDir: "C:/test-only",
        serverManager: true,
        settings: {
          language,
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
        enabled,
        status: enabled ? "online" : "disabled",
        error: null,
        id: enabled ? `aur1${"a".repeat(59)}` : null,
        name: "Player",
        contactLink: null,
        privacy: {
          incomingRequests: true,
          shareActivity: false,
          publicRelays: true,
          invisible: false,
          notifications: true,
        },
        people: [] as any[],
        online: [],
        activity: {},
        activeTunnels: 0,
        invitations: [] as any[],
      };
      const callbacks = new Map<number, Function>();
      const events = new Map<string, Function>();
      let next = 1;
      w.socialRequests = [];
      w.socialState = state;
      w.statePatch = (patch: any) => {
        Object.assign(state, patch);
        events.get("aurum:event")?.({
          event: "aurum:event",
          payload: {
            id: "fixture",
            phase: "running",
            message: "",
            done: 0,
            total: 0,
          },
        });
      };
      w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      w.socialPatch = (patch: any) => {
        Object.assign(social, patch);
        events.get("social:event")?.({ event: "social:event", payload: null });
      };
      w.socialEmit = (name: string) =>
        events.get(name)?.({ event: name, payload: null });
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
          w.socialRequests.push({ action, payload });
          if (action === "snapshot") return structuredClone(state);
          if (action === "social.snapshot") {
            if (w.socialSnapshotWait) {
              await new Promise<void>(
                (resolve) => (w.finishSnapshot = resolve),
              );
              w.socialSnapshotWait = false;
            }
            return structuredClone(social);
          }
          if (action === "social.takeLink") return null;
          if (action === "selectAccount") {
            state.selectedAccount = payload.id;
            return null;
          }
          if (action === "addOffline") {
            const account = {
              id: "added",
              name: payload.name,
              kind: "offline",
            };
            state.accounts.push(account);
            return account;
          }
          if (action === "social.prepare") {
            if (w.socialPrepareWait)
              await new Promise<void>((resolve) => (w.finishPrepare = resolve));
            return payload.profileId || "new-instance";
          }
          if (action === "install" && w.externalDownloadWait)
            await new Promise<void>((resolve) => (w.finishExternal = resolve));
          if (action === "social.join" && w.socialJoinFail)
            throw "World connection timed out";
          if (action === "social.join")
            return { automatic: w.manualLanFallback !== true };
          if (action === "social.launchState")
            return { state: w.lanLaunchState || "connecting" };
          if (action === "social.invite" && w.socialInviteFail)
            throw "Invitation was not delivered. Check that your friend is online and try again.";
          if (action === "social.restoreIdentity" && w.socialRestoreCancel)
            return false;
          if (action === "takeServerShortcut") return null;
          if (action === "social.pending") return [];
          if (action === "social.lanListeners")
            return [{ pid: 123, creationTime: 1, address: "127.0.0.1:60413" }];
          if (action === "social.exportManifest")
            return {
              manifest: { files: [] },
              excluded: [],
              potentialSecrets: [],
            };
          if (
            action === "social.restoreIdentity" ||
            action === "social.chooseAvatar"
          )
            return true;
          if (action === "social.configureFirewall") return null;
          if (action === "social.runtimeStatus")
            return {
              installed: w.runtimeInstalled === true,
              downloading: !!w.finishRuntime,
              done: w.finishRuntime ? 50 : 0,
              total: w.finishRuntime ? 100 : 0,
            };
          if (action === "social.installRuntime") {
            if (w.runtimeWait)
              await new Promise<void>((resolve, reject) => {
                w.finishRuntime = () => {
                  w.finishRuntime = null;
                  resolve();
                };
                w.cancelRuntime = () => {
                  w.finishRuntime = null;
                  reject("Download cancelled");
                };
              });
            w.runtimeInstalled = true;
            return null;
          }
          if (action === "social.cancelRuntime") {
            w.cancelRuntime?.();
            return null;
          }
          if (action === "social.firewallStatus")
            return [{ present: true, scoped: !w.socialFirewallOutdated }];
          if (action === "social.enable") {
            social.enabled = true;
            social.status = "online";
            social.id = `aur1${"a".repeat(59)}`;
            return null;
          }
          if (action === "social.disable") {
            social.enabled = false;
            social.invitations = [];
            return null;
          }
          if (action === "social.relationship") {
            social.people = social.people.filter((p) => p.id !== payload.id);
            return null;
          }
          if (action === "social.privacy") {
            social.privacy = payload.privacy;
            return null;
          }
          if (action === "social.dismissInvite") {
            social.invitations = [];
            return null;
          }
          if (action === "social.plan")
            return {
              id: "b".repeat(64),
              plan: {
                world: social.invitations[0].offer.world,
                warnings: [],
                items: [
                  {
                    path: "mods/untrusted-<script>.jar",
                    name: "Untrusted mod",
                    bytes: 1234,
                    source: null,
                    config: null,
                    required: false,
                  },
                ],
              },
            };
          if (action === "social.install")
            return { profileId: "test-new-instance", missing: 1 };
          if (action === "search") return { total: 0, projects: [] };
          return [];
        },
      };
    },
    { enabled, theme, language },
  );
  await page.goto("/");
  await page
    .getByRole("button", {
      name: language === "ru" ? "Друзья" : "Friends",
      exact: true,
    })
    .click();
}
test("Russian Friends navigation stays translated", async ({ page }) => {
  await fixture(page, false, "light", "ru");
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Друзья", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "Friends", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Друзья", level: 1 }),
  ).toBeVisible();
});
test("fresh install requires explicit P2P and scoped Firewall consent", async ({
  page,
}) => {
  await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Meet in Aurum" }),
  ).toBeVisible();
  const calls = () =>
    page.evaluate(() =>
      (window as any).socialRequests
        .filter((r: any) => r.action.startsWith("social."))
        .map((r: any) => r.action),
    );
  expect(await calls()).not.toContain("social.enable");
  expect(await calls()).not.toContain("social.configureFirewall");
  expect(await calls()).not.toContain("social.installRuntime");
  await page
    .getByRole("button", { name: "Enable Social", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("button", { name: "Enable Social", exact: true }),
  ).toBeDisabled();
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Enable Social", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn off Social", exact: true }),
  ).toBeVisible();
  const actions = await calls();
  expect(actions.indexOf("social.installRuntime")).toBeLessThan(
    actions.indexOf("social.configureFirewall"),
  );
  expect(actions.indexOf("social.configureFirewall")).toBeLessThan(
    actions.indexOf("social.enable"),
  );
  await page
    .getByRole("button", { name: "Turn off Social", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Turn off Social?" }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Turn off Social", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Social is offline" }),
  ).toBeVisible();
});
test("Social download shows progress, cancels safely and can be retried", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).runtimeWait = true;
  });
  await page
    .getByRole("button", { name: "Enable Social", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(modal).toContainText("downloads on first use");
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Enable Social", exact: true })
    .click();
  await expect(modal.getByRole("progressbar")).toHaveAttribute("value", "50");
  await page.screenshot({ path: ".test-data/screenshots/social-download.png" });
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "Enable Social", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (window as any).socialRequests.some(
        (r: any) => r.action === "social.configureFirewall",
      ),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).runtimeWait = false;
  });
  await modal
    .getByRole("button", { name: "Enable Social", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn off Social", exact: true }),
  ).toBeVisible();
});

for (const theme of ["dark", "light"]) {
  test(`incoming requests queue, trap focus and keep peer text inert (${theme})`, async ({
    page,
  }) => {
    await fixture(page, true, theme);
    await page.evaluate(() => {
      (window as any).socialPatch({
        people: [
          {
            id: `aur1${"b".repeat(59)}`,
            name: "<img src=x onerror=alert(1)>",
            state: "incoming",
            updated: 1,
          },
          {
            id: `aur1${"c".repeat(59)}`,
            name: "Second friend",
            state: "incoming",
            updated: 2,
          },
        ],
      });
    });
    let modal = page.getByRole("dialog");
    await expect(modal).toHaveCount(1);
    await expect(
      modal.getByText("<img src=x onerror=alert(1)>", { exact: true }),
    ).toBeVisible();
    await expect(modal.locator("img")).toHaveCount(0);
    expect(
      await page.locator("#root").evaluate((e) => (e as HTMLElement).inert),
    ).toBe(true);
    await modal.getByRole("button", { name: "Accept", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(
      modal.getByRole("button", { name: "Close dialog" }),
    ).toBeFocused();
    await page.screenshot({
      path: `.test-data/screenshots/social-request-${theme}.png`,
    });
    await modal.getByRole("button", { name: "Decline", exact: true }).click();
    modal = page.getByRole("dialog");
    await expect(
      modal.getByText("Second friend", { exact: true }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "Block", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.locator("#root").evaluate((e) => (e as HTMLElement).inert),
    ).toBe(false);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}
test("world pack review requires source trust before creating a separate instance", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    const id = `aur1${"b".repeat(59)}`;
    (window as any).socialPatch({
      people: [{ id, name: "Friend", state: "friend", updated: 1 }],
      invitations: [
        {
          from: id,
          status: "pending",
          manifest: { files: [] },
          joinAddress: null,
          offer: {
            id: "a".repeat(32),
            expires: Math.floor(Date.now() / 1000) + 120,
            world: {
              name: "Friend world",
              minecraft: "1.21.1",
              loader: "fabric",
              loaderVersion: "0.16.9",
            },
            manifestHash: "b".repeat(64),
            manifestBytes: 100,
            files: 1,
            downloadBytes: 1234,
          },
        },
      ],
    });
  });
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Review contents" }),
  ).toHaveCount(0);
  await modal.locator(".social-contents summary").click();
  await expect(modal.getByText("mods/untrusted-<script>.jar")).toBeVisible();
  await expect(modal.locator("script")).toHaveCount(0);
  await expect(
    modal.getByRole("button", { name: "Download and open" }),
  ).toBeDisabled();
  await modal.getByRole("checkbox").check();
  await modal.getByRole("button", { name: "Download and open" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).socialRequests.filter(
            (r: any) => r.action === "social.install",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.find(
          (r: any) => r.action === "social.install",
        ).payload.accepted,
    ),
  ).toBe(true);
});
for (const theme of ["light", "dark"]) {
  test(`compact friends and invitation flow at 960px (${theme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 960, height: 780 });
    await fixture(page, true, theme, "ru");
    const id = `aur1${"b".repeat(59)}`;
    await page.evaluate(
      (id) =>
        (window as any).socialPatch({
          error: "Peer action has no fresh challenge",
          people: [
            {
              id,
              name: "Очень длинный ник друга проверяет переносы строк",
              state: "friend",
              updated: 1,
            },
          ],
          online: [id],
        }),
      id,
    );
    await expect(
      page.getByText("Peer action has no fresh challenge"),
    ).toHaveCount(0);
    await expect(page.locator(".social-id-value")).not.toBeVisible();
    await page
      .getByRole("button", { name: "Показать Aurum ID", exact: true })
      .click();
    await expect(page.locator(".social-id-value")).toContainText("aur1");
    await page
      .getByRole("button", { name: "Скрыть Aurum ID", exact: true })
      .click();
    const row = page.locator("article.social-person");
    await expect(row).not.toContainText(id);
    await expect(
      row.getByRole("button", { name: "Удалить друга" }),
    ).toHaveCount(0);
    const avatar = row.locator(".social-avatar");
    expect((await row.boundingBox())!.height).toBeLessThan(110);
    await expect(avatar.locator(".online")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Восстановить личность", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: `.test-data/screenshots/social-compact-${theme}.png`,
    });
    await row.getByRole("button", { name: /Действия:/ }).click();
    await expect(
      page.getByRole("menuitem", { name: "Удалить друга" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: "Пригласить", exact: true }).click();
    const modal = page.getByRole("dialog");
    await expect(
      modal.getByRole("button", { name: "Отправить приглашение", exact: true }),
    ).toBeEnabled();
    await modal
      .getByRole("button", { name: "Со сборкой", exact: true })
      .click();
    await expect(
      modal.getByRole("button", { name: "Отправить приглашение", exact: true }),
    ).toBeEnabled();
    await modal
      .getByRole("checkbox", { name: "Передать настройки модов", exact: true })
      .check();
    const label = modal.locator(".social-check").first();
    const box = await label.locator("input").boundingBox(),
      text = await label.locator("span").boundingBox();
    expect(text!.x - box!.x - box!.width).toBeGreaterThanOrEqual(9);
    expect(Math.abs(text!.y - box!.y)).toBeLessThanOrEqual(3);
    await expect(
      modal.getByRole("button", { name: "Посмотреть состав", exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: `.test-data/screenshots/social-host-${theme}.png`,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await modal
      .getByRole("button", { name: "Отправить приглашение", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as any).socialRequests.filter(
            (r: any) => r.action === "social.invite",
          ).length,
      ),
    ).toBe(1);
  });
}
test("presence, avatar picker and disabling preserve explicit user choices", async ({
  page,
}) => {
  await fixture(page, true);
  await page.getByRole("combobox", { name: "Status", exact: true }).click();
  await page.getByRole("option", { name: "Invisible", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Invisible");
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.find(
          (r: any) => r.action === "social.privacy",
        ).payload.privacy.invisible,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Choose avatar", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.filter(
          (r: any) => r.action === "social.chooseAvatar",
        ).length,
    ),
  ).toBe(1);
  await page
    .getByRole("button", { name: "Turn off Social", exact: true })
    .click();
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.filter(
          (r: any) => r.action === "social.disable",
        ).length,
    ),
  ).toBe(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn off Social", exact: true }),
  ).toBeVisible();
});
test("request notifications fire once and respect the notification preference", async ({
  page,
}) => {
  await fixture(page, true);
  const person = {
    id: `aur1${"b".repeat(59)}`,
    name: "Friend",
    state: "incoming",
    updated: 1,
  };
  await page.evaluate(
    (person) => (window as any).socialPatch({ people: [person] }),
    person,
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).socialRequests.filter(
            (r: any) => r.action === "social.notify",
          ).length,
      ),
    )
    .toBe(1);
  await page.evaluate(
    (person) => (window as any).socialPatch({ people: [person] }),
    person,
  );
  await page.waitForTimeout(600);
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.filter(
          (r: any) => r.action === "social.notify",
        ).length,
    ),
  ).toBe(1);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Decline", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: "Sounds and notifications", exact: true })
    .uncheck();
  await page.evaluate(
    (person) =>
      (window as any).socialPatch({
        people: [{ ...person, id: `aur1${"c".repeat(59)}` }],
      }),
    person,
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.filter(
          (r: any) => r.action === "social.notify",
        ).length,
    ),
  ).toBe(1);
});
test("an undelivered invitation stays open for retry instead of showing success", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    (window as any).socialInviteFail = true;
    (window as any).socialPatch({
      people: [
        {
          id: `aur1${"b".repeat(59)}`,
          name: "Friend",
          state: "friend",
          updated: 1,
        },
      ],
    });
  });
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Send invitation", exact: true })
    .click();
  await expect(
    page.getByText(
      "Invitation was not delivered. Check that your friend is online and try again.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Send invitation", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("Invitation received by your friend’s launcher", {
      exact: true,
    }),
  ).toHaveCount(0);
});
test("cancelling the native restore picker keeps the dialog and active identity", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => ((window as any).socialRestoreCancel = true));
  await page
    .getByRole("button", { name: "Restore identity", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await modal.getByRole("textbox").fill("test-passphrase");
  await modal
    .getByRole("button", { name: "Choose backup", exact: true })
    .click();
  await expect(modal).toBeVisible();
  await expect(
    modal.getByRole("button", { name: "Choose backup", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () =>
        (window as any).socialRequests.filter(
          (r: any) => r.action === "social.disable",
        ).length,
    ),
  ).toBe(0);
});
async function worldInvite(page: Page, patch: Record<string, unknown> = {}) {
  await page.evaluate(
    ({ patch, avatar }) => {
      const w = window as any;
      w.statePatch({ running: [], ...patch });
      w.socialPatch({
        people: [
          {
            id: `aur1${"b".repeat(59)}`,
            name: "Alex",
            state: "friend",
            updated: 1,
            avatar,
          },
        ],
        invitations: [
          {
            from: `aur1${"b".repeat(59)}`,
            status: "pending",
            manifest: null,
            joinAddress: null,
            offer: {
              id: "d".repeat(32),
              expires: Math.floor(Date.now() / 1000) + 1800,
              world: {
                name: "Survival",
                minecraft: "1.21.1",
                loader: "vanilla",
                loaderVersion: null,
              },
              manifestHash: null,
              manifestBytes: 0,
              files: 0,
              downloadBytes: 0,
            },
          },
        ],
      });
    },
    { patch, avatar: avatarFixture },
  );
  await expect(
    page.getByRole("dialog", { name: "World invitation", exact: true }),
  ).toBeVisible();
}
for (const theme of ["light", "dark"]) {
  test(`download and join is one guarded flow with avatar and theme controls (${theme})`, async ({
    page,
  }) => {
    await fixture(page, true, theme);
    await worldInvite(page, { profiles: [] });
    await page.evaluate(() => ((window as any).socialPrepareWait = true));
    const modal = page.getByRole("dialog");
    await expect(
      modal.locator(".social-invite-hero .social-avatar img"),
    ).toHaveCount(1);
    await expect(modal.locator(".terrain-pattern")).toBeVisible();
    await expect(
      modal.getByRole("combobox", { name: "Minecraft profile", exact: true }),
    ).toContainText("Create a matching instance");
    await expect(
      modal.getByRole("button", { name: "Turn off Social", exact: true }),
    ).toHaveCount(0);
    await modal
      .getByRole("button", { name: "Download and open", exact: true })
      .click();
    await expect(
      modal.getByRole("button", { name: "Please wait…", exact: true }),
    ).toBeDisabled();
    await expect(
      modal.getByText("Downloading Minecraft…", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          (window as any).socialRequests.filter(
            (r: any) => r.action === "social.join",
          ).length,
      ),
    ).toBe(0);
    await page.screenshot({
      path: `.test-data/screenshots/social-receive-progress-${theme}.png`,
    });
    await page.evaluate(() => (window as any).finishPrepare());
    await expect(
      modal.getByText("Connecting to the world…", { exact: true }),
    ).toBeVisible();
    await expect(
      modal.getByText(/Minecraft will join automatically/),
    ).toBeVisible();
    await expect(modal.getByText(/Open Multiplayer and choose/)).toHaveCount(0);
    await page.evaluate(() => ((window as any).lanLaunchState = "joined"));
    await expect(
      modal.getByText("You are in the world", { exact: true }),
    ).toBeVisible();
    await modal.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(modal).toHaveCount(0);
    const calls = await page.evaluate(() =>
      (window as any).socialRequests.filter(
        (r: any) => r.action === "social.prepare" || r.action === "social.join",
      ),
    );
    expect(calls.map((r: any) => r.action)).toEqual([
      "social.prepare",
      "social.join",
    ]);
    expect(calls[0].payload.profileId).toBeNull();
  });
}
test("an ongoing unrelated download disables joining and a route error stays visible", async ({
  page,
}) => {
  await fixture(page, true);
  await worldInvite(page);
  await page.evaluate(() => {
    const w = window as any;
    w.socialPrepareWait = true;
    w.socialJoinFail = true;
  });
  const modal = page.getByRole("dialog");
  await modal
    .getByRole("button", { name: "Open Minecraft", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: "Please wait…", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => (window as any).finishPrepare());
  await expect(modal.getByRole("alert")).toContainText(
    "World connection timed out",
  );
  await expect(
    modal.getByRole("button", { name: "Open Minecraft", exact: true }),
  ).toBeEnabled();
});
test("a stopped manifest transfer shows an error instead of silently removing the invite", async ({
  page,
}) => {
  await fixture(page, true);
  await worldInvite(page);
  await page.evaluate(() => {
    const w = window as any;
    const id = `aur1${"b".repeat(59)}`;
    w.socialPatch({
      invitations: [
        {
          from: id,
          status: "loading",
          receivedBytes: 512,
          manifest: null,
          error: null,
          joinAddress: null,
          offer: {
            id: "d".repeat(32),
            expires: Math.floor(Date.now() / 1000) + 120,
            world: {
              name: "Survival",
              minecraft: "1.21.1",
              loader: "vanilla",
              loaderVersion: null,
            },
            manifestHash: "f".repeat(64),
            manifestBytes: 2048,
            files: 1,
            downloadBytes: 10,
          },
        },
      ],
    });
  });
  const modal = page.getByRole("dialog");
  await modal
    .getByRole("combobox", { name: "Minecraft profile", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Create a matching instance", exact: true })
    .click();
  await expect(
    modal.getByText("Receiving instance…", { exact: true }),
  ).toBeVisible();
  await expect(modal.getByText("512 B / 2.0 KB")).toBeVisible();
  await page.evaluate(() => {
    const w = window as any;
    w.socialPatch({
      invitations: [
        {
          from: `aur1${"b".repeat(59)}`,
          status: "failed",
          error:
            "Instance transfer stalled. Ask your friend to send a new invitation",
          manifest: null,
          offer: {
            id: "d".repeat(32),
            expires: Math.floor(Date.now() / 1000) + 120,
            world: {
              name: "Survival",
              minecraft: "1.21.1",
              loader: "vanilla",
              loaderVersion: null,
            },
            manifestHash: "f".repeat(64),
            manifestBytes: 2048,
          },
        },
      ],
    });
  });
  await expect(modal.getByRole("alert")).toContainText(
    "Instance transfer stalled",
  );
  await expect(
    modal.getByRole("button", { name: "Download and open", exact: true }),
  ).toBeDisabled();
});
test("a player can be added inside the existing invitation", async ({
  page,
}) => {
  await fixture(page, true);
  await worldInvite(page, {
    profiles: [],
    accounts: [],
    selectedAccount: null,
  });
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("button", { name: "Download and open", exact: true }),
  ).toBeDisabled();
  await modal
    .getByRole("textbox", { name: "Player name", exact: true })
    .fill("Player2");
  await modal.getByRole("button", { name: "Add player", exact: true }).click();
  await expect(
    modal.getByRole("combobox", { name: "Player", exact: true }),
  ).toContainText("Player2");
  await expect(
    modal.getByRole("button", { name: "Download and open", exact: true }),
  ).toBeEnabled();
});
test("sent invitations show who is waiting and use theme surfaces", async ({
  page,
}) => {
  await fixture(page, true, "dark");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("--surface", "#301923");
    document.documentElement.style.setProperty("--gold", "#ecd174");
    document.documentElement.style.setProperty("--gold-soft", "#594138");
    (window as any).socialPatch({
      people: [
        {
          id: `aur1${"b".repeat(59)}`,
          name: "Alex",
          state: "friend",
          updated: 1,
        },
      ],
      outgoing: [
        {
          id: "d".repeat(32),
          friend: `aur1${"b".repeat(59)}`,
          world: { name: "Survival" },
          status: "waiting",
        },
      ],
    });
  });
  await expect(
    page.getByText("Survival · Waiting for your friend", { exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("button", { name: "Copy ID", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(48, 25, 35)");
  expect(
    await page
      .getByRole("checkbox", { name: "Allow friend requests", exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(236, 209, 116)");
});

for (const width of [960, 1280]) {
  test(
    "identity is contiguous, animated and aligned at " + width,
    async ({ page }) => {
      await fixture(page, true);
      await page.setViewportSize({ width, height: 800 });
      await page
        .getByRole("button", { name: "Show Aurum ID", exact: true })
        .click();
      const id = page.locator(".social-id-value");
      await expect(id).toHaveText("aur1" + "a".repeat(59));
      expect((await id.textContent())?.includes(" ")).toBe(false);
      const status = await page
        .locator(".social-identity-info .select-trigger")
        .boundingBox();
      const action = await page
        .getByRole("button", { name: "Copy ID", exact: true })
        .boundingBox();
      expect(
        Math.abs(
          status!.y + status!.height / 2 - action!.y - action!.height / 2,
        ),
      ).toBeLessThan(1.5);
      for (let i = 0; i < 5; i++) {
        await page
          .getByRole("button", { name: "Hide Aurum ID", exact: true })
          .click();
        await expect(id).not.toBeVisible();
        await page
          .getByRole("button", { name: "Show Aurum ID", exact: true })
          .click();
      }
      await page.evaluate(() =>
        (window as any).socialPatch({
          status: "reconnecting",
          enabled: true,
          online: [],
        }),
      );
      await expect(
        page.getByRole("combobox", { name: "Status", exact: true }),
      ).toContainText("Reconnecting");
      await expect(
        page.getByRole("button", { name: "Turn on Social", exact: true }),
      ).toHaveCount(0);
      await expect(id).toHaveText("aur1" + "a".repeat(59));
      await page.evaluate(() =>
        (window as any).socialPatch({ status: "online", enabled: true }),
      );
      await expect(
        page.getByRole("combobox", { name: "Status", exact: true }),
      ).toContainText("Online");
      await page.screenshot({
        path: ".test-data/screenshots/social-identity-" + width + ".png",
      });
    },
  );
}

test("an offline saved identity reconnects without new-account onboarding", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() =>
    (window as any).socialPatch({
      enabled: false,
      status: "disabled",
      people: [
        {
          id: "aur1" + "b".repeat(59),
          name: "Friend",
          state: "friend",
          updated: 1,
        },
      ],
    }),
  );
  await expect(
    page.getByRole("heading", { name: "Social is offline", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Friend", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Online");
  await page
    .getByRole("button", { name: "Show Aurum ID", exact: true })
    .click();
  await expect(page.locator(".social-id-value")).toHaveText(
    "aur1" + "a".repeat(59),
  );
});

test("a saved identity repairs an outdated component and firewall without repeating P2P consent", async ({
  page,
}) => {
  await fixture(page, true);
  await page.evaluate(() => {
    const w = window as any;
    w.socialFirewallOutdated = true;
    w.runtimeWait = true;
    w.socialPatch({ enabled: false, status: "disabled" });
  });
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).finishRuntime))
    .toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (window as any).finishRuntime());
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Online");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const requests = await page.evaluate(() => (window as any).socialRequests);
  expect(
    requests
      .filter((r: any) =>
        [
          "social.installRuntime",
          "social.configureFirewall",
          "social.enable",
        ].includes(r.action),
      )
      .map((r: any) => r.action),
  ).toEqual([
    "social.installRuntime",
    "social.configureFirewall",
    "social.enable",
  ]);
});

test("an automatic component update never opens P2P onboarding while the saved identity is loading", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.socialSnapshotWait = true;
    w.finishRuntime = () => {
      w.finishRuntime = null;
    };
  });
  await fixture(page, true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).socialRequests.filter(
            (r: any) => r.action === "social.runtimeStatus",
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (window as any).finishSnapshot());
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toContainText("Online");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (window as any).finishRuntime());
});

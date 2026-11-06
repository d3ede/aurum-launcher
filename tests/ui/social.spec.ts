// UI contract fixtures only. Network/isolation evidence comes from the native labs.
import { test, expect, type Page } from "@playwright/test";
async function fixture(page: Page, enabled = false, theme = "dark",language="en") {
  await page.addInitScript(
    ({ enabled, theme,language }) => {
      localStorage.setItem("aurum:language", language);
      const w = window as any;
      w.isTauri = true;
      const state = {
        profiles: [],
        accounts: [],
        selectedAccount: null,
        running: [],
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
          if (action === "social.snapshot") return structuredClone(social);
          if (action === "social.takeLink") return null;
          if (action === "takeServerShortcut") return null;
          if (action === "social.pending") return [];
          if (action === "social.configureFirewall") return null;
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
    { enabled, theme,language },
  );
  await page.goto("/");
  await page.getByRole("button", { name: language==="ru"?"Друзья":"Friends", exact: true }).click();
}
test("Russian Friends navigation stays translated",async({page})=>{await fixture(page,false,"light","ru");await expect(page.getByRole("navigation").getByRole("button",{name:"Друзья",exact:true})).toBeVisible();await expect(page.getByRole("navigation").getByRole("button",{name:"Friends",exact:true})).toHaveCount(0);await expect(page.getByRole("heading",{name:"Друзья",level:1})).toBeVisible();});
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
  await page
    .getByRole("button", { name: "Enable Social", exact: true })
    .click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("button", { name: "Configure network and enable" }),
  ).toBeDisabled();
  await modal.getByRole("checkbox").check();
  await modal
    .getByRole("button", { name: "Configure network and enable" })
    .click();
  await expect(
    page.getByRole("button", { name: "Turn off Social", exact: true }),
  ).toBeVisible();
  const actions = await calls();
  expect(actions.indexOf("social.configureFirewall")).toBeLessThan(
    actions.indexOf("social.enable"),
  );
  await page
    .getByRole("button", { name: "Turn off Social", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Meet in Aurum" }),
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
    expect(await page.locator("#root").evaluate((e) => (e as HTMLElement).inert)).toBe(true);
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
    expect(await page.locator("#root").evaluate((e) => (e as HTMLElement).inert)).toBe(false);
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
  await modal.getByRole("button", { name: "Review contents" }).click();
  await expect(modal.getByText("mods/untrusted-<script>.jar")).toBeVisible();
  await expect(modal.locator("script")).toHaveCount(0);
  await expect(
    modal.getByRole("button", { name: "Install and join" }),
  ).toBeDisabled();
  await modal.getByRole("checkbox").check();
  await modal.getByRole("button", { name: "Install and join" }).click();
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

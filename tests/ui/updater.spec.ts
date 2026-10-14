import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  options: { running?: boolean; theme?: string } = {},
) {
  await page.addInitScript(
    ({ running, theme }) => {
      localStorage.setItem("aurum:language", "en");
      const w = window as any;
      w.isTauri = true;
      w.updateMode = "available";
      w.updateRequests = [];
      w.failDownload = false;
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
          if (command.startsWith("plugin:updater|")) {
            w.updateRequests.push({
              command,
              args: { restartAfterInstall: args.restartAfterInstall },
            });
            if (command.endsWith("check")) {
              if (w.holdUpdateCheck)
                await new Promise<void>((resolve) => {
                  w.releaseUpdateCheck = resolve;
                });
              await new Promise((resolve) => setTimeout(resolve, 100));
              if (w.updateMode === "error") throw "network unavailable";
              if (w.updateMode === "current") return null;
              return {
                rid: 101,
                currentVersion: "0.3.8",
                version: "0.3.9",
                rawJson: {},
                body: "Update fixture",
              };
            }
            if (command.endsWith("download")) {
              args.onEvent.onmessage({
                event: "Started",
                data: { contentLength: 4000000 },
              });
              args.onEvent.onmessage({
                event: "Progress",
                data: { chunkLength: 1000000 },
              });
              await new Promise((resolve) => setTimeout(resolve, 350));
              if (w.failDownload) throw "signature verification failed";
              args.onEvent.onmessage({ event: "Finished" });
              return 102;
            }
            if (command.endsWith("install")) return;
            throw command;
          }
          if (command === "rpc") {
            if (args.action === "search") return { total: 0, projects: [] };
            if (args.action === "snapshot")
              return {
                profiles: [],
                accounts: [],
                selectedAccount: null,
                running: running ? ["owned-game"] : [],
                dataDir: "D:/Aurum-updater-test",
                curseforgeConfigured: false,
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
            throw args.action;
          }
          return command.includes("is_maximized") ? false : 1;
        },
      };
    },
    { running: options.running ?? false, theme: options.theme ?? "light" },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
}

test("checks, postpones, and downloads before restarting", async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).holdUpdateCheck = true;
  });
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(
    page.getByRole("button", { name: "Check for updates" }),
  ).toBeDisabled();
  await page.evaluate(() => {
    (window as any).holdUpdateCheck = false;
    (window as any).releaseUpdateCheck();
  });
  const banner = page.getByRole("region", { name: "Launcher updates" });
  await expect(banner).toContainText("Aurum 0.3.9 is available");
  await banner.getByRole("button", { name: "Later" }).click();
  await expect(banner).toHaveCount(0);
  await page.getByRole("button", { name: "Update and restart" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "value",
    "1000000",
  );
  await expect(
    page.getByText("Restarting Aurum…", { exact: true }),
  ).toBeVisible();
  const requests = await page.evaluate(() => (window as any).updateRequests);
  expect(requests.map((r: any) => r.command)).toEqual([
    "plugin:updater|check",
    "plugin:updater|download",
    "plugin:updater|install",
  ]);
  expect(requests.at(-1).args.restartAfterInstall).toBe(true);
});

test("a failed or tampered download never reaches installation and can be retried", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).failDownload = true;
  });
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(
    page.getByRole("button", { name: "Update and restart" }).first(),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Update and restart" })
    .first()
    .click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Couldn't download or verify",
  );
  expect(
    await page.evaluate(() =>
      (window as any).updateRequests.some((r: any) =>
        r.command.endsWith("install"),
      ),
    ),
  ).toBe(false);
  await page.evaluate(() => {
    (window as any).failDownload = false;
  });
  await page
    .getByRole("button", { name: "Update and restart" })
    .first()
    .click();
  await expect(
    page.getByText("Restarting Aurum…", { exact: true }).first(),
  ).toBeVisible();
});

test("running games block installation and the banner fits both themes at minimum size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 680 });
  await fixture(page, { running: true, theme: "dark" });
  await page.getByRole("button", { name: "Check for updates" }).click();
  const banner = page.getByRole("region", { name: "Launcher updates" });
  await expect(banner).toBeVisible();
  await expect(
    banner.getByRole("button", { name: "Update and restart" }),
  ).toBeDisabled();
  await expect(banner).toContainText("Close your games");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".test-data/screenshots/updater-dark.png",
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Toggle theme" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: ".test-data/screenshots/updater-light.png",
    animations: "disabled",
  });
});

test("check failures allow retry, and an up-to-date result offers no installation", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(() => {
    (window as any).updateMode = "error";
  });
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Couldn't check for updates",
  );
  await page.evaluate(() => {
    (window as any).updateMode = "current";
  });
  await page.getByRole("button", { name: "Check for updates" }).click();
  await expect(
    page.getByText("You're up to date", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Update and restart" }),
  ).toHaveCount(0);
});

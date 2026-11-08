import { expect, test } from "@playwright/test";

test("the real cue decodes, ignores launch/loading and plays once per ready session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("aurum:language", "ru");
    const w = window as any;
    w.isTauri = true;
    w.readyPlays = 0;
    const AudioBase = window.AudioContext;
    w.AudioContext = class extends AudioBase {
      decodeAudioData(bytes: ArrayBuffer) {
        return super.decodeAudioData(bytes).then((buffer) => {
          w.readyAudio = {
            duration: buffer.duration,
            peak: Math.max(...buffer.getChannelData(0).map(Math.abs)),
          };
          return buffer;
        });
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args: Parameters<typeof start>) => {
          w.readyPlays++;
          start(...args);
        };
        return source;
      }
    };
    const callbacks = new Map<number, Function>();
    let next = 0,
      eventHandler = 0;
    w.emitGameEvent = (phase: string, id = "jvm-one") =>
      callbacks.get(eventHandler)?.({
        event: "aurum:event",
        id: 1,
        payload: {
          id,
          profileId: "instance",
          phase,
          message:
            phase === "game-ready"
              ? "Ready notification"
              : "Fixture game state",
          done: 0,
          total: 0,
        },
      });
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.__TAURI_INTERNALS__ = {
      metadata: {
        currentWindow: { label: "main" },
        currentWebview: { label: "main" },
      },
      transformCallback(callback: Function) {
        callbacks.set(++next, callback);
        return next;
      },
      async invoke(command: string, args: any) {
        if (command === "plugin:event|listen") {
          if (args.event === "aurum:event") eventHandler = args.handler;
          return 1;
        }
        if (command === "rpc" && args.action === "snapshot")
          return {
            profiles: [],
            accounts: [],
            selectedAccount: null,
            running: [],
            dataDir: "D:/game-ready-fixture",
            curseforgeConfigured: false,
            settings: {
              language: "ru",
              theme: "dark",
              javaPath: "",
              ramMb: 4096,
              jvmArgs: "",
              resolutionWidth: 1280,
              resolutionHeight: 820,
              showSnapshots: false,
            },
          };
        if (command === "rpc" && args.action === "search")
          return { total: 0, projects: [] };
        return command.includes("is_maximized") ? false : null;
      },
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Главная", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).readyAudio?.duration))
    .toBeCloseTo(1.35, 2);
  const peak = await page.evaluate(() => (window as any).readyAudio.peak);
  expect(peak).toBeGreaterThan(0.08);
  expect(peak).toBeLessThan(0.09);
  await page.evaluate(() => {
    for (const phase of ["running", "log", "loader"])
      (window as any).emitGameEvent(phase);
  });
  expect(await page.evaluate(() => (window as any).readyPlays)).toBe(0);
  await page.evaluate(() => {
    (window as any).emitGameEvent("game-ready");
    (window as any).emitGameEvent("game-ready");
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).readyPlays))
    .toBe(1);
  await expect(page.locator(".operation-panel")).not.toContainText(
    "Ready notification",
  );
  await page.evaluate(() =>
    (window as any).emitGameEvent("game-ready", "jvm-two"),
  );
  await expect
    .poll(() => page.evaluate(() => (window as any).readyPlays))
    .toBe(2);
});

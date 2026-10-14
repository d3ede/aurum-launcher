// Build a debug application with identifier app.auren.launcher.updater-smoke
// with test version 0.3.1 and the diagnostic-only updater endpoint
// http://127.0.0.1:9241/latest.json.
// The script downloads and verifies fixtures; it NEVER calls install().
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const root = resolve(".test-data", `native-updater-${Date.now()}`);
const releaseVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const forgedVersion = releaseVersion.replace(/\d+$/, (value) =>
  String(Number(value) + 1),
);
mkdirSync(root, { recursive: true });
writeFileSync(
  join(root, "state.json"),
  JSON.stringify({
    profiles: [],
    accounts: [],
    selectedAccount: null,
    settings: {
      language: "en",
      theme: "dark",
      javaPath: "",
      ramMb: 4096,
      jvmArgs: "",
      resolutionWidth: 1280,
      resolutionHeight: 720,
      showSnapshots: false,
    },
  }),
);
const installerPath = resolve(
  process.env.AURUM_UPDATER_TEST_INSTALLER ||
    `target/release/bundle/nsis/Aurum Launcher_${releaseVersion}_x64-setup.exe`,
);
const installer = readFileSync(installerPath);
const signature = readFileSync(`${installerPath}.sig`, "utf8").trim();
const tampered = Buffer.from(installer);
tampered[0] ^= 1;
let mode = "current";
let manifestRequests = 0;
const server = createServer((request, response) => {
  if (request.url === "/latest.json") {
    manifestRequests++;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        version:
          mode === "current"
            ? "0.3.1"
            : mode === "wrong-version"
              ? forgedVersion
              : releaseVersion,
        notes: "Owned update verification fixture",
        platforms: {
          "windows-x86_64": {
            signature,
            url: `http://127.0.0.1:9241/${mode === "tampered" ? "tampered" : "installer"}.exe`,
          },
        },
      }),
    );
  } else {
    const payload = request.url === "/tampered.exe" ? tampered : installer;
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": payload.length,
    });
    response.end(payload);
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(9241, "127.0.0.1", resolve);
});
const child = spawn(
  resolve(process.env.AURUM_UPDATER_SMOKE_EXE || "target/debug/aurum.exe"),
  [],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      AURUM_DATA_DIR: root,
      WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=9242 --remote-debugging-address=127.0.0.1",
    },
  },
);
let browser;
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, "Owned diagnostic launcher exited");
    try {
      browser = await chromium.connectOverCDP("http://127.0.0.1:9242");
      break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(browser, "Diagnostic WebView2 did not expose CDP");
  const page = browser.contexts()[0].pages()[0];
  await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
  const invoke = (command, args = {}) =>
    page.evaluate(
      ({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args),
      { command, args },
    );
  assert.equal(
    await invoke("plugin:updater|check", { timeout: 15000 }),
    null,
    "Current version must not offer a downgrade or reinstall",
  );
  mode = "valid";
  const update = await invoke("plugin:updater|check", { timeout: 15000 });
  assert.equal(update.version, releaseVersion);
  const download = (rid) =>
    page.evaluate(async (rid) => {
      const internal = window.__TAURI_INTERNALS__;
      const callback = internal.transformCallback(() => {});
      try {
        return await internal.invoke("plugin:updater|download", {
          rid,
          onEvent: `__CHANNEL__:${callback}`,
          timeout: 30000,
        });
      } finally {
        internal.unregisterCallback(callback);
      }
    }, rid);
  const bytesRid = await download(update.rid);
  assert.equal(typeof bytesRid, "number");
  await invoke("plugin:resources|close", { rid: bytesRid });
  await invoke("plugin:resources|close", { rid: update.rid });
  mode = "tampered";
  const invalid = await invoke("plugin:updater|check", { timeout: 15000 });
  let rejected = false;
  try {
    await download(invalid.rid);
  } catch (reason) {
    rejected = /signature|verify/i.test(String(reason));
  }
  assert(rejected, "Tampered update must fail native signature verification");
  await invoke("plugin:resources|close", { rid: invalid.rid });
  mode = "wrong-version";
  const forged = await invoke("plugin:updater|check", { timeout: 15000 });
  let wrongVersionRejected = false;
  try {
    await download(forged.rid);
  } catch (reason) {
    wrongVersionRejected = /signed for version|announced version/i.test(
      String(reason),
    );
  }
  assert(
    wrongVersionRejected,
    "A forged version must not override the signed release version",
  );
  await invoke("plugin:resources|close", { rid: forged.rid });
  mode = "valid";
  await page
    .getByRole("region", { name: "Launcher updates" })
    .waitFor({ timeout: 20000 });
  assert(
    manifestRequests >= 5,
    "Production frontend must check automatically on startup",
  );
  await page.screenshot({
    path: ".test-data/screenshots/updater-native.png",
    animations: "disabled",
  });
  const result = {
    currentVersionIgnored: true,
    signedDownloadVerified: true,
    tamperedDownloadRejected: true,
    forgedVersionRejected: true,
    startupCheckObserved: true,
    installerExecuted: false,
    manifestRequests,
  };
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  server.close();
}

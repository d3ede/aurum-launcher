// Public README previews use demonstration state, never the installed user's data.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";

const port = 1431;
const url = `http://127.0.0.1:${port}`;
const response = await fetch(
  "https://api.modrinth.com/v2/search?limit=4&index=downloads&facets=" +
    encodeURIComponent(JSON.stringify([["project_type:mod"]])),
  { headers: { "User-Agent": "Aurum-Launcher/README-preview" } },
);
assert(response.ok, `Modrinth search failed: ${response.status}`);
const { hits } = await response.json();
assert.equal(hits.length, 4);
const projects = hits.map((hit) => ({
  id: hit.project_id,
  source: "modrinth",
  title: hit.title,
  description: hit.description,
  author: hit.author,
  downloads: hit.downloads,
  icon: hit.icon_url,
  kind: "mod",
}));
assert(projects.every((p) => p.icon?.startsWith("https://")));
const texture =
  "data:image/png;base64," +
  readFileSync("src/assets/skins/wide-steve.png").toString("base64");
const base = {
  loaderVersion: null,
  installedVersion: "demo",
  ramMb: null,
  jvmArgs: "",
  content: [],
  cover: 0,
  icon: null,
};
const profiles = [
  {
    ...base,
    id: "demo-forge",
    name: "Forge Survival",
    engine: "java",
    minecraft: "1.21.1",
    loader: "forge",
    lastPlayed: 300,
    iconStyle: { symbol: "forge", color: "#C5A06A", background: "#3E3327" },
  },
  {
    ...base,
    id: "demo-fabric",
    name: "Fabric Adventures",
    engine: "java",
    minecraft: "1.21.1",
    loader: "fabric",
    lastPlayed: 200,
    iconStyle: { symbol: "fabric", color: "#779F7D", background: "#263A2B" },
  },
  {
    ...base,
    id: "demo-horizon",
    name: "Horizon World",
    engine: "horizon",
    minecraft: "26.3",
    loader: "vanilla",
    lastPlayed: 100,
    iconStyle: { symbol: "horizon", color: "#A99CE0", background: "#302B47" },
  },
];
const server = spawn(
  process.execPath,
  [
    resolve("node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { windowsHide: true, stdio: "pipe" },
);
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    assert.equal(server.exitCode, null, "Preview server exited");
    try {
      ready = (await fetch(url)).ok;
    } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert(ready, "Preview server did not start");
  browser = await chromium.launch({ headless: true });
  mkdirSync("docs", { recursive: true });
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      locale: "en-US",
      colorScheme: theme,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.addInitScript(
      ({ theme, profiles, projects, texture }) => {
        localStorage.setItem("aurum:language", "en");
        window.isTauri = true;
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
        window.__TAURI_INTERNALS__ = {
          metadata: {
            currentWindow: { label: "main" },
            currentWebview: { label: "main" },
          },
          transformCallback() {
            return 1;
          },
          async invoke(command, args) {
            if (command !== "rpc") {
              if (command === "plugin:updater|check") return null;
              return command.includes("is_maximized") ? false : 1;
            }
            switch (args.action) {
              case "snapshot":
                return {
                  profiles,
                  accounts: [
                    {
                      id: "demo-player",
                      uuid: "00000000-0000-4000-8000-000000000001",
                      name: "Player",
                      kind: "offline",
                      skinModel: "steve",
                      hasSkin: false,
                    },
                  ],
                  selectedAccount: "demo-player",
                  running: [],
                  hostingRunning: [],
                  dataDir: "D:/Aurum-demo",
                  curseforgeConfigured: true,
                  serverManager: true,
                  hostingSupport: true,
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
              case "search":
                return { projects, total: projects.length };
              case "accountAvatar":
                return texture;
              case "recentServers":
                return [];
              case "takeServerShortcut":
                return null;
              default:
                throw new Error(`Unexpected preview RPC: ${args.action}`);
            }
          },
        };
      },
      { theme, profiles, projects, texture },
    );
    await page.goto(url);
    await page.getByRole("heading", { name: "Home", exact: true }).waitFor();
    await page.getByText(projects[0].title, { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.locator(".loader-glyph").evaluateAll(async (glyphs) => {
      await Promise.all(
        glyphs.map(async (glyph) => {
          const url = getComputedStyle(glyph).maskImage.match(
            /^url\(["']?(.*?)["']?\)$/,
          )?.[1];
          if (!url) throw new Error("Missing loader mask");
          const image = new Image();
          image.src = url;
          await image.decode();
        }),
      );
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    const artwork = page.locator(".recommendations img");
    assert.equal(await artwork.count(), 4);
    await artwork.evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode()));
    });
    assert(
      await artwork.evaluateAll((images) =>
        images.every((i) => i.complete && i.naturalWidth > 0),
      ),
    );
    assert.equal(await page.locator(".profile-grid .instance-card").count(), 2);
    assert.match(
      await page.locator(".quick-launch").innerText(),
      /Forge Survival/,
    );
    assert.match(
      await page.locator(".profile-grid").innerText(),
      /Fabric[\s\S]*Horizon/,
    );
    assert.equal(await page.locator("html").getAttribute("lang"), "en");
    assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    assert.deepEqual(errors, []);
    const path =
      theme === "light" ? "docs/launcher-en.png" : "docs/launcher-en-dark.png";
    await page.screenshot({ path, animations: "disabled" });
    console.log(
      `Captured ${path}: Player, Forge, Fabric, Horizon, four loaded Modrinth images`,
    );
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}

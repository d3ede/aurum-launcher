// Real WebView2 and Rust IPC; only this script's temporary account/data are changed.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(".test-data", `native-skins-${Date.now()}`);
const dataRoot = join(root, "data");
mkdirSync(dataRoot, { recursive: true });
writeFileSync(join(dataRoot, "state.json"), JSON.stringify({
  profiles: [], accounts: [], selectedAccount: null,
  settings: { language: "ru", theme: "light", javaPath: "", ramMb: 4096,
    jvmArgs: "", resolutionWidth: 1280, resolutionHeight: 720, showSnapshots: false },
}));
const executable = resolve(process.env.AURUM_SKINS_SMOKE_EXE || "target/debug/aurum.exe");
const env = { ...process.env, AURUM_DATA_DIR: dataRoot,
  WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
    "--remote-debugging-port=9234 --remote-debugging-address=127.0.0.1" };
let child, browser;
const errors = [];
async function start() {
  child = spawn(executable, [], { cwd: resolve("."), env, windowsHide: true, stdio: "pipe" });
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Owned test launcher exited ${child.exitCode}`);
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9234"); break; }
    catch { await new Promise(r => setTimeout(r, 250)); }
  }
  assert(browser, "Owned test launcher did not start CDP");
  const page = browser.contexts()[0].pages()[0];
  page.on("pageerror", e => errors.push(e.message));
  await page.locator(".nav-item").first().waitFor();
  return page;
}
async function stop() {
  if (browser) { await browser.close(); browser = undefined; }
  if (child && child.exitCode === null) {
    const exited = new Promise(r => child.once("exit", r));
    child.kill(); await exited;
  }
}
const rpc = (page, action, payload = {}) => page.evaluate(
  ({ action, payload }) => window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }),
  { action, payload });
try {
  let page = await start();
  assert.equal((await rpc(page, "snapshot")).dataDir, dataRoot);
  const account = await rpc(page, "addOffline", { name: "SkinSmoke" });
  const firstBytes = await rpc(page, "defaultSkinTexture", { id: "default:ari", model: "alex" });
  const secondBytes = await rpc(page, "defaultSkinTexture", { id: "default:zuri", model: "steve" });
  const capeBytes = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 64; c.height = 32;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#385D48"; ctx.fillRect(0, 0, 64, 32);
    return Array.from(atob(c.toDataURL("image/png").split(",")[1]), s => s.charCodeAt(0));
  });
  const cape = await rpc(page, "saveLibraryCape", { name: "Тестовый плащ", bytes: capeBytes });
  const first = await rpc(page, "saveLibrarySkin", {
    id: null, name: "Сохранённый Ari", model: "alex", bytes: firstBytes, capeId: cape.id });
  const second = await rpc(page, "saveLibrarySkin", {
    id: null, name: "Сохранённый Zuri", model: "steve", bytes: secondBytes, capeId: null });
  await page.reload();
  await page.getByRole("button", { name: "Скины и плащи", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать скин Сохранённый Ari", exact: true }).click();
  await page.locator(".wardrobe-character canvas[data-ready=true]").waitFor();
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await page.getByText("Образ применён", { exact: true }).waitFor();
  let library = await rpc(page, "skinLibrary");
  assert.equal(library.selections[account.id].skinId, first.id);
  assert.equal(library.selections[account.id].capeId, cape.id);
  assert.equal((await rpc(page, "snapshot")).accounts[0].skinModel, "alex");
  assert(existsSync(join(dataRoot, "skins", `${account.id}.png`)));
  await page.getByRole("button", { name: "Изменить", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Настройка скина" });
  await editor.getByRole("textbox", { name: "Название образа" }).fill("Мой Ari");
  await editor.getByRole("button", { name: "Сохранить скин", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.locator(".wardrobe-tile img[data-thumbnail-ready]").first().waitFor();
  await page.locator(".content-scroll").evaluate(e => { e.scrollTop = 0; });
  await page.screenshot({ path: ".test-data/screenshots/skins-native.png" });
  assert.equal(JSON.parse(readFileSync(join(dataRoot, "skin-library.json"), "utf8")).skins.length, 2);
  await stop();
  page = await start();
  await page.getByRole("button", { name: "Скины и плащи", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать скин Мой Ari", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Выбрать скин Мой Ari", exact: true }).getAttribute("aria-pressed"), "true");
  await page.getByRole("button", { name: "Выбрать скин Сохранённый Zuri", exact: true }).click();
  await page.getByRole("button", { name: "Применить", exact: true }).click();
  await page.getByText("Образ применён", { exact: true }).waitFor();
  library = await rpc(page, "skinLibrary");
  assert.equal(library.selections[account.id].skinId, second.id);
  assert.equal((await rpc(page, "snapshot")).accounts[0].skinModel, "steve");
  assert.equal(library.skins.length, 2);
  const sourceRoot = join(root, "ModrinthApp");
  mkdirSync(sourceRoot, { recursive: true });
  const sourcePath = join(sourceRoot, "app.db");
  const source = new DatabaseSync(sourcePath);
  source.exec(`CREATE TABLE custom_minecraft_skin_textures (texture_key TEXT PRIMARY KEY, texture BLOB);
    CREATE TABLE custom_minecraft_skins (minecraft_user_uuid TEXT, texture_key TEXT, variant TEXT, cape_id TEXT);`);
  const addTexture = source.prepare("INSERT INTO custom_minecraft_skin_textures VALUES (?, ?)");
  const addSkin = source.prepare("INSERT INTO custom_minecraft_skins VALUES (?, ?, ?, NULL)");
  addTexture.run("classic", readFileSync("src/assets/skins/wide-efe.png"));
  addTexture.run("slim", readFileSync("src/assets/skins/slim-kai.png"));
  addTexture.run("broken", Buffer.from("not PNG"));
  addSkin.run("one", "classic", "CLASSIC");
  addSkin.run("one", "slim", "SLIM");
  addSkin.run("two", "slim", "SLIM");
  addSkin.run("one", "broken", "CLASSIC");
  source.close();
  const sourceBefore = readFileSync(sourcePath);
  const imported = await rpc(page, "importModrinthSkins", { directories: [sourceRoot] });
  assert.deepEqual(imported, { imported: 2, duplicates: 1, invalid: 1, warnings: [] });
  assert.deepEqual(await rpc(page, "importModrinthSkins", { directories: [sourceRoot] }),
    { imported: 0, duplicates: 3, invalid: 1, warnings: [] });
  assert.deepEqual(readFileSync(sourcePath), sourceBefore);
  library = await rpc(page, "skinLibrary");
  assert.equal(library.skins.length, 4);
  assert.equal(library.selections[account.id].skinId, second.id);
  assert.deepEqual(library.skins.slice(2).map(s => s.model).sort(), ["alex", "steve"]);
  await stop();
  page = await start();
  await page.getByRole("button", { name: "Скины и плащи", exact: true }).click();
  await page.getByRole("button", { name: "Выбрать скин Modrinth 3", exact: true }).waitFor();
  await page.getByRole("button", { name: "Выбрать скин Modrinth 4", exact: true }).waitFor();
  await page.getByRole("button", { name: "Импорт из Modrinth", exact: false }).waitFor();
  await page.screenshot({ path: ".test-data/screenshots/skins-modrinth-native.png" });
  assert.deepEqual(errors, []);
  const result = { passed: true, savedSkins: 4, localCapes: 1, restarted: true,
    modrinthImport: imported, sourceUnchanged: true,
    switched: true, nativeIpc: true, errors, fixtureRoot: root };
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await stop(); }

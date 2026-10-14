// Real launch/close/reopen/stop through WebView2. Only this script's Java fixture is stopped.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(".test-data", `native-session-${Date.now()}`);
const dataRoot = join(root, "data");
const profileId = randomUUID();
const directory = join(dataRoot, "instances", profileId);
const classes = join(root, "classes");
const jdk = process.env.AURUM_SESSION_TEST_JDK || "C:/Program Files/Java/jdk-25.0.2";
mkdirSync(classes, { recursive: true });
mkdirSync(join(directory, "client"), { recursive: true });
const source = join(root, "SessionFixture.java");
writeFileSync(source, `public class SessionFixture {
  public static void main(String[] args) throws Exception {
    java.nio.file.Files.writeString(java.nio.file.Path.of(args[1], "fixture.pid"),
      Long.toString(ProcessHandle.current().pid()));
    while (true) Thread.sleep(200);
  }
}`);
execFileSync(join(jdk, "bin", "javac.exe"), ["-d", classes, source], { windowsHide: true });
execFileSync(join(jdk, "bin", "jar.exe"), ["--create", "--file", join(directory, "client", "1.21.1.jar"), "-C", classes, "."], { windowsHide: true });
writeFileSync(join(directory, "launch.json"), JSON.stringify({
  id: "1.21.1", type: "release", mainClass: "SessionFixture", libraries: [],
  javaVersion: { majorVersion: 25 }, assets: "fixture", assetIndex: { id: "fixture" },
  arguments: { jvm: ["-cp", "${classpath}"], game: ["--gameDir", "${game_directory}"] },
}));
writeFileSync(join(dataRoot, "state.json"), JSON.stringify({
  profiles: [{ id: profileId, name: "Session recovery test", minecraft: "1.21.1", loader: "vanilla",
    loaderVersion: null, installedVersion: "1.21.1", ramMb: 512, jvmArgs: "", lastPlayed: null,
    cover: 1, icon: null, iconStyle: null, content: [] }], accounts: [], selectedAccount: null,
  settings: { language: "ru", theme: "light", javaPath: join(jdk, "bin", "java.exe"), ramMb: 512,
    jvmArgs: "", resolutionWidth: 1280, resolutionHeight: 720, showSnapshots: false },
}));
const executable = resolve(process.env.AURUM_SESSION_SMOKE_EXE || "target/debug/aurum.exe");
const env = { ...process.env, AURUM_DATA_DIR: dataRoot, WEBVIEW2_USER_DATA_FOLDER: join(root, "webview"),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=9237 --remote-debugging-address=127.0.0.1" };
let child, browser, page;
let gamePid;
const errors = [];
const rpc = (action, payload = {}) => page.evaluate(({ action, payload }) =>
  window.__TAURI_INTERNALS__.invoke("rpc", { action, payload }), { action, payload });
async function start() {
  child = spawn(executable, [], { cwd: resolve("."), env, windowsHide: true, stdio: "pipe" });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Owned launcher exited ${child.exitCode}`);
    try { browser = await chromium.connectOverCDP("http://127.0.0.1:9237"); break; }
    catch { await new Promise(r => setTimeout(r, 200)); }
  }
  assert(browser, "Owned launcher did not expose its test CDP port");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", e => errors.push(e.message));
  await page.getByRole("heading", { name: "Главная", exact: true }).waitFor();
  assert.equal((await rpc("snapshot")).dataDir, dataRoot);
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await page.getByRole("heading", { name: "Session recovery test", exact: true }).waitFor();
}
async function closeNormally() {
  const exited = new Promise(r => child.once("exit", r));
  await page.getByRole("button", { name: "Закрыть Aurum", exact: true }).click();
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("Owned launcher did not close normally")), 10000))]);
  await browser.close().catch(() => {}); browser = undefined;
}
async function launch() {
  const pidFile = join(directory, "fixture.pid");
  if (existsSync(pidFile)) unlinkSync(pidFile);
  await page.getByRole("button", { name: "Играть", exact: true }).click();
  for (let i = 0; i < 100 && !existsSync(pidFile); i++) await new Promise(r => setTimeout(r, 100));
  assert(existsSync(pidFile), "Owned Java fixture did not start");
  gamePid = Number(readFileSync(pidFile, "utf8"));
  assert(Number.isSafeInteger(gamePid) && gamePid > 0);
  assert((await rpc("snapshot")).running.includes(profileId));
  await page.getByRole("button", { name: "Стоп", exact: true }).waitFor();
}
try {
  await start();
  await rpc("addOffline", { name: "SessionSmoke" });
  await page.reload();
  await page.getByRole("button", { name: "Мои сборки", exact: true }).click();
  await launch();
  await closeNormally();
  process.kill(gamePid, 0); // Existence check only: closing the launcher preserved its game.
  await start();
  assert.deepEqual((await rpc("snapshot")).running, [profileId]);
  await page.getByRole("button", { name: "Стоп", exact: true }).waitFor();
  await page.screenshot({ path: ".test-data/screenshots/session-restored-native.png" });
  await page.getByRole("button", { name: "Стоп", exact: true }).click();
  await page.getByRole("button", { name: "Играть", exact: true }).waitFor();
  assert.deepEqual((await rpc("snapshot")).running, []);
  gamePid = undefined;
  await launch();
  await closeNormally();
  await start();
  await page.getByRole("button", { name: "Стоп", exact: true }).waitFor();
  process.kill(gamePid); // Only the fixture PID written by our own Java class in this unique directory.
  gamePid = undefined;
  // No manual snapshot refresh: the restored session must notice external game exit automatically.
  await page.getByRole("button", { name: "Играть", exact: true }).waitFor({ timeout: 10000 });
  assert.deepEqual((await rpc("snapshot")).running, []);
  assert.deepEqual(errors, []);
  const result = { passed: true, normalClosePreservesGame: true, restoredStatus: true,
    restoredStop: true, externalExitRefreshesUi: true, errors, fixtureRoot: root };
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  if (gamePid && browser && child?.exitCode === null) await rpc("stop", { id: profileId }).catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (child?.exitCode === null) child.kill();
}

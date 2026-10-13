import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve('.test-data', `native-localization-${Date.now()}`);
const dataRoot = join(root, 'data');
mkdirSync(dataRoot, {recursive:true});
writeFileSync(join(dataRoot, 'state.json'), JSON.stringify({
  profiles:[], accounts:[], selectedAccount:null,
  settings:{language:'ru',theme:'light',javaPath:'',ramMb:4096,jvmArgs:'',resolutionWidth:1280,resolutionHeight:720,showSnapshots:false},
}));
const executable = resolve('target/release/aurum.exe');
const env = {...process.env, AURUM_DATA_DIR:dataRoot, WEBVIEW2_USER_DATA_FOLDER:join(root,'webview'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9227 --remote-debugging-address=127.0.0.1'};
let child, browser;
const errors = [];
async function start() {
  child = spawn(executable, [], {cwd:resolve('.'), env, windowsHide:true, stdio:'pipe'});
  for(let i=0;i<60;i++) {
    if(child.exitCode!==null) throw new Error(`Launcher exited ${child.exitCode}`);
    try {browser=await chromium.connectOverCDP('http://127.0.0.1:9227'); break;}
    catch {await new Promise(r=>setTimeout(r,250));}
  }
  assert(browser,'Test WebView2 did not start');
  const page=browser.contexts()[0].pages()[0];
  page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.nav-item').first().waitFor();
  return page;
}
async function stop() {
  if(browser) {await browser.close(); browser=undefined;}
  if(child && child.exitCode===null) {
    const exited=new Promise(r=>child.once('exit',r));
    child.kill(); await exited;
  }
}
const rpc=(page,action,payload={})=>page.evaluate(({action,payload})=>window.__TAURI_INTERNALS__.invoke('rpc',{action,payload}),{action,payload});
async function choose(page,name) {
  await page.locator('.language-current').click();
  await page.locator('.language-search input').fill(name);
  await page.getByRole('button',{name,exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
}
try {
  let page=await start();
  await page.getByRole('button',{name:'Настройки',exact:true}).click();
  await page.locator('.language-current').click();
  const names=await page.locator('.language-grid button').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label')));
  assert.equal(names.length,41);
  await page.screenshot({path:'docs/screenshots/languages-native.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  for(const name of names) {
    await choose(page,name);
    const snapshot=await rpc(page,'snapshot');
    const lang=await page.locator('html').getAttribute('lang');
    assert.equal(snapshot.settings.language,lang);
    assert.equal(snapshot.profiles.length,0);
    assert.equal(snapshot.accounts.length,0);
    assert.equal(await page.locator('html').getAttribute('dir'),['ar','he'].includes(lang)?'rtl':'ltr');
  }
  await choose(page,'Español');
  await stop();
  page=await start();
  await page.getByRole('heading',{name:'Inicio',exact:true}).waitFor();
  assert.equal((await rpc(page,'snapshot')).settings.language,'es');
  await page.getByRole('button',{name:'Ajustes',exact:true}).click();
  await page.getByRole('heading',{name:'Ajustes',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  const result={passed:true,languages:41,nativePersistence:true,errors,fixtureRoot:root};
  writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
} finally {await stop();}

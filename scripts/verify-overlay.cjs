// Run with Electron, not node: npm run verify:overlay.
// Uses generated title images + a local mock LCU; never captures the user's screen.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const { mkdtemp, mkdir, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let manager, server, temporary;

async function cleanup() {
  await manager?.dispose();
  if (server) await new Promise(resolve => server.close(resolve));
  for (const window of BrowserWindow.getAllWindows()) window.destroy();
  if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'aram-overlay-verification-'));
  app.setPath('userData', temporary);
  const dataRoot = path.join(temporary, 'data');
  const dataVersion = '0.0.1-smoke';
  const versionRoot = path.join(dataRoot, 'versions', dataVersion);
  await mkdir(path.join(versionRoot, 'champions'), { recursive: true });
  const names = ['小蜜蜂！！！', '尤里卡', '侵蚀'];
  const catalog = names.map((name, index) => ({ id: index + 1, name, rarity: [1, 2, 0][index] }));
  const champion = { id: 17, name: '测试英雄', stats: { winRate: .5 } };
  const details = { champion, augments: catalog.map((augment, index) => ({ ...augment,
    stats: index === 1 ? { winRate: null, games: null } : { winRate: index === 0 ? .6 : 0, games: 10 } })) };
  const files = {
    'manifest.json': { schemaVersion: 1, dataVersion, gamePatch: '0.0', locale: 'zh-CN',
      generatedAt: '2026-11-02T00:00:00Z', source: { name: 'local-test-fixture', region: 'TEST' }, files: [] },
    'champions.json': { data: [champion] }, 'augments.json': { data: catalog },
    'items.json': { data: [] }, 'champions/17.json': details,
  };
  await writeFile(path.join(dataRoot, 'current.json'), JSON.stringify({ dataVersion }));
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(versionRoot, name), JSON.stringify(data));

  let phase = 'ChampSelect';
  server = http.createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('riot:test-only').toString('base64')}`);
    let value;
    if (request.url.endsWith('gameflow-phase')) value = phase;
    else if (request.url === '/lol-gameflow/v1/session') value = { gameData: { playerChampionSelections: [{ summonerId: 7, championId: 17 }] } };
    else if (request.url.includes('current-summoner')) value = { summonerId: 7 };
    else value = { localPlayerCellId: 7, myTeam: [{ cellId: 7, championId: 17 }] };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(value));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const lockfile = path.join(temporary, 'lockfile');
  await writeFile(lockfile, `LeagueClient:123:${server.address().port}:test-only:http`);
  const { LcuService } = await import(path.join(root, 'src/main/lcu-service.js'));
  const { createOverlayManager } = await import(path.join(root, 'src/main/overlay-manager.js'));
  const { DEFAULT_REGIONS } = await import(path.join(root, 'src/main/overlay-settings.js'));
  const { readChampionList, readChampionOverview } = await import(path.join(root, 'src/main/data-query.js'));
  const { readActiveDataSet } = await import(path.join(root, 'src/main/data-store.js'));
  const lcu = new LcuService({ findLockfile: async () => lockfile });
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const fixture = new BrowserWindow({ width: 1600, height: 900, useContentSize: true, show: false,
    webPreferences: { offscreen: true, backgroundThrottling: false } });
  const regions = DEFAULT_REGIONS.map(region => ({ ...region, y: .37, width: .18, height: .08 }));
  const html = `<html><body style="margin:0;background:#162031;width:1600px;height:900px">${names.map((name, index) => {
    const region = regions[index];
    return `<div style="position:absolute;left:${region.x * 100}%;top:${region.y * 100}%;width:${region.width * 100}%;height:${region.height * 100}%;color:#f6efdf;background:#152032;font:26px 'PingFang SC','Microsoft YaHei',sans-serif;display:flex;align-items:center;justify-content:center">${name}</div>`;
  }).join('')}</body></html>`;
  await fixture.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  const image = await fixture.webContents.capturePage();
  const main = new BrowserWindow({ width: 960, height: 800, show: false, webPreferences: { sandbox: true,
    contextIsolation: true, preload: path.join(root, 'src/preload/preload.cjs') } });
  ipcMain.handle('data:get-active', async () => (await readActiveDataSet(dataRoot)).manifest);
  ipcMain.handle('data:get-champions', () => readChampionList(dataRoot));
  ipcMain.handle('data:get-champion-overview', (_event, id) => readChampionOverview(dataRoot, id));
  ipcMain.handle('lcu:get-snapshot', () => lcu.getSnapshot());
  let captures = 0;
  manager = await createOverlayManager({ getMainWindow: () => main, getDataRoot: () => dataRoot,
    capture: async () => { captures++; return image; } });
  await main.loadFile(path.join(root, 'src/renderer/index.html'));
  const run = expression => main.webContents.executeJavaScript(expression);
  await run(`window.aramAugmentAdvisor.overlay.saveCalibration(${JSON.stringify(regions)})`);
  manager.updateSession(await lcu.getSnapshot());
  await delay(100);
  assert.equal(captures, 0, '选人阶段不能截图');
  phase = 'InProgress';
  manager.updateSession(await lcu.getSnapshot());
  const started = Date.now();
  const state = await run('window.aramAugmentAdvisor.overlay.scanOnce()');
  assert.equal(state.visible, true, JSON.stringify(state));
  assert.deepEqual(state.slots.map(slot => slot.name), names);
  assert.deepEqual(state.slots.map(slot => slot.winRate), [.6, null, 0]);
  const overlay = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/overlay.html'));
  assert(overlay.isVisible());
  assert.deepEqual(await overlay.webContents.executeJavaScript(`[...document.querySelectorAll('[data-slot] h2')].map(element => element.textContent)`), names);
  const output = path.join(root, 'dist', 'verification');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'ocr-fixture.png'), image.toPNG());
  await writeFile(path.join(output, 'overlay.png'), (await overlay.webContents.capturePage()).toPNG());
  const latencyMs = Date.now() - started;
  const before = captures;
  await run('window.aramAugmentAdvisor.overlay.setEnabled(false)');
  assert.equal(overlay.isVisible(), false);
  assert.equal(captures, before);
  await run('window.aramAugmentAdvisor.overlay.setEnabled(true)');
  phase = 'Lobby'; manager.updateSession(await lcu.getSnapshot());
  assert.equal(overlay.isVisible(), false);
  const cleared = await run('window.aramAugmentAdvisor.overlay.getState()');
  assert.equal(cleared.championId, 0);
  assert(cleared.slots.every(slot => slot.missing));
  await assert.rejects(overlay.webContents.executeJavaScript('window.aramAugmentAdvisor.overlay.captureCalibration()'));
  console.log(JSON.stringify({ result: 'PASS', realLocalChineseOcr: true, phaseControl: true,
    trustedIpc: true, unknownRatePreserved: true, latencyMs, output }));
  await cleanup(); app.exit(0);
})().catch(async error => { console.error(error); await cleanup(); app.exit(1); });

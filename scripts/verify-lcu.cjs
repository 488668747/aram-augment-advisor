// Exercise the actual application, settings IPC and DOM against a local LCU fixture.
// No real game client, screen capture or account is used.
const { app, BrowserWindow, dialog, session } = require('electron');
const { mkdtemp, mkdir, writeFile, readFile, rm, unlink } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let temporary, server;

async function until(probe, description) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await delay(50);
  }
  throw new Error(`等待超时：${description}`);
}

(async () => {
  assert.equal(process.platform, 'darwin', '此开发验证脚本仅在没有真实客户端的 macOS 上运行');
  assert(!existsSync('/Applications/League of Legends.app'), '验证环境不能安装真实游戏客户端');
  assert(!/LeagueClient(?:Ux)?(?:\.exe)?\s/.test(execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' })), '验证时不能运行真实游戏客户端');
  for (const key of ['ARAM_LCU_LOCKFILE_PATH', 'LEAGUE_CLIENT_LOCKFILE', 'RIOT_LOCKFILE_PATH']) delete process.env[key];
  temporary = await mkdtemp(path.join(os.tmpdir(), 'aram-lcu-verification-'));
  const userData = path.join(temporary, 'user');
  await mkdir(userData);
  app.setPath('userData', userData);
  const directory = path.join(temporary, '腾讯游戏', '英雄联盟');
  const client = path.join(directory, 'LeagueClient');
  await mkdir(client, { recursive: true });
  await writeFile(path.join(client, 'LeagueClient.exe'), 'fixture only');
  server = http.createServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, `Basic ${Buffer.from('riot:fixture-only').toString('base64')}`);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.url.endsWith('gameflow-phase') ? 'ChampSelect'
      : { localPlayerCellId: 7, myTeam: [{ cellId: 7, championId: 17 }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const lockfile = path.join(client, 'lockfile');
  await writeFile(lockfile, '');
  const clientLog = path.join(client, 'LeagueClientUx.log');
  await writeFile(clientLog, `fixture LCU http://riot:fixture-only@127.0.0.1:${server.address().port}\n`);
  // 残留自动候选不能阻断后续手动目录中的有效连接。
  const staleLockfile = path.join(temporary, 'stale-lockfile');
  await writeFile(staleLockfile, 'invalid stale fixture');
  process.env.ARAM_LCU_LOCKFILE_PATH = staleLockfile;
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  app.on('browser-window-created', (_event, window) => window.hide());
  await import(pathToFileURL(path.join(root, 'src/main/main.js')).href);
  let main;
  await until(async () => {
    main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().endsWith('/index.html'));
    return main && await main.webContents.executeJavaScript('!document.querySelector("#lcu-save").disabled');
  }, '主窗口与配置接口初始化');
  const run = expression => main.webContents.executeJavaScript(expression);
  const feedback = () => run('document.querySelector("#lcu-feedback").textContent');
  const idle = () => run('!document.querySelector("#lcu-save").disabled');
  const setDirectory = value => run(`document.querySelector('#lcu-directory').value = ${JSON.stringify(value)}; document.querySelector('#lcu-save').click()`);
  await setDirectory(temporary);
  await until(async () => await idle() && /不要选择 WeGame/.test(await feedback()), '错误目录校验');
  assert.equal((await run('window.aramAugmentAdvisor.lcu.getSettings()')).clientDirectory, '');
  const originalDialog = dialog.showOpenDialog;
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  await run('document.querySelector("#lcu-browse").click()');
  await until(async () => await idle() && (await run('document.querySelector("#lcu-directory").value')) === directory, '选择目录');
  dialog.showOpenDialog = originalDialog;
  await run('document.querySelector("#lcu-save").click()');
  await until(async () => await idle() && /已保存/.test(await feedback()), '保存并检测');
  assert.match(await run('document.querySelector("#lcu-status").textContent'), /已连接，正在选人/);
  await until(async () => await run('document.querySelector("#champion-select").value === "17"'), '英雄自动跟随');
  const saved = JSON.parse(await readFile(path.join(userData, 'lcu-settings.json'), 'utf8'));
  assert.deepEqual(saved, { clientDirectory: directory });
  const overlay = BrowserWindow.getAllWindows().find(window => window !== main);
  await assert.rejects(overlay.webContents.executeJavaScript('window.aramAugmentAdvisor.lcu.saveDirectory("")'));
  const output = path.join(root, 'dist', 'verification', 'lcu-settings.png');
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, (await main.webContents.capturePage()).toPNG());
  await unlink(lockfile);
  await unlink(clientLog);
  await unlink(staleLockfile);
  delete process.env.ARAM_LCU_LOCKFILE_PATH;
  await run('document.querySelector("#lcu-retry").click()');
  await until(async () => await idle() && /连接文件/.test(await run('document.querySelector("#lcu-connection-detail").textContent')), '连接文件丢失提示');
  await run('document.querySelector("#lcu-clear").click()');
  await until(async () => await idle() && /已清除/.test(await feedback()), '清除配置');
  assert.deepEqual(JSON.parse(await readFile(path.join(userData, 'lcu-settings.json'), 'utf8')), { clientDirectory: '' });
  assert.equal(await run('document.querySelector("#lcu-directory").value'), '');
  console.log(JSON.stringify({ result: 'PASS', actualApplication: true, settingsIpc: true,
    directoryPicker: true, championFollow: true, savedToDisk: true, errorHints: true,
    clearSettings: true, restrictedIpc: true, output }));
  await cleanup();
  app.exit(0);
})().catch(async error => { console.error(error); await cleanup(); app.exit(1); });

async function cleanup() {
  if (server) await new Promise(resolve => server.close(resolve));
  if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

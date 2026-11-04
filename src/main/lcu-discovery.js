import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseProcessConnection, findClientLogCandidates } from './lcu-client.js';

const execFileAsync = promisify(execFile);

export function normalizeClientDirectory(value, platform = process.platform) {
  if (typeof value !== 'string') throw new Error('客户端路径必须是文字');
  const paths = platform === 'win32' ? path.win32 : path;
  const cleaned = value.trim().replace(/^"(.*)"$/, '$1');
  if (!cleaned) return '';
  if (!paths.isAbsolute(cleaned) || /[\r\n\0]/.test(cleaned)) throw new Error('请选择客户端所在的完整目录路径');
  const normalized = paths.normalize(cleaned);
  const executable = platform === 'win32' ? /^(?:LeagueClient(?:Ux)?\.exe|lockfile)$/i
    : /^(?:LeagueClient(?:Ux)?|lockfile)$/i;
  return executable.test(paths.basename(normalized))
    ? paths.dirname(normalized) : normalized;
}

export function clientLockfileCandidates(directory, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path;
  const candidates = [paths.join(directory, 'lockfile'), paths.join(directory, 'LeagueClient', 'lockfile')];
  if (paths.basename(directory).toLowerCase() === 'leagueclient') candidates.push(paths.join(paths.dirname(directory), 'lockfile'));
  if (platform === 'darwin') candidates.push(paths.join(directory, 'Contents', 'LoL', 'lockfile'));
  return candidates;
}

export function extractInstallDirectory(commandLine) {
  const match = String(commandLine).match(/--install-directory(?:=|\s+)(?:"([^"]+)"|([^\s]+))/i);
  return match?.[1] ?? match?.[2] ?? null;
}

function getCandidatePaths(env, platform) {
  const join = platform === 'win32' ? path.win32.join : path.join;
  const candidates = [
    env.ARAM_LCU_LOCKFILE_PATH,
    env.LEAGUE_CLIENT_LOCKFILE,
    env.RIOT_LOCKFILE_PATH,
  ].filter(Boolean);

  if (env.ProgramFiles) {
    candidates.push(join(env.ProgramFiles, 'Riot Games', 'League of Legends', 'lockfile'));
  }
  if (env['ProgramFiles(x86)']) {
    candidates.push(join(env['ProgramFiles(x86)'], 'Riot Games', 'League of Legends', 'lockfile'));
  }
  candidates.push('/Applications/League of Legends.app/Contents/LoL/lockfile');

  return [...new Set(candidates)];
}

async function getProcessLocations(platform, exec = execFileAsync) {
  if (platform === 'win32') {
    const result = await exec('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $ErrorActionPreference = 'Stop'; @(Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe' OR Name = 'LeagueClient.exe'\" | Select-Object Name,ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress",
    ], { timeout: 15000, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 });
    const output = result.stdout.trim().replace(/^\uFEFF/, '');
    if (!output) return [];
    if (/^[\[{]/.test(output)) {
      const records = JSON.parse(output);
      return (Array.isArray(records) ? records : [records]).filter(Boolean);
    }
    return output.split(/\r?\n/).filter(Boolean).map(CommandLine => ({ CommandLine }));
  }

  const result = await exec('ps', ['-axo', 'command='], { timeout: 4000 });
  return result.stdout.split(/\r?\n/).filter(line => /LeagueClient/i.test(line)).map(CommandLine => ({ CommandLine }));
}

export async function discoverLcuCandidates({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  exec = execFileAsync,
  configuredPath = '',
  includeAuth = true,
  listLogs = findClientLogCandidates,
} = {}) {
  const candidates = [env.ARAM_LCU_LOCKFILE_PATH, env.LEAGUE_CLIENT_LOCKFILE, env.RIOT_LOCKFILE_PATH].filter(Boolean);
  const processConnections = [];
  const directories = new Set();
  const processIds = [];
  let scanFailed = false;
  let processFound = false;
  try {
    const locations = await getProcessLocations(platform, exec);
    processFound = locations.length > 0;
    locations.sort((a, b) => Number(/LeagueClientUx/i.test(b.Name ?? b.ExecutablePath ?? b.CommandLine ?? ''))
      - Number(/LeagueClientUx/i.test(a.Name ?? a.ExecutablePath ?? a.CommandLine ?? '')));
    for (const location of locations) {
      const command = String(location.CommandLine ?? '');
      const connection = includeAuth && parseProcessConnection(command, location);
      if (connection) processConnections.push({ kind: 'process', connection });
      if (Number.isInteger(location.ProcessId) && location.ProcessId > 0) processIds.push(location.ProcessId);
      const executable = location.ExecutablePath ?? command.match(/^"([^"]*LeagueClient(?:Ux)?(?:\.exe)?)"/i)?.[1];
      for (const candidate of [executable, extractInstallDirectory(command)].filter(Boolean)) {
        try {
          const directory = normalizeClientDirectory(candidate, platform);
          directories.add(directory);
          if ((platform === 'win32' ? path.win32 : path).basename(directory).toLowerCase() === 'leagueclient') {
            directories.add((platform === 'win32' ? path.win32 : path).dirname(directory));
          }
          candidates.push(...clientLockfileCandidates(directory, platform));
        } catch { /* 单条不可用的进程路径不能阻断其他候选。 */ }
      }
    }
  } catch {
    // 不回传进程命令行或 PowerShell 原始错误，其中可能包含连接令牌。
    scanFailed = true;
  }

  candidates.push(...getCandidatePaths(env, platform));
  if (configuredPath) {
    const directory = normalizeClientDirectory(configuredPath, platform);
    directories.add(directory);
    const paths = platform === 'win32' ? path.win32 : path;
    if (paths.basename(directory).toLowerCase() === 'leagueclient') directories.add(paths.dirname(directory));
    candidates.push(...clientLockfileCandidates(directory, platform));
  }
  const found = [...processConnections, ...[...new Set(candidates)].filter(candidate => exists(candidate)),
    ...(includeAuth ? await listLogs([...directories], processIds) : [])];
  if (found.length) return found;
  if (configuredPath) {
    throw new Error('已配置目录中未找到连接文件，请启动并登录英雄联盟客户端，或重新选择客户端目录。');
  }
  if (scanFailed) throw new Error('无法读取客户端进程信息，请手动选择英雄联盟客户端目录。若客户端以管理员身份运行，请让助手使用相同权限。');
  if (processFound) throw new Error('检测到客户端进程，但未找到连接文件。请等待客户端完成启动，或手动选择英雄联盟客户端目录；若使用管理员权限启动，请让助手使用相同权限。');
  return [];
}

export async function discoverLockfilePaths(options = {}) {
  return discoverLcuCandidates({ ...options, includeAuth: false });
}

export async function discoverLockfilePath(options) {
  return (await discoverLockfilePaths(options))[0] ?? null;
}

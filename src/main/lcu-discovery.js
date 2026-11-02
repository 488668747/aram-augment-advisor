import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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

async function getProcessCommandLines(platform, exec = execFileAsync) {
  if (platform === 'win32') {
    const result = await exec('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name = 'LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine",
    ]);
    return result.stdout.split(/\r?\n/).filter(Boolean);
  }

  const result = await exec('ps', ['-axo', 'command=']);
  return result.stdout.split(/\r?\n/).filter((line) => /LeagueClient/i.test(line));
}

export async function discoverLockfilePath({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
  exec = execFileAsync,
} = {}) {
  const directPath = getCandidatePaths(env, platform).find((candidate) => exists(candidate));
  if (directPath) return directPath;

  try {
    const commands = await getProcessCommandLines(platform, exec);
    for (const command of commands) {
      const installDirectory = extractInstallDirectory(command);
      if (!installDirectory) continue;
      const join = platform === 'win32' ? path.win32.join : path.join;
      const lockfilePath = join(installDirectory, 'lockfile');
      if (exists(lockfilePath)) return lockfilePath;
    }
  } catch {
    // 进程扫描失败时保持未连接状态，不影响应用其他功能。
  }

  return null;
}

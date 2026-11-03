import { statSync } from 'node:fs';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { clientLockfileCandidates, normalizeClientDirectory } from './lcu-discovery.js';

export function validateClientDirectory(value, { platform = process.platform, isFile = filename => {
  try { return statSync(filename).isFile(); } catch { return false; }
} } = {}) {
  const directory = normalizeClientDirectory(value, platform);
  if (!directory) return '';
  const paths = platform === 'win32' ? path.win32 : path;
  const candidates = clientLockfileCandidates(directory, platform).flatMap(filename => [filename,
    ...['LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClient', 'LeagueClientUx'].map(name => paths.join(paths.dirname(filename), name))]);
  if (!candidates.some(isFile)) throw new Error('该目录中没有找到 LeagueClient.exe 或连接文件，请选择英雄联盟安装目录或其中的 LeagueClient 目录，不要选择 WeGame 目录。');
  return directory;
}

export async function loadLcuSettings(filename) {
  try {
    const saved = JSON.parse(await readFile(filename, 'utf8'));
    return { clientDirectory: normalizeClientDirectory(saved.clientDirectory) };
  } catch { return { clientDirectory: '' }; }
}

export async function saveLcuSettings(filename, clientDirectory) {
  const safe = { clientDirectory: normalizeClientDirectory(clientDirectory) };
  await mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
  return safe;
}

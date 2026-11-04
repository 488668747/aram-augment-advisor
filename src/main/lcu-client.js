import { readFile, open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

function decodeText(content) {
  if (!Buffer.isBuffer(content)) return String(content).trim();
  if (content[0] === 255 && content[1] === 254) return content.subarray(2).toString('utf16le').trim();
  if (content[0] === 254 && content[1] === 255 && content.length % 2 === 0) {
    return Buffer.from(content.subarray(2)).swap16().toString('utf16le').trim();
  }
  return content.toString('utf8').trim();
}

function validPort(value) { return /^\d+$/.test(String(value)) && Number(value) > 0 && Number(value) <= 65535; }

export function parseLockfile(content) {
  const text = decodeText(content);
  if (!text) throw new Error('客户端连接文件为空，请等待客户端完成启动；正在尝试其他连接方式。');
  const fields = text.split(':');
  if (fields.length !== 5) throw new Error('客户端连接文件不是标准 LCU 格式；正在尝试进程参数和客户端日志。');

  const [name, pid, portText, token, protocol] = fields;
  const port = Number(portText);
  if (!name || !/^[1-9]\d*$/.test(pid) || !validPort(portText) || !token || !/^https?$/.test(protocol) || /\0/.test(text)) {
    throw new Error('LCU lockfile 缺少有效字段');
  }

  return { name, pid, port, token, protocol };
}

export async function readLockfile(lockfilePath) {
  return parseLockfile(await readFile(lockfilePath));
}

function commandArgument(command, argument) {
  const match = command.match(new RegExp(`(?:^|[\\s"])--${argument}(?:=|\\s+)(?:"([^"\\r\\n]+)"|([^\\s"]+))`, 'i'));
  return match?.[1] ?? match?.[2] ?? null;
}

export function parseProcessConnection(command, record = {}) {
  if (typeof command !== 'string') return null;
  const port = commandArgument(command, 'app-port');
  const token = commandArgument(command, 'remoting-auth-token');
  if (!validPort(port) || !token || /[\s\0]/.test(token)) return null;
  return { name: record.Name ?? 'LeagueClientUx', pid: String(record.ProcessId ?? 0),
    port: Number(port), token, protocol: 'https' };
}

export function parseLogConnection(content) {
  for (const line of decodeText(content).split(/\r?\n/).reverse()) {
    const connection = parseProcessConnection(line);
    if (connection) return connection;
    const match = line.match(/\b(https?):\/\/riot:([^@\s]+)@127\.0\.0\.1:(\d+)\b/);
    if (match && validPort(match[3])) return { name: 'LeagueClientUx', pid: '0', port: Number(match[3]), token: match[2], protocol: match[1] };
  }
  return null;
}

export async function readLogConnection(filename) {
  const file = await open(filename, 'r');
  try {
    const { size } = await file.stat();
    const length = Math.min(size, 256 * 1024);
    const start = Buffer.alloc(length);
    const first = await file.read(start, 0, length, 0);
    const chunks = [start.subarray(0, first.bytesRead)];
    if (size > length) {
      // 分段边界可能切断端口或令牌，不能把截断的半行当成完整凭据。
      chunks[0] = chunks[0].subarray(0, Math.max(0, chunks[0].lastIndexOf(10) + 1));
      const tail = Buffer.alloc(length);
      const last = await file.read(tail, 0, length, Math.max(length, size - length));
      const segment = tail.subarray(0, last.bytesRead);
      const newline = segment.indexOf(10);
      chunks.push(Buffer.from('\n'), newline < 0 ? Buffer.alloc(0) : segment.subarray(newline + 1));
    }
    const connection = parseLogConnection(Buffer.concat(chunks));
    if (!connection) throw new Error('未从客户端日志发现有效的本地连接信息，请确认客户端已进入主界面，并让助手与客户端使用相同权限。');
    return connection;
  } finally { await file.close(); }
}

export async function findClientLogCandidates(directories, processIds = []) {
  const candidates = [];
  const locations = new Set();
  for (const directory of directories) {
    for (const root of [directory, path.join(directory, 'LeagueClient')]) {
      for (const location of [root, path.join(root, 'Logs'), path.join(root, 'Logs', 'LeagueClient Logs')]) locations.add(location);
    }
  }
  for (const directory of locations) {
    try {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/(?:^|_)LeagueClientUx\.log$/i.test(entry.name)) continue;
        const filename = path.join(directory, entry.name);
        const metadata = await stat(filename).catch(() => null);
        if (metadata) candidates.push({ path: filename, modified: metadata.mtimeMs,
          matched: processIds.some(pid => entry.name.endsWith(`_${pid}_LeagueClientUx.log`)) });
      }
    } catch { /* 客户端日志目录可能不存在或正在轮换。 */ }
  }
  return candidates.sort((a, b) => Number(b.matched) - Number(a.matched) || b.modified - a.modified)
    .slice(0, 3).map(candidate => ({ kind: 'log', path: candidate.path }));
}

function requestJson(pathname, connection) {
  const transport = connection.protocol === 'http' ? http : https;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: '127.0.0.1',
      port: connection.port,
      path: pathname,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`riot:${connection.token}`).toString('base64')}`,
      },
      rejectUnauthorized: false,
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`LCU 请求失败：${response.statusCode}`));
          return;
        }

        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error(`LCU 返回内容不是有效 JSON：${pathname}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(3000, () => request.destroy(new Error('LCU 请求超时')));
    request.end();
  });
}

export class LcuClient {
  constructor(connection, request = requestJson) {
    this.connection = connection;
    this.request = request;
  }

  getGameflowPhase() {
    return this.request('/lol-gameflow/v1/gameflow-phase', this.connection);
  }

  getChampSelectSession() {
    return this.request('/lol-champ-select/v1/session', this.connection);
  }

  getGameflowSession() {
    return this.request('/lol-gameflow/v1/session', this.connection);
  }

  getCurrentSummoner() {
    return this.request('/lol-summoner/v1/current-summoner', this.connection);
  }
}

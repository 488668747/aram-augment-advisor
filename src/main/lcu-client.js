import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';

export function parseLockfile(content) {
  const fields = String(content).trim().split(':');
  if (fields.length < 5) throw new Error('LCU lockfile 格式无效');

  const [name, pid, portText, token, protocol] = fields;
  const port = Number(portText);
  if (!name || !pid || !Number.isInteger(port) || port <= 0 || !token || !protocol) {
    throw new Error('LCU lockfile 缺少有效字段');
  }

  return { name, pid, port, token, protocol };
}

export async function readLockfile(lockfilePath) {
  return parseLockfile(await readFile(lockfilePath, 'utf8'));
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
}

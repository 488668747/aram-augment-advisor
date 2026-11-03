import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverLockfilePath } from '../src/main/lcu-discovery.js';

test('国服进程没有安装参数时从实际程序路径发现 LeagueClient 子目录的连接文件', async () => {
  const expected = 'D:\\腾讯游戏\\英雄联盟\\LeagueClient\\lockfile';
  const found = await discoverLockfilePath({ platform: 'win32', env: {},
    exists: filename => filename === expected,
    exec: async () => ({ stdout: JSON.stringify([{ ExecutablePath: 'D:\\腾讯游戏\\英雄联盟\\LeagueClient\\LeagueClientUx.exe', CommandLine: '"D:\\腾讯游戏\\英雄联盟\\LeagueClient\\LeagueClientUx.exe" --app-port=2999' }]) }),
  });
  assert.equal(found, expected);
});

test('进程安装参数指向游戏根目录时也检查 LeagueClient 子目录', async () => {
  const expected = 'D:\\WeGameApps\\英雄联盟\\LeagueClient\\lockfile';
  assert.equal(await discoverLockfilePath({ platform: 'win32', env: {},
    exists: filename => filename === expected,
    exec: async () => ({ stdout: 'LeagueClient.exe --install-directory="D:\\WeGameApps\\英雄联盟"' }),
  }), expected);
});

test('自动扫描权限失败时仍可用手动配置的目录兜底', async () => {
  const expected = 'E:\\英雄联盟\\LeagueClient\\lockfile';
  assert.equal(await discoverLockfilePath({ platform: 'win32', env: {}, configuredPath: 'E:\\英雄联盟',
    exists: filename => filename === expected,
    exec: async () => { throw new Error('Access denied: --remoting-auth-token=do-not-expose'); },
  }), expected);
});

test('自动发现成功时优先使用自动发现结果', async () => {
  const expected = 'D:\\英雄联盟\\LeagueClient\\lockfile';
  assert.equal(await discoverLockfilePath({ platform: 'win32', env: {}, configuredPath: 'E:\\旧安装',
    exists: filename => [expected, 'E:\\旧安装\\lockfile'].includes(filename),
    exec: async () => ({ stdout: JSON.stringify({ ExecutablePath: 'D:\\英雄联盟\\LeagueClient\\LeagueClient.exe' }) }),
  }), expected);
});

test('实际运行程序旁的连接文件优先于安装根目录的残留文件', async () => {
  const expected = 'D:\\英雄联盟\\LeagueClient\\lockfile';
  assert.equal(await discoverLockfilePath({ platform: 'win32', env: {},
    exists: filename => [expected, 'D:\\英雄联盟\\lockfile'].includes(filename),
    exec: async () => ({ stdout: JSON.stringify({ ExecutablePath: 'D:\\英雄联盟\\LeagueClient\\LeagueClient.exe',
      CommandLine: '--install-directory="D:\\英雄联盟"' }) }),
  }), expected);
});

test('扫描失败返回安全的排查提示，不暴露进程命令行和令牌', async () => {
  await assert.rejects(discoverLockfilePath({ platform: 'win32', env: {}, exists: () => false,
    exec: async () => { throw new Error('Access denied: --remoting-auth-token=secret'); },
  }), error => /手动|选择/.test(error.message) && !/secret|remoting-auth-token/.test(error.message));
});

test('已配置目录没有连接文件时提示启动客户端或重新选择目录', async () => {
  await assert.rejects(discoverLockfilePath({ platform: 'win32', env: {}, configuredPath: 'E:\\英雄联盟',
    exists: () => false, exec: async () => ({ stdout: '[]' }),
  }), /连接文件.*启动|启动.*连接文件/);
});

test('Windows 自动扫描覆盖两种客户端进程，限制超时、隐藏命令窗口并使用 UTF-8', async () => {
  assert.equal(await discoverLockfilePath({ platform: 'win32', env: {}, exists: () => false,
    exec: async (file, args, options) => {
      assert.equal(file, 'powershell.exe');
      assert.match(args.at(-1), /LeagueClientUx\.exe.*LeagueClient\.exe/);
      assert.match(args.at(-1), /UTF8Encoding/);
      assert.equal(options.windowsHide, true);
      assert.equal(options.timeout, 15000);
      return { stdout: '[]' };
    },
  }), null);
});

test('Windows 实机执行 PowerShell 进程查询', { skip: process.platform !== 'win32' }, async () => {
  assert.equal(await discoverLockfilePath({ env: {}, exists: () => false }), null);
});

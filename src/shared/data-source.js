import { DataValidationError, validateDataVersion, validateRelativeDataPath } from './data-model.js';

function sha256FromRemoteHash(hash, filePath) {
  if (typeof hash !== 'string' || !hash.startsWith('sha256-')) {
    throw new DataValidationError(`远端数据缺少 SHA-256：${filePath}`);
  }

  const value = hash.slice('sha256-'.length).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new DataValidationError(`远端 SHA-256 格式错误：${filePath}`);
  }

  return value;
}

export function normalizeRemoteManifest(remoteManifest, { locale, origin }) {
  if (!remoteManifest || typeof remoteManifest !== 'object') {
    throw new DataValidationError('远端 manifest 必须是对象');
  }

  if (remoteManifest.locale !== locale) {
    throw new DataValidationError(`远端数据语言不匹配：${String(remoteManifest.locale)}`);
  }

  validateDataVersion(remoteManifest.dataVersion);

  if (typeof remoteManifest.gamePatch !== 'string' || !/^\d+\.\d+$/.test(remoteManifest.gamePatch)) {
    throw new DataValidationError('远端 manifest 缺少有效的 gamePatch');
  }

  if (!Array.isArray(remoteManifest.files) || remoteManifest.files.length === 0) {
    throw new DataValidationError('远端 manifest 缺少 files');
  }

  const apiOrigin = new URL(origin).origin;
  const files = remoteManifest.files.map((file) => {
    if (!file || typeof file !== 'object') {
      throw new DataValidationError('远端 files 包含无效条目');
    }

    const filePath = validateRelativeDataPath(file.path);
    const url = new URL(file.url, apiOrigin);
    if (url.origin !== apiOrigin || !url.pathname.startsWith('/')) {
      throw new DataValidationError(`远端文件 URL 不在允许来源：${filePath}`);
    }

    return {
      path: filePath,
      url: url.toString(),
      bytes: file.bytes,
      sha256: sha256FromRemoteHash(file.hash, filePath),
    };
  });

  return {
    schemaVersion: 1,
    dataVersion: remoteManifest.dataVersion,
    gamePatch: remoteManifest.gamePatch,
    locale,
    generatedAt: remoteManifest.generatedAt,
    source: {
      name: remoteManifest.service ?? 'remote-client-data',
      region: 'WORLD',
      origin: apiOrigin,
    },
    files,
  };
}

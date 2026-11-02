export class DataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataValidationError';
  }
}

const DATA_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function validateRelativeDataPath(filePath) {
  if (
    typeof filePath !== 'string'
    || filePath.length === 0
    || filePath.startsWith('/')
    || filePath.includes('\\')
    || filePath.includes('\0')
    || filePath.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new DataValidationError(`包含不安全的文件路径：${String(filePath)}`);
  }

  return filePath;
}

export function validateDataVersion(dataVersion) {
  if (typeof dataVersion !== 'string' || !DATA_VERSION_PATTERN.test(dataVersion)) {
    throw new DataValidationError(`无效的数据版本：${String(dataVersion)}`);
  }

  return dataVersion;
}

export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new DataValidationError('manifest 必须是对象');
  }

  if (manifest.schemaVersion !== 1) {
    throw new DataValidationError('manifest 缺少受支持的 schemaVersion');
  }

  validateDataVersion(manifest.dataVersion);

  if (typeof manifest.gamePatch !== 'string' || !/^\d+\.\d+$/.test(manifest.gamePatch)) {
    throw new DataValidationError('manifest 缺少有效的 gamePatch');
  }

  if (manifest.locale !== 'zh-CN') {
    throw new DataValidationError('当前只支持 zh-CN 数据');
  }

  if (typeof manifest.generatedAt !== 'string' || Number.isNaN(Date.parse(manifest.generatedAt))) {
    throw new DataValidationError('manifest 缺少有效的 generatedAt');
  }

  return manifest;
}

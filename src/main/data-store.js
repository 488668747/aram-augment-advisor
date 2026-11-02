import { createHash, randomUUID } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  DataValidationError,
  validateRelativeDataPath,
  validateDataVersion,
  validateManifest,
} from '../shared/data-model.js';

async function readJson(filePath) {
  let content;

  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new DataValidationError(`无法读取数据文件：${filePath}`);
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new DataValidationError(`数据文件不是有效 JSON：${filePath}`);
  }
}

function validateRelativeFilePath(filePath) {
  try {
    return validateRelativeDataPath(filePath);
  } catch {
    throw new DataValidationError(`manifest 包含不安全的文件路径：${String(filePath)}`);
  }
}

async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

async function validateVersionDirectory(versionDirectory, { requireFileHashes = false } = {}) {
  const manifest = validateManifest(await readJson(path.join(versionDirectory, 'manifest.json')));

  if (!Array.isArray(manifest.files)) {
    throw new DataValidationError('manifest 缺少 files 文件清单');
  }

  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') {
      throw new DataValidationError('manifest.files 包含无效条目');
    }

    const relativePath = validateRelativeFilePath(file.path);
    const absolutePath = path.resolve(versionDirectory, relativePath);
    const versionRoot = `${path.resolve(versionDirectory)}${path.sep}`;

    if (!absolutePath.startsWith(versionRoot)) {
      throw new DataValidationError(`manifest 文件超出版本目录：${relativePath}`);
    }

    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) {
        throw new DataValidationError(`manifest 文件不是普通文件：${relativePath}`);
      }
    } catch (error) {
      if (error instanceof DataValidationError) throw error;
      throw new DataValidationError(`manifest 文件不存在：${relativePath}`);
    }

    if (requireFileHashes || file.sha256 !== undefined) {
      if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw new DataValidationError(`manifest 缺少有效的 SHA-256：${relativePath}`);
      }

      const actualHash = await sha256File(absolutePath);
      if (actualHash !== file.sha256) {
        throw new DataValidationError(`文件校验失败：${relativePath}`);
      }
    }
  }

  return manifest;
}

export async function readActiveDataSet(dataRoot) {
  const root = path.resolve(dataRoot);
  const pointerPath = path.join(root, 'current.json');
  const pointer = await readJson(pointerPath);
  const dataVersion = validateDataVersion(pointer?.dataVersion);
  const versionDirectory = path.join(root, 'versions', dataVersion);
  const manifestPath = path.join(versionDirectory, 'manifest.json');
  const manifest = validateManifest(await readJson(manifestPath));

  if (manifest.dataVersion !== dataVersion) {
    throw new DataValidationError(
      `current.json 指向版本 ${dataVersion}，但 manifest 是 ${manifest.dataVersion}`,
    );
  }

  return {
    currentFile: pointerPath,
    manifest,
    versionDirectory,
  };
}

export async function readActiveDataFile(dataRoot, relativePath) {
  const active = await readActiveDataSet(dataRoot);
  let safePath;

  try {
    safePath = validateRelativeDataPath(relativePath);
  } catch {
    throw new DataValidationError(`数据文件路径不安全：${String(relativePath)}`);
  }

  const filePath = path.resolve(active.versionDirectory, safePath);
  const versionRoot = `${path.resolve(active.versionDirectory)}${path.sep}`;
  if (!filePath.startsWith(versionRoot)) {
    throw new DataValidationError(`数据文件超出版本目录：${safePath}`);
  }

  return readJson(filePath);
}

export async function importDataVersion({ sourceDirectory, dataRoot, replaceExisting = false }) {
  const source = path.resolve(sourceDirectory);
  const root = path.resolve(dataRoot);
  const sourceManifest = await validateVersionDirectory(source, { requireFileHashes: true });
  const versionsDirectory = path.join(root, 'versions');
  const targetDirectory = path.join(versionsDirectory, sourceManifest.dataVersion);
  const temporaryDirectory = path.join(versionsDirectory, `.import-${randomUUID()}`);
  let backupDirectory;

  await mkdir(versionsDirectory, { recursive: true });

  try {
    await cp(source, temporaryDirectory, { recursive: true, errorOnExist: true });
    const manifest = await validateVersionDirectory(temporaryDirectory, { requireFileHashes: true });

    try {
      await stat(targetDirectory);
      if (!replaceExisting) {
        throw new DataValidationError(`数据版本已存在：${manifest.dataVersion}`);
      }
      backupDirectory = `${targetDirectory}.backup-${randomUUID()}`;
      await rename(targetDirectory, backupDirectory);
    } catch (error) {
      if (error instanceof DataValidationError) throw error;
      if (!(error instanceof Error) || error.code !== 'ENOENT') throw error;
    }

    await rename(temporaryDirectory, targetDirectory);

    const pointerPath = path.join(root, 'current.json');
    const temporaryPointerPath = path.join(root, `.current-${randomUUID()}.json`);
    await writeFile(temporaryPointerPath, `${JSON.stringify({ dataVersion: manifest.dataVersion }, null, 2)}\n`);
    await rename(temporaryPointerPath, pointerPath);
    if (backupDirectory) await rm(backupDirectory, { recursive: true, force: true });

    return {
      dataVersion: manifest.dataVersion,
      manifest,
      versionDirectory: targetDirectory,
    };
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    if (backupDirectory) {
      await rm(targetDirectory, { recursive: true, force: true });
      await rename(backupDirectory, targetDirectory).catch(() => {});
    }
    throw error;
  }
}

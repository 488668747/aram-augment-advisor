import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DataValidationError,
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

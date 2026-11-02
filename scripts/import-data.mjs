import path from 'node:path';
import process from 'node:process';

import { importDataVersion } from '../src/main/data-store.js';

const [, , sourceDirectory, dataRoot = path.resolve('data')] = process.argv;

if (!sourceDirectory) {
  console.error('用法：npm run data:import -- <数据版本目录> [本地数据根目录]');
  process.exitCode = 1;
} else {
  try {
    const result = await importDataVersion({ sourceDirectory, dataRoot });
    console.log(`已激活数据版本 ${result.dataVersion}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

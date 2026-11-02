import path from 'node:path';

import { syncGlobalData } from '../src/main/data-sync.js';

const result = await syncGlobalData({
  apiOrigin: process.env.ARAM_DATA_ORIGIN ?? 'https://data.dtodo.cn',
  dataRoot: path.resolve(process.env.ARAM_DATA_ROOT ?? 'data/runtime'),
  concurrency: Number(process.env.ARAM_DATA_CONCURRENCY ?? 6),
  onProgress: ({ completed, total }) => {
    if (completed === total || completed % 25 === 0) {
      console.log(`已下载 ${completed}/${total} 个文件`);
    }
  },
});

console.log(`已同步全球数据：${result.dataVersion}（${result.fileCount} 个文件）`);

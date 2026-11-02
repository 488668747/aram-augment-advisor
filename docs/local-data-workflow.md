# 本地数据工作流

第一阶段不让游戏内功能依赖网络。应用启动时读取 `data/current.json`，再加载 `data/versions/<dataVersion>/manifest.json`。manifest 校验通过后，应用才使用该版本的数据。

## 数据版本目录

```text
data/
  current.json
  versions/
    16.21.5/
      manifest.json
      sample-data.json
```

`manifest.json` 至少包含：

- `schemaVersion`
- `dataVersion`
- `gamePatch`
- `locale`
- `generatedAt`
- `files[].path`
- `files[].sha256`

统计数据的正式结构后续会扩展为英雄、海克斯、装备，以及以下条件统计：

```text
champion -> stats
champion + augment -> stats
champion + selectedAugments + candidateAugment -> stats
```

其中主要推荐依据是当前英雄与海克斯组合的胜率，全局海克斯胜率只作为辅助信息和样本不足时的回退。

## 手动更新

### 自动整理数据源

执行：

```bash
npm run data:sync
```

脚本读取当前配置和 manifest，下载全球数据文件，限制并发请求并对每个文件检查字节数和 SHA-256，最后导入到 `data/runtime/`。同一补丁的数据再次同步时会先完成新版本校验，再替换旧缓存。

### 手动导入数据包

1. 从数据源整理出一个新的版本目录。
2. 为每个文件计算 SHA-256。
3. 把文件路径和哈希写入 `manifest.json`。
4. 运行 `npm run data:import -- <版本目录>`。
5. 用 `npm test` 验证数据存储逻辑。

导入操作先复制到临时目录并重新校验。校验失败、文件缺失、哈希不一致或版本已存在时，不会修改当前激活版本。

## 后续接入服务器

服务器只负责提供同样格式的数据包和版本清单。客户端仍然先加载本地版本，再在后台检查远程版本；远程接口不可用时继续使用本地缓存。因此服务器是分发渠道，不是游戏内推荐功能的运行依赖。

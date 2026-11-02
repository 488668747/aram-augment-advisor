# aram-augment-advisor
海克斯大乱斗强化符文助手

当前项目处于本地数据基础阶段：客户端先从本地激活版本读取数据，暂不依赖服务器、用户上传或自动联网更新。

## 当前开发方式

```bash
npm install
npm test
npm start
```

当前内置的是用于验证链路的示例数据，不代表正式全球统计数据。

手动导入一个经过校验的数据版本：

```bash
npm run data:import -- /path/to/data-version
```

数据包必须包含 `manifest.json`，并在 `manifest.files` 中声明文件路径和 SHA-256。导入会先完成完整性校验，成功后才切换 `data/current.json`；失败时继续使用旧版本。

## 计划中的功能

- LCU 读取选人阶段的当前英雄；
- 本地全球统计查询；
- 当前英雄与海克斯的条件胜率；
- 已选海克斯与候选海克斯的组合推荐；
- 游戏内只读 OCR 浮窗；
- Windows 打包和手动数据更新。

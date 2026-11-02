# 本地数据基础层实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Windows 海克斯大乱斗助手建立可离线运行、可手动替换版本、后续可无痛接入服务器的本地数据基础层。

**Architecture:** 客户端始终从本地激活版本读取数据，远程更新只作为未来的数据分发渠道。每个数据版本包含补丁号、来源、获取时间、文件哈希和英雄/海克斯/装备统计；更新先写入临时目录并完成校验，再原子切换 `current.json` 指针。

**Tech Stack:** Electron、Node.js、JavaScript（先使用 Node 内置模块，避免第一阶段引入不必要依赖）、Node test runner。

---

### Task 1: 建立项目骨架和本地数据契约

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `src/shared/data-model.js`
- Create: `src/main/data-store.js`
- Test: `tests/data-store.test.js`

**Steps:**

1. 写一个测试，验证本地数据目录可以读取激活版本，并拒绝缺少补丁号或统计字段的数据。
2. 运行 `npm test`，确认测试先失败。
3. 实现最小的数据模型校验和本地激活版本读取逻辑。
4. 运行 `npm test`，确认测试通过。
5. 提交：`feat: 建立本地数据基础层`

### Task 2: 增加可替换的数据版本和手动导入能力

**Files:**
- Modify: `src/main/data-store.js`
- Create: `scripts/import-data.mjs`
- Create: `data/versions/16.21.5/manifest.json`
- Create: `data/versions/16.21.5/sample-data.json`
- Modify: `.gitignore`
- Test: `tests/data-store.test.js`

**Steps:**

1. 增加测试，验证导入新版本时会先校验临时目录，失败时保留旧版本。
2. 运行针对性测试，确认先失败。
3. 实现版本目录、`current.json` 指针和原子切换。
4. 实现手动导入脚本，支持把准备好的数据目录导入本地缓存。
5. 运行测试和一次真实导入演练。
6. 提交：`feat: 增加本地数据版本导入`

### Task 3: 建立 Electron 最小启动入口

**Files:**
- Modify: `package.json`
- Create: `src/main/main.js`
- Create: `src/preload/preload.js`
- Create: `src/renderer/index.html`
- Create: `src/renderer/renderer.js`

**Steps:**

1. 增加启动测试所需的最小配置。
2. 实现 Electron 主进程、preload 白名单和本地数据状态展示。
3. 运行 `npm test` 和 `npm start` 的静态配置检查。
4. 提交：`feat: 创建 Electron 客户端骨架`

### Task 4: 文档化本地数据工作流

**Files:**
- Modify: `README.md`
- Create: `docs/local-data-workflow.md`

**Steps:**

1. 写明本地数据目录、手动导入方式、失败回滚行为和后续远程同步接口边界。
2. 运行完整测试和 Git diff 检查。
3. 提交：`docs: 补充本地数据使用说明`

### Task 5: 增加全球数据手动同步器

**Files:**
- Create: `src/shared/data-source.js`
- Create: `scripts/sync-global-data.mjs`
- Test: `tests/data-source.test.js`
- Modify: `src/main/data-store.js`
- Modify: `src/main/main.js`

**Steps:**

1. 测试远端 manifest 的来源、路径、语言和哈希校验。
2. 实现限并发、可重试的手动同步脚本。
3. 把同步结果保存到被忽略的 `data/runtime/`，并让客户端优先使用本地缓存。
4. 用当前全球数据源跑一次完整同步，确认 222 个文件能被本地激活。
5. 提交：`feat: 增加全球数据手动同步`

### Task 6: 接入离线英雄详情和推荐展示

**Files:**
- Create: `src/main/data-query.js`
- Create: `tests/data-query.test.js`
- Modify: `src/main/main.js`
- Modify: `src/preload/preload.cjs`
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/renderer.js`
- Modify: `data/versions/16.21.5/*`

**Steps:**

1. 测试英雄详情能够整理当前英雄胜率、海克斯胜率和核心装备。
2. 实现本地数据查询和 IPC 白名单接口。
3. 在 Electron 窗口增加英雄选择、胜率、海克斯列表和装备卡片。
4. 用内置示例数据、同步后的全球数据和 Electron 启动命令分别验证。
5. 提交：`feat: 增加离线英雄详情展示`


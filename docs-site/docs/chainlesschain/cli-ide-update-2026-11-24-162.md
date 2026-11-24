# CLI 0.166.162 与 IDE 升级

## 概述

CLI **0.166.162** 在会话续跑时恢复已批准计划的权限档位和工具范围。自动化可通过 JSON 回执识别启动时的持久化失败、Git 安装失败和后台任务停止结果。Open VSX **0.37.197** 与 JetBrains **0.4.212** 均推荐这一 CLI 版本。

CLI 已在 npm 公开。标签 `v-npm-0-166-162` 绑定提交 `03cb502b0e0e3facfbce79ef336fec7861a5554c`。已核验公开归档、签名来源和 10 个直接子包的精确版本。 [npm 发布与回读](https://github.com/longfa/chainlesschain/actions/runs/45306343051)

Open VSX **0.37.197** 已上架，公开 VSIX 与标签工作流制品的 SHA-256 一致。 [下载 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.197/file/chainlesschain.chainlesschain-ide-0.37.197.vsix) · [Open VSX 发布](https://github.com/longfa/chainlesschain/actions/runs/45309426901)

JetBrains **0.4.212** 已获 Marketplace 批准并公开上架。下载的 ZIP 内两项文件与标签工作流制品一致。 [下载 JetBrains 插件](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1227765) · [JetBrains 标签工作流](https://github.com/longfa/chainlesschain/actions/runs/45309426991)

## 使用示例

```sh
npm i -g chainlesschain@0.166.162 --registry https://registry.npmjs.org
cc --version
cc doctor
cc tasks --json
```

升级 CLI 和扩展后重启 IDE 宿主，再用 `cc doctor` 核对实际加载的 CLI 路径。

## 核心特性

- 在交互和后台会话中恢复批准过的计划。若续跑请求的权限档位与批准记录冲突，CLI 会拒绝启动。
- 使用 `cc tasks --json` 查看运行、等待和停止状态。计划任务的 `endsAt` 和 `nextRunAt` 分别标记截止时间和下一次可执行时间。
- `cc skill add --json` 和插件安装回执会记录安装命令结果。Git 获取失败时可结合退出码与回执定位问题。
- VS Code 分叉会话在独立标签页中运行，保留原对话并为新分支建立独立的副作用账本。

## 系统架构

计划批准记录保存在会话中。CLI 在启动新进程或后台任务时读取记录，并在调用模型前校验执行权限。CLI、Web 工作台和配套 IDE 按需刷新 LK 公开目录。

## 配置参考

在 IDE 的 **Configure LLM** 中刷新 LK 模型目录。离线目录包括 GPT‑6.2 Sol（`gpt-6.2-sol`）和 GPT‑6.2 Astra（`gpt-6.2-astra`）。Linux、Windows 和 macOS 的安装方式相同。

## 性能指标

`cc tasks --json` 提供任务截止时间和下一次可运行时间。实际耗时取决于模型连接、工具执行和任务队列。

## 测试覆盖

CLI CI 的 74 个必需作业和 Strict Sandbox 的 6 个作业均通过，覆盖 Linux、Windows 和 macOS。六目标原生验证也已通过。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45289860156) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45289859907) · [原生验证](https://github.com/longfa/chainlesschain/actions/runs/45289910251)

## 安全考虑

计划执行仅允许批准的工具及参数，恢复时校验显式权限档位。生产付费就绪、原生准入和自动晋级分别为 `NOT_PAID_READY`、`NOT_ADMITTED`、`HOLD`。

## 故障排查

对 `--output-format json` 或 `stream-json`，同时检查进程退出码和 `result` 记录。`error_persistence` 表示存储操作失败。检查配置目录是否可写、磁盘是否有空间，再重试。恢复被中断的任务前，先查看停止回执和副作用的核验状态。

## 关键文件

- `packages/cli/src/commands/agent.js` 处理 CLI Agent 启动与错误回执。
- `packages/vscode-extension/package.json` 和 `packages/jetbrains-plugin/gradle.properties` 记录各扩展推荐的 CLI 版本。

## 相关文档

[CLI 安装与配置](./cli-setup) · [IDE 指南](./ide-plugin) · [任务生命周期](./cli-agenda) · [输入与恢复](./agent-input-and-recovery)

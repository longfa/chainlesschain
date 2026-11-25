# CLI 0.166.163 与 IDE 升级

## 概述

CLI **0.166.163** 已通过 GitHub Actions OIDC 发布。Open VSX **0.37.198** 已上架并推荐这一 CLI 版本。JetBrains **0.4.213** 推荐同一 CLI，已通过三平台实机矩阵，正在完成商店发布。JetBrains Marketplace 当前公开 **0.4.212**，推荐 CLI **0.166.162**。 [npm 发布](https://github.com/longfa/chainlesschain/actions/runs/45535193598) · [下载 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.198/file/chainlesschain.chainlesschain-ide-0.37.198.vsix) · [JetBrains 发布流程](https://github.com/longfa/chainlesschain/actions/runs/45537935036)

## 核心特性

- 文件内容重新进入模型输入后，CLI 恢复按页读取。长会话压缩会保留文件读取位置，以便继续处理原任务。
- 停止当前轮次时，CLI 撤回该轮的待处理审批。继续对话时，按新轮次显示的请求重新确认操作。
- Chat Completions 流返回错误时，CLI 将当前轮次标记为失败，便于根据错误信息重试。

## 系统架构

读取保护以实际送达模型的文件页确认进度。上下文规划器在写入压缩摘要前核对输入预算。待审批请求与发起它的轮次关联。 [运行时设计与 Git 记录](https://design.chainlesschain.com/release-runtime-update-2026-11-25-163.html)

## 配置参考

IDE 的 **Configure LLM** 可按需刷新 LK 模型目录。离线目录包括 GPT‑6.2 Sol（`gpt-6.2-sol`）和 GPT‑6.2 Astra（`gpt-6.2-astra`）。 [LK 与 IDE 配置](./ide-plugin)

## 性能指标

本地压缩交接沿用当前模型的可选输入预算。大文件读取与会话恢复所需的轮次取决于文件大小、模型上下文和已保留的会话内容。

## 测试覆盖

不可变发行源码为 `b06b3bfe0f1bf91d40617f3a0c83d918795d4fe6`。CLI CI 通过 74 个必需作业，Strict Sandbox 通过 6 个作业，覆盖 Linux、Windows 和 macOS。六目标原生验证通过，npm 公开归档和签名来源均已核验。Open VSX 公开 VSIX 与标签构建内容一致。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45518825279) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45519080269) · [Open VSX 验证](https://github.com/longfa/chainlesschain/actions/runs/45537934622)

## 安全考虑

停止操作会结束当前轮的待审批请求，迟到的确认无法写入授权记录。发布证据边界为 `NOT_PAID_READY`、`NOT_ADMITTED` 和 `HOLD`。本轮公开的是 CLI 和已核验的 IDE 扩展，客户端安装包按独立发行记录查询。

## 故障排查

如果 IDE 加载了旧 CLI，重启宿主后运行 `cc doctor` 核对二进制路径。遇到 Chat Completions 流错误时，查看该轮的错误或结构化结果，检查服务连接后再提交输入。恢复已停止的任务前，先核对已经完成的工具操作和未处理的审批。

## 关键文件

- `packages/cli/src/lib/read-file-loop-guard.js` 根据实际送达的页跟踪读取进度。
- `packages/cli/src/lib/context-memory-kernel/live-compaction.js` 校验并提交上下文压缩结果。
- `packages/cli/src/runtime/headless-stream.js` 管理轮次生命周期与审批。

## 使用示例

```sh
npm i -g chainlesschain@0.166.163 --registry https://registry.npmjs.org
cc --version
cc doctor
```

安装或升级扩展后重启 IDE，确认宿主加载的 CLI 版本和路径。

## 相关文档

[CLI 配置](./cli-setup) · [IDE 安装](./ide-plugin) · [Agent 输入与恢复](./agent-input-and-recovery) · [发行记录](./agent-platform-release)

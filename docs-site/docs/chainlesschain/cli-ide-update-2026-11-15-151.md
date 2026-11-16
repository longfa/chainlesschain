---
title: CLI 0.166.151 自进化存储审计发布说明
description: 本地存储审计、只读日志一致性、版本配对与发布门禁
---

# CLI 0.166.151 自进化存储审计发布说明

## 概述

CLI **0.166.151** 未公开，已因正式 Ubuntu 单测中的 POSIX 错误层级断言不匹配停止发布；原不可变标签保留，原发布工作流已取消。生产读取已拒绝宽权限文件，但测试误将内部原因当成外层错误匹配。修复候选改为 [CLI 0.166.152](./cli-ide-update-2026-11-15-152)，必须重新完成准确提交的完整三系统门禁、OIDC 发布和公开回读。当前已核验公开 CLI 为 **0.166.150**。

本批改动都在 CLI 内。13 个现有子包保持原版本，正式工作流会在 CLI 发布前再次核对子包公开归档。现有公开 Open VSX **0.37.189** 与 JetBrains **0.4.204** 仍推荐 CLI **0.166.150**；本批不发布 IDE 插件或 PC/mobile 安装包，公开客户端仍为 **v5.0.3.145**。

## 核心特性

- 有界本地 retained-segment 文件读取，及原目录能力和已认证 manifest 引用向真实历史报告的传递。
- 本地 retention 全目录审计，区分 manifest 已引用文件与未发布残留；默认 ArtifactStore 全索引与实际文件严格对应，并重验签名、当前权限和文件身份。
- 不执行恢复的 source WAL/v2 全事件镜像检查。source→v2→source 必须保持 frontier 稳定且完整事件内容一致；缺失 witness/HEAD、崩溃残留或 WAL 领先镜像时保留文件并拒绝审计。

审计不自动清理、补写或修复权限，普通读写与显式恢复流程保留各自原行为。只读 source 上限为 10000 事件，超限拒绝而不返回截断结果；各目录审计保留自己的读取预算。

## 测试覆盖

本地 Windows / Node.js 22.20.0 相关回归共 26 文件，**653 项通过、11 项平台条件跳过、零失败**。这不是准确发行提交的三系统 CI 结果，也没有新增真实模型任务成绩。

本轮仅认证各原本地组件及 source/v2 镜像关系，尚未组合完整生产运行图，不构成跨组件原子快照、统一 authority epoch、独立安装认可或受保护高水位。`fullPhysicalStorageGraphVerified=false`、生产自动晋升 **HOLD** 保持；真实 producer、alias/lease 和 A/B/C 验收仍未完成。

详细实现与本地验证见 [RRSI 进度第 41–46 节](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/agents/rrsi-implementation-progress-2026-10-07.md)。

## 使用示例

候选版通过全部正式门禁并公开核验之前，安装已核验版本：

```bash
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启 CLI 和 IDE 宿主。不要将保留的 .151 标签视为公开包；后续发布进度见 .152 说明。

## 系统架构

CLI 依赖原版本子包；GitHub Actions 在准确提交的三系统门禁通过后通过 OIDC 发布，再执行独立公开包回读。IDE 与原生客户端按下游阶段分别验证。

## 配置参考

候选版不要求迁移已有用户配置。LK 主地址为 `https://api.lk888.ai`，备用为 `https://api.lk666.ai`；文档与定价入口使用 `https://chainlesschain.net`。

## 性能指标

未新增性能基准成绩。存储审计保留原有文件、事件和字节预算，超限时拒绝，不通过截断伪造完整报告。

## 安全考虑

保留原文件、权限、签名和恢复边界；缺失或不同步状态不自动修复。使用 Actions OIDC，发行前验证子包归档，发行后验证公开字节与来源，自动晋升保持 HOLD。

## 故障排查

若 npm 查不到候选版本，继续安装已核验的 0.166.150。若 CI 失败、来源不匹配或回读不可用，保留失败证据并修复后重跑，不能视为发行完成。

## 关键文件

CLI 版本见 `packages/cli/package.json`，发行门禁见 `packages/cli/scripts/verify-release-gates.mjs`，公开来源校验见 `packages/cli/scripts/verify-npm-release-provenance.mjs`。

## 相关文档

[CLI 使用指南](./cli) · [发布源迁移进度](./cli-ide-update-2026-11-16-153) · [LK 接入](https://chainlesschain.net/apidoc)。

---
title: CLI 0.166.151 自进化存储审计发布说明
description: 本地存储审计、只读日志一致性、版本配对与发布门禁
---

# CLI 0.166.151 自进化存储审计发布说明

## 概述

本文保留当时的候选状态；本候选未发布，当前公开修复版见 [CLI 0.166.156](./cli-ide-update-2026-11-18-156)。下文 .150 安装命令是历史配对。

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

本地 retained-segment、manifest、ArtifactStore 与 source/v2 WAL 分别校验各自的文件和引用；组合生产运行图尚未认证。

## 配置参考

本轮没有新增用户配置开关。原目录权限、签名和读取预算按既有存储合同执行；审计不会调整权限或触发恢复。

## 性能指标

只读 source 检查上限为 10000 事件，超限拒绝。本说明没有吞吐、延迟或真实模型任务性能基准。

## 安全考虑

保留权限拒绝、签名和文件身份检查。缺失 witness/HEAD 或 WAL 不一致时保留现场；自动晋升仍为 HOLD。

## 故障排查

遇到 witness bounded read failed 时检查外层错误码和 cause 中的真实权限原因。不要通过 chmod、删除 witness 或补写 WAL 绕过审计。

## 关键文件

`packages/cli/src/lib/evolution/evolution-file-retained-segment-backend.js`、`evolution-file-witness.js` 及 `packages/cli/src/lib/artifact-store.js` 承载相关存储检查。

## 相关文档

[当前公开 LK 修复与安装说明](./cli-ide-update-2026-11-18-156)；[.151 历史范围](./cli-ide-update-2026-11-15-151)；[.152 历史修复](./cli-ide-update-2026-11-15-152)。

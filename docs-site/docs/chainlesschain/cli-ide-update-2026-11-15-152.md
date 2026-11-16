---
title: CLI 0.166.152 自进化存储审计修复候选
description: POSIX 拒绝证据断言修复、存储审计范围与重新发布门禁
---

# CLI 0.166.152 自进化存储审计修复候选

## 概述

CLI **0.166.152** 为修复候选，尚未公开。当前已核验公开版本仍是 **0.166.150**。候选 .151 的不可变标签保留，其发布工作流已取消，不移动旧标签或复用旧提交的成功检查。

.151 的 Strict Sandbox 已通过，但准确源码的 Ubuntu unit shard 3/4 在一个新增 POSIX 测试中失败：读取器按原合同返回 `CC_EVOLUTION_WITNESS_STATE_READ_FAILED` 和外层 `witness bounded read failed`，真实权限拒绝保存在 `cause`；测试误将 cause 的文本匹配到外层错误。该分片共有 10735 项通过、1 项失败、30 项跳过，其余矩阵当时仍未全部完成，不能视为可发行。

## 核心特性

.152 同时断言外层错误码/文本及真实权限原因，并检查文件仍为 0640、没有调用 chmod 或 signer。生产权限检查、读取预算和恢复行为保持；本机 Windows 条件跳过不能替代 POSIX 实测，新提交仍须完整三系统 CI。

本候选包含 .151 的有界本地 retained-segment 后端、原目录/manifest/产物引用清单、本地 retention 全目录和 ArtifactStore 全索引/文件对应审计，以及不执行恢复的 source WAL/v2 全事件镜像检查。审计遇到缺失 witness/HEAD、崩溃残留或不同步 WAL 时保留现场并拒绝；普通读写和显式恢复仍按原合同执行。[完整功能范围](./cli-ide-update-2026-11-15-151)。

## 安全考虑

必须先完成新准确提交的 Linux、Windows、macOS 全部 CLI CI 和 CLI Strict Sandbox，再通过不可变新标签与现有 GitHub Actions OIDC 工作流发布，核对公开归档字节、签名来源及仅 registry 的子包依赖。13 个子包不改版本；Open VSX **0.37.189** 和 JetBrains **0.4.204** 保持已公开的 CLI **0.166.150** 推荐，本批不发布 IDE 或原生客户端。PC/mobile 公开版本仍为 **v5.0.3.145**。

完整生产运行图、独立安装/受保护高水位、真实 producer、alias/lease 和 A/B/C 验收仍未完成，`fullPhysicalStorageGraphVerified=false`，自动晋升仍为 **HOLD**。修复测试不新增模型任务成绩。

## 使用示例

```bash
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启 CLI 和 IDE 宿主。新候选正式公开核验后再更新安装命令。

## 系统架构

CLI 依赖原版本子包；GitHub Actions 在准确提交的三系统门禁通过后通过 OIDC 发布，再执行独立公开包回读。IDE 与原生客户端按下游阶段分别验证。

## 配置参考

候选版不要求迁移已有用户配置。LK 主地址为 `https://api.lk888.ai`，备用为 `https://api.lk666.ai`；文档与定价入口使用 `https://chainlesschain.net`。

## 性能指标

未新增性能基准成绩。存储审计保留原有文件、事件和字节预算，超限时拒绝，不通过截断伪造完整报告。

## 测试覆盖

本机测试只作为补充；必须核对新准确提交的完整 Linux、Windows、macOS CLI CI 与 Strict Sandbox。平台条件跳过不能替代对应系统实测。

## 故障排查

若 npm 查不到候选版本，继续安装已核验的 0.166.150。若 CI 失败、来源不匹配或回读不可用，保留失败证据并修复后重跑，不能视为发行完成。

## 关键文件

CLI 版本见 `packages/cli/package.json`，发行门禁见 `packages/cli/scripts/verify-release-gates.mjs`，公开来源校验见 `packages/cli/scripts/verify-npm-release-provenance.mjs`。

## 相关文档

[CLI 使用指南](./cli) · [发布源迁移进度](./cli-ide-update-2026-11-16-153) · [LK 接入](https://chainlesschain.net/apidoc)。

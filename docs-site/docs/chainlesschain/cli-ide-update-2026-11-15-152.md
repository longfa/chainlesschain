---
title: CLI 0.166.152 自进化存储审计修复候选
description: POSIX 拒绝证据断言修复、存储审计范围与重新发布门禁
---

# CLI 0.166.152 自进化存储审计修复候选

## 当前状态

CLI **0.166.152** 为修复候选，尚未公开。当前已核验公开版本仍是 **0.166.150**。候选 .151 的不可变标签保留，其发布工作流已取消，不移动旧标签或复用旧提交的成功检查。

.151 的 Strict Sandbox 已通过，但准确源码的 Ubuntu unit shard 3/4 在一个新增 POSIX 测试中失败：读取器按原合同返回 `CC_EVOLUTION_WITNESS_STATE_READ_FAILED` 和外层 `witness bounded read failed`，真实权限拒绝保存在 `cause`；测试误将 cause 的文本匹配到外层错误。该分片共有 10735 项通过、1 项失败、30 项跳过，其余矩阵当时仍未全部完成，不能视为可发行。

## 修复与功能范围

.152 同时断言外层错误码/文本及真实权限原因，并检查文件仍为 0640、没有调用 chmod 或 signer。生产权限检查、读取预算和恢复行为保持；本机 Windows 条件跳过不能替代 POSIX 实测，新提交仍须完整三系统 CI。

本候选包含 .151 的有界本地 retained-segment 后端、原目录/manifest/产物引用清单、本地 retention 全目录和 ArtifactStore 全索引/文件对应审计，以及不执行恢复的 source WAL/v2 全事件镜像检查。审计遇到缺失 witness/HEAD、崩溃残留或不同步 WAL 时保留现场并拒绝；普通读写和显式恢复仍按原合同执行。[完整功能范围](./cli-ide-update-2026-11-15-151)。

## 发布和配对限制

必须先完成新准确提交的 Linux、Windows、macOS 全部 CLI CI 和 CLI Strict Sandbox，再通过不可变新标签与现有 GitHub Actions OIDC 工作流发布，核对公开归档字节、签名来源及仅 registry 的子包依赖。13 个子包不改版本；Open VSX **0.37.189** 和 JetBrains **0.4.204** 保持已公开的 CLI **0.166.150** 推荐，本批不发布 IDE 或原生客户端。PC/mobile 公开版本仍为 **v5.0.3.145**。

完整生产运行图、独立安装/受保护高水位、真实 producer、alias/lease 和 A/B/C 验收仍未完成，`fullPhysicalStorageGraphVerified=false`，自动晋升仍为 **HOLD**。修复测试不新增模型任务成绩。

## 当前公开版安装

```bash
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

升级后重启 CLI 和 IDE 宿主。新候选正式公开核验后再更新安装命令。

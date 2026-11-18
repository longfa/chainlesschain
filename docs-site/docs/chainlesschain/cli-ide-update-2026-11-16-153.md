---
title: CLI 0.166.153 发布源迁移候选
description: longfa 仓库、OIDC 来源固定、LK 平台域名更新与发行门禁
---

# CLI 0.166.153 发布源迁移候选

> Historical preparation from 2026-11-16, superseded by later releases. See the [current CLI 0.166.156 release](./cli-ide-update-2026-11-19-156) for current versions and installation.

## 概述

CLI **0.166.153** 尚未发布。当前已核验公开 CLI 为 **0.166.150**；新候选将从 [longfa/chainlesschain](https://github.com/longfa/chainlesschain) 发布。原 .151/.152 标签保持原有身份。

本批沿用[有界存储审计](./cli-ide-update-2026-11-15-151)与 [POSIX 测试修复](./cli-ide-update-2026-11-15-152)。新增变更是发布源迁移和 LK 文档、定价、模型目录租户域名统一为 **chainlesschain.net**。CLI、Web、VS Code 与 JetBrains 的源配置和生成目录已同步；实际推理 API 主备地址及协议路径保持。

## 系统架构

1. 新准确提交的 Linux、Windows、macOS 全部 CLI CI 和 CLI Strict Sandbox 通过。
2. 具有 npm 包维护权限的账号在包设置中新增 Trusted Publisher，指向 `longfa/chainlesschain` 的 `npm-publish.yml`。继续使用 GitHub Actions OIDC，不改用本地发布或 npm 写入 Token。
3. 新不可变版本标签触发现有发行工作流，先核对原版本子包的公开归档及 registry-only 安装，再发布 CLI。
4. 校验公开 CLI 包与正式制品逐字节一致、npm 签名来源固定为新仓库及准确提交，并完成独立回读。

新 CLI 的来源固定为发布工作流明确提供的预期仓库，不能从待验证的证明中自动接受发行者。未改版本的历史子包仍验证其原始来源。独立回读从不可变标签中的包元数据确定预期源仓库；旧仓库不可访问时，旧发行制品回读会明确失败，不当作新发行成功证据。

## 使用示例

本批仅发布 CLI。子包版本保持；已公开 Open VSX **0.37.189** 与 JetBrains **0.4.204** 仍推荐 **0.166.150**，本批源链接更新不表示 IDE 新版本已上架。PC/mobile 公开客户端仍为 **v5.0.3.145**。完整生产存储图、独立安装与受保护 pins、真实 A/B/C 验收尚未完成，自动晋升保持 **HOLD**。

源码另准备 VS Code **0.37.190** 与 JetBrains **0.4.205** 候选，推荐 CLI **0.166.153**，以区分已修改链接的插件源码与既有上架版本。必须先公开核验 CLI，再分别完成 IDE 的准确提交门禁和商店回读；本步骤不创建 IDE 发布标签。

```sh
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

新候选公开核验后，再同步更新 CLI README、根中英文 README 和公开文档中的当前版本、安装命令与发行限制。

## 核心特性

保留有界存储审计和 POSIX 拒绝证据测试修复；.153 增加发布来源固定及 LK 平台域名更新。

## 配置参考

候选版不要求迁移已有用户配置。LK 主地址为 `https://api.lk888.ai`，备用为 `https://api.lk666.ai`；文档与定价入口使用 `https://chainlesschain.net`。

## 性能指标

未新增性能基准成绩。存储审计保留原有文件、事件和字节预算，超限时拒绝，不通过截断伪造完整报告。

## 测试覆盖

本机测试只作为补充；必须核对新准确提交的完整 Linux、Windows、macOS CLI CI 与 Strict Sandbox。平台条件跳过不能替代对应系统实测。

## 安全考虑

保留原文件、权限、签名和恢复边界；缺失或不同步状态不自动修复。使用 Actions OIDC，发行前验证子包归档，发行后验证公开字节与来源，自动晋升保持 HOLD。

## 故障排查

若 npm 查不到候选版本，继续安装已核验的 0.166.150。若 CI 失败、来源不匹配或回读不可用，保留失败证据并修复后重跑，不能视为发行完成。

## 关键文件

CLI 版本见 `packages/cli/package.json`，发行门禁见 `packages/cli/scripts/verify-release-gates.mjs`，公开来源校验见 `packages/cli/scripts/verify-npm-release-provenance.mjs`。

## 相关文档

[CLI 使用指南](./cli) · [发布源迁移进度](./cli-ide-update-2026-11-16-153) · [LK 接入](https://chainlesschain.net/apidoc)。

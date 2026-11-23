---
title: CLI 0.166.162 历史发布准备
description: longfa 仓库、chainlesschain.net 域名与 OIDC 来源固定
---

# CLI 0.166.162 历史发布准备

> 本文归档 2026-11-16 的候选准备记录。当前各渠道版本和安装方式见[升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-23-161.html)。

## 当时的状态

当时准备中的 CLI **0.166.162** 尚未发布，已核验的 npm 公开版本为 **0.166.150**。候选从 longfa/chainlesschain 的 0.166.153 源码继续，统一 LK 文档与定价入口到 **https://chainlesschain.net**。

## 发行门禁

1. 新准确提交必须通过 Linux、Windows、macOS 的完整 CLI CI 与 CLI Strict Sandbox。
2. 发行必须通过 `v-npm-0-166-162` 不可变标签触发 GitHub Actions OIDC Trusted Publishing。
3. 发布后必须完成 npm 公共归档、签名 provenance、子包依赖和字节一致性回读。

不得使用本地 npm 发布、npm 写入 Token、旧提交检查或部分矩阵替代这些门禁。

## 当时的安装方式

在公开回读完成前继续使用：

```sh
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

## 变更范围

本候选保留既有 CLI 行为和子包版本；LK 文档、定价和生成的 CLI/Web/IDE 目录入口使用 `https://chainlesschain.net`，LK API 主备地址保持不变。IDE 与 PC/mobile 不在本次 CLI 标签中重新发布。

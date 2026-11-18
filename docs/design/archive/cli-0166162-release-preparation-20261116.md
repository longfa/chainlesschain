---
title: CLI 0.166.162 发布候选
description: longfa 仓库、chainlesschain.net 域名与 OIDC 来源固定
---

# CLI 0.166.162 发布候选

> Historical preparation from 2026-11-16, superseded by later releases. See the [current CLI 0.166.156 release](https://github.com/longfa/chainlesschain/blob/main/docs-site/docs/chainlesschain/cli-ide-update-2026-11-19-156.md) for current versions and installation.

## 当前状态

CLI **0.166.162** 尚未发布。当前 npm 公共版本仍为 **0.166.150**；本候选从 longfa/chainlesschain 的准确提交继续 0.166.153 源码，并统一 LK 文档与定价入口为 **https://chainlesschain.net**。

## 发行门禁

1. 新准确提交必须通过 Linux、Windows、macOS 的完整 CLI CI 与 CLI Strict Sandbox。
2. 发行必须通过 `v-npm-0-166-162` 不可变标签触发 GitHub Actions OIDC Trusted Publishing。
3. 发布后必须完成 npm 公共归档、签名 provenance、子包依赖和字节一致性回读。

不得使用本地 npm 发布、npm 写入 Token、旧提交检查或部分矩阵替代这些门禁。

## 使用

在公开回读完成前继续使用：

```sh
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

## 变更范围

本候选保留既有 CLI 行为和子包版本；LK 文档、定价和生成的 CLI/Web/IDE 目录入口使用 `https://chainlesschain.net`，LK API 主备地址保持不变。IDE 与 PC/mobile 不在本次 CLI 标签中重新发布。

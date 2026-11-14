# CLI 0.166.150 与 IDE LK 渠道接入

## 概述

本次候选配套版本为 CLI **0.166.150**、VS Code/Open VSX **0.37.189**、JetBrains **0.4.204**。发布状态以官方 Actions 和公开下载核验为准；本页准备时尚未宣称这些版本已公开。

## 核心特性

CLI、桌面设置与两款 IDE 配置面板增加 LK 渠道的协议、主备地址和模型选择。平台模型目录覆盖 197 个模型，保留已有自定义模型别名。

## 系统架构

CLI 维护共享渠道定义和公开模型目录；生成器将同一目录同步到 VS Code 与 JetBrains。实际对话请求沿用 OpenAI、Anthropic 或 Gemini 原生适配器，按模型协议选择地址。

## 配置参考

运行 `cc setup` 并选择 LK API，或在 IDE「配置大模型」的服务类型中选择 **LK API 聚合平台**。选择协议、主备地址和模型，再输入渠道 API Key 并保存。主地址为 `https://api.lk888.ai`，备用为 `https://api.lk666.ai`，域名使用字母 `lk`。更换地址需要填写对应渠道密钥。

共享目录包含 83 个对话、25 个图片、81 个视频和 8 个音频模型。对话选择器按平台声明的协议筛选；媒体目录和接口文档不等同于已实现媒体任务提交或轮询。

| 示例模型        | 协议                    | CLI / IDE Base URL            |
| --------------- | ----------------------- | ----------------------------- |
| `tt-6-luna`     | OpenAI Chat Completions | `https://api.lk888.ai/v1`     |
| `fb-5-2`        | Anthropic Messages      | `https://api.lk888.ai/v1`     |
| `gem-3.8-flash` | Gemini                  | `https://api.lk888.ai/v1beta` |

已有模型别名在加载配置时保留。平台目录不代表当前 Key 拥有所有模型权限；以 Skills 接口的 `available_for_this_key` 和实际请求结果为准。
价格按渠道分组、启用状态、白名单和时段折扣变化，不将账户价格写入公共目录。

[平台开发文档](https://quexuan.net/apidoc) · [平台定价](https://quexuan.net/api/pricing)

## 性能指标

本轮没有进行吞吐量、并发或延迟基准测试；三次最小请求仅验证连接与文本返回，不构成性能承诺。

## 测试覆盖

三个示例模型均完成主地址最小请求并返回文本，其账户定价查询均返回 HTTP 200。这些请求没有验证全部模型或媒体任务。

本地渠道回归覆盖目录同步、83 个对话模型在两组地址上的协议映射、错误协议和媒体模型拒绝、已有别名及密钥切换。VS Code 配置回归、JetBrains 实际 Swing 面板检查和桌面 Vue 编译通过；完整跨平台发布门禁由 Actions 判定。

发布前要求同一提交的 Linux、Windows、macOS CLI CI 和 CLI Strict Sandbox 全部成功。通过 GitHub Actions OIDC 发布 CLI，核验公开 npm 包和上游依赖后，才发布 IDE 插件。子 npm 包版本不变；移动端和 PC 客户端不在本次发布范围内。

## 安全考虑

新渠道需要填写对应密钥，避免复用其他服务的凭据。账户定价、余额和密钥不进入公共目录；模型是否可用以当前账户权限和实际响应为准。自动跨地址重试不在本次范围内，访问不畅时手动切换备用地址。

## 故障排查

域名使用字母 `lk`，检查是否误填数字 `1k`。遇到模型或协议错误时，按目录重新选择；遇到权限或余额错误时核对平台账户。主地址访问不畅可切换备用，保存时重新填写渠道密钥。升级后重启 IDE，并运行 `cc doctor` 检查 CLI 配对。

## 关键文件

- `packages/cli/src/lib/llm-channel-presets.js`：共享协议和地址配置。
- `packages/cli/src/lib/lk-model-catalog.json`：公开模型目录。
- `packages/cli/scripts/sync-lk-ide-presets.mjs`：IDE 目录同步与漂移检查。
- `packages/cli/test-node/lk-channel.node-test.mjs`：渠道回归。

## 使用示例

发布核验完成后安装：

```sh
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

IDE 升级后重启宿主；JetBrains Marketplace 审核状态与插件上传成功分开记录，Microsoft Marketplace 不由 Open VSX 标签发布自动覆盖。

## 相关文档

- [上一版 CLI 与 IDE 升级说明](./cli-ide-update-2026-11-13-149.md)
- [CLI 功能入口](./cli.md)
- [LK 渠道配置细节](https://github.com/chainlesschain/chainlesschain/blob/main/docs/configuration/lk-api-channel.md)

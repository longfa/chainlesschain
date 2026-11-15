---
title: CLI 0.166.150 与 IDE 插件升级说明
description: LK 聚合渠道、cc ui Web 配置、模型目录和版本配对
---

# CLI 0.166.150 与 IDE 插件升级说明

## 概述

CLI **0.166.150** 与 Open VSX **0.37.189** 已公开核验。JetBrains **0.4.204** 已公开核验。两款插件推荐 CLI **0.166.150**；PC/mobile 公开安装包仍为 v5.0.3.145。

## 核心特性

CLI setup、`cc ui` Web、VS Code 和 JetBrains 的模型设置新增 **LK API 聚合平台**。支持 OpenAI、Anthropic、Gemini 三种对话协议，按协议筛选模型，保留已有自定义别名。

公开目录共 **197** 个模型，包括 **83** 个对话、25 个图片、81 个视频、8 个音频。媒体模型和接口在本次作为目录和文档参考，尚未增加媒体任务提交及轮询界面。目录不代表账户拥有全部模型权限。

## 系统架构

渠道和协议分别保存。OpenAI 使用 `custom`，Anthropic 使用 `anthropic`，Gemini 使用 `gemini`；CLI、Web 和 IDE 共用同一份目录与主备地址定义。切换主备地址由用户操作，不自动重发生成请求。

## 配置参考

主地址 `https://api.lk888.ai`，备用地址 `https://api.lk666.ai`，域名使用字母 `lk`。两个地址为同一服务。

| 对话协议                | CLI / Web / IDE 主 Base URL   | 示例模型        |
| ----------------------- | ----------------------------- | --------------- |
| OpenAI Chat Completions | `https://api.lk888.ai/v1`     | `tt-6-luna`     |
| Anthropic Messages      | `https://api.lk888.ai/v1`     | `fb-5-2`        |
| Gemini                  | `https://api.lk888.ai/v1beta` | `gem-3.8-flash` |

桌面 Anthropic 适配器自行追加 `/v1/messages`，因此桌面设置使用域名根地址。OpenAI 预设使用 Chat Completions；平台另有 Responses 接口，不表示此预设使用 Responses。

## 动态价格、实际消费与余额

运行 `cc llm account` 查询最新模型分组价格、账户余额、Key 已用/剩余额度和平台实际 API 账单。`--days 7 --scope user --limit 20 --offset 0 --json` 可按全部 Key 查询并分页。Web 和桌面可选择范围，两款 IDE 均有刷新入口。金额单位为算力；当前价格已含时段折扣，运行中可能仍为预扣，退款已计入净额。账单没有 Token 数，不强行对应本地单次请求；本地 Token 统计与平台实扣分别展示。

## 性能指标

本次没有吞吐量或延迟基准，不据此宣称性能提升。

## 测试覆盖

CLI 和 IDE 发布源码均为 `b2af25c65d34f1ee34cdddf308b5a8e57bb4f198`。早期候选的商店简介检查、网络调用登记、不完整旧配置的密钥保留及桌面 IPC 接口清单遗漏问题已修正，各组件只采用最终准确源码的完整正式检查。

- [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/43630195823)：76/76 通过（attempt 1）。

- [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/43630195774)：6/6 通过（attempt 1）。

本地 Web 单元测试 130 个文件、2490 项通过，生产构建通过；真实 Chrome 对本地模拟服务完成首次加载、LK 选择、Anthropic 备用地址、保存回读和密钥输入清空，无页面运行时错误。首次配置、凭证安全、账单、连接及认证路由 206 项测试；桌面接口清单、投影、隐私和授权 68 项针对性测试（注入 IPC 并模拟 Electron 模块）、共享目录与全部对话主备路径 8 项 Node 测试通过。

授权的三个真实最小请求及三个价格查询返回 HTTP 200；没有逐一执行全部模型或提交媒体任务。

## 安全考虑

Web 使用已认证的结构化消息提交配置，密钥不进入命令行参数。地址和密钥一起原子保存，回读仅返回是否存在密钥。各渠道保存独立凭证（含火山等）；切回时留空自动恢复，LK 主备和协议共用一份 Key，首次配置新服务才需要填写密钥。真实 Key 和账户价格不写入公共目录、源码或证据。

本次增加渠道配置，不改变已有部署权限和自动晋升 HOLD 状态。PC/mobile 客户端仍为公开 v5.0.3.145。

## 故障排查

保存后新建聊天或 Agent 会话使用新连接。主地址访问不畅时手动改为备用地址，自动恢复已保存 LK Key。协议及 Base URL 路径须匹配；401/403 或模型不可用时核对账户权限，余额和价格以平台账户查询为准。

## 关键文件

- `packages/cli/src/lib/llm-channel-presets.js`
- `packages/cli/src/lib/lk-model-catalog.json`
- `packages/web-panel/src/views/Providers.vue`
- `docs/configuration/lk-api-channel.md`

## 使用示例

```bash
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
cc setup
cc ui
```

CLI：`cc setup` → LK API → 协议、主备地址、模型和 Key。

Web：`cc ui` → LLM 配置 → LLM 参数设置 → 服务渠道选择 LK API 聚合平台。填写 Key 后保存；确认回读后可测试已保存连接。

IDE：打开「配置大模型 / Configure LLM」，选择 LK API 聚合平台，再选择协议、地址和模型。两款插件推荐 CLI 0.166.150。

## 相关文档

- [平台开发文档](https://quexuan.net/apidoc)
- [平台定价](https://quexuan.net/api/pricing)
- [完整接入说明](https://github.com/chainlesschain/chainlesschain/blob/main/docs/configuration/lk-api-channel.md)
- [发布证据](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release150-public/publication.json)

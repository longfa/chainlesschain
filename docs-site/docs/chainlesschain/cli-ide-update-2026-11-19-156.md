# CLI .156 / IDE 与 LK 更新指南（2026-11-19）

## 概述

本轮同步官方网站、用户文档、设计文档与 README。公开版本为 CLI **0.166.156**、Open VSX **0.37.192**、JetBrains **0.4.207**，两款 IDE 均推荐 CLI .156。CLI 与 Open VSX 公开归档逐字节匹配，JetBrains 已批准、列出且两个原始 JAR 与正式构建一致。

## 核心特性

LK 主地址改为 `https://api.vv666.ai`，手动备用 `https://api.lk666.ai`。OpenAI 兼容默认模型为 `gpt-6.1-sol`。共享目录包含 202 项，其中 86 项对话模型，按协议筛选下拉；余额、动态分组价格与真实 API 账单可通过已保存的 LK 连接查询。

## 系统架构

CLI 负责连接规范化、旧模型别名迁移与账户适配，Web 和 IDE 使用同一模型目录。文档来源源码为 `8c937cbe9bc4b82f87479c124375401fa2fb3a72`，已发行包的不可变来源为 `a8cae89288d3a6119b152e04b750e10d726a5c5f`；网页部署的提交身份另由 `/deployment-source.json` 记录。设计权威源位于 `docs/design/`，两个文档站由同步脚本生成副本。

## 配置参考

| 协议                    | 模型示例          | CLI / IDE Base URL                           |
| ----------------------- | ----------------- | -------------------------------------------- |
| OpenAI Chat Completions | `gpt-6.1-sol`     | `https://api.vv666.ai/v1`，provider `custom` |
| Anthropic Messages      | `claude-opus-5-5` | `https://api.vv666.ai/v1`                    |
| Gemini                  | `gemini-4-carbon` | `https://api.vv666.ai/v1beta`                |

保存旧连接会按同系列迁移 `tt-6.1-sol → gpt-6.1-sol`、`tt-6-luna → gpt-6-luna`、`fb-5-2 → claude-fable-5-2`、`gem-3.8-flash → gemini-3.8-flash`。未知自定义别名不替换。主备域名手动选择，不自动重发生成请求。

## 性能指标

本次目录为 **86 对话 + 26 图片 + 82 视频 + 8 音频 = 202 项**。这些是目录快照数量，不表示所有模型均已实测或对任意 Key 可用。动态价格与扣费以远端算力账单为准；没有新增模型任务性能或质量成绩。

## 测试覆盖

准确发行源码的 CLI CI **75/75**、Strict Sandbox **6/6** 和 Actions OIDC 发布通过；独立 npm 回读验证了签名来源和归档字节。两款 IDE 完整门禁及公开下载核验通过。JetBrains 首轮两个 macOS 延迟测试失败被完整保留，同一提交、原阈值下仅重试一次后通过，未合并样本或调整阈值。

## 安全考虑

Key 不写入命令行参数、共享模型清单或文档；各服务端点的凭证分开保存，恢复连接时不向其他服务复用旧 Key。配置、发布门禁、模型任务验收各有范围：**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留，自动晋升和生产权限不因发布成功而启用。

## 故障排查

出现 `model_not_found` 时先确认 `cc --version` 为 .156，OpenAI 兼容模型使用 `gpt-6.1-sol`，重新保存 LK 连接并测试。账户查询失败时检查保存的是 LK 连接和对应 Key；价格、用量、账单按远端响应展示，API 账单没有 Token 数。`cc llm test` 会发起真实模型请求，按账户规则计费。

最后已核验的历史 PC/mobile 客户端为 **v5.0.3.145**。2026-11-19 核验其原 GitHub Release 与 Windows/Android 下载入口均返回 404，官网不再将其显示为当前可下载。本次不发行新客户端，可先使用公开 CLI、Web 面板及 IDE。

## 关键文件

`packages/cli/src/lib/lk-model-catalog.json`、`llm-channel-presets.js`、`llm-connection-config.js`、`lk-account-api.cjs`；`docs-website-v2/src/data/release-status.json` 固定网站发行快照，`scripts/deploy-docs-snapshot.ps1` 部署同一已提交源码的三个站点。Git 提交标题“1.5.6”不等于包版本；当前真实 CLI 版本为 **0.166.156**。

## 使用示例

```bash
npm i -g chainlesschain@0.166.156 --registry https://registry.npmjs.org
cc --version
cc doctor
cc setup --skip-download --skip-services
cc llm account --days 7 --scope user --limit 20 --offset 0 --json
cc ui
```

升级后重启 CLI / IDE 宿主；在 Configure LLM 恢复或保存 LK 连接。VS Code 可直接安装 [Open VSX .192 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.192/file/chainlesschain.chainlesschain-ide-0.37.192.vsix)；JetBrains 可安装 [已批准的 .207 ZIP](https://plugins.jetbrains.com/files/32208/1223726/chainlesschain-ide-bridge-0.4.207.zip)。Microsoft VS Code Marketplace 不在本次标签发布范围。

## 相关文档

[LK 配置与账单](./cli-llm) · [IDE 使用](./ide-plugin) · [设计与来源边界](https://design.chainlesschain.com/release-runtime-update-2026-11-19-156.html) · [公开发行证据](https://github.com/longfa/chainlesschain/blob/b4ce98696/docs/research/cli/evidence/release156-public/publication.json) · [官方模型接口说明](https://chainlesschain.net/apidoc#model/gpt-6.1-sol)。

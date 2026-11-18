# LK 模型与账单修复：CLI 0.166.156

## 概述

CLI **0.166.156** 已发布并从公共 npm 包确认。准确源码 `a8cae89288d3a6119b152e04b750e10d726a5c5f` 的 CLI CI 75/75、Strict Sandbox 6/6、Actions OIDC 发布及公开回读均成功。配套 VS Code **0.37.192** 已发布到 Open VSX，完整工作流成功且版本接口可访问；JetBrains **0.4.207** 也已通过完整宿主与兼容性门禁、上传并审核公开；下载 ZIP 的两个 JAR 与正式候选逐字节一致，插件版本和推荐 CLI .156 已核对。

## 核心特性

LK 主地址为 `https://api.vv666.ai`，备用为 `https://api.lk666.ai`。OpenAI 兼容连接使用 `/v1` 和模型 `gpt-6.1-sol`。目录来自文档使用的 `/v1/skills/models`，本次包含 202 项，其中 86 项对话模型；下拉按协议筛选，媒体模型不会进入聊天请求。

旧模型名称按同系列迁移：`tt-6.1-sol` → `gpt-6.1-sol`，`tt-6-luna` → `gpt-6-luna`，`fb-5-2` → `claude-fable-5-2`，`gem-3.8-flash` → `gemini-3.8-flash`。不替换未知自定义别名，不把其他平台 Key 用于 LK。

## 系统架构

CLI 统一解析 LK 连接、迁移旧模型名并查询账户；IDE 目录由共享模型清单生成。账户查询复用已保存的 LK 连接和 Key，模型下拉按连接协议筛选。

## 配置参考

OpenAI 兼容连接填写 `https://api.vv666.ai/v1`、模型 `gpt-6.1-sol` 和当前账户的 LK Key；备用域名为 `https://api.lk666.ai`。Anthropic 与 Gemini 连接需要选择各自协议。

## 性能指标

本次目录快照为 202 项，其中对话 86、图片 26、视频 82、音频 8。目录数量不等于账户权限或生成性能；本轮没有吞吐或延迟基准。

## 测试覆盖

已授权的最小 `gpt-6.1-sol` 生成请求返回 HTTP 200。账户适配器的余额、用量、价格与账单四项只读查询均成功；这不代表全部模型均已实测或对所有 Key 可用。账单单位为算力，不与本地 Token 估算混用。

## 安全考虑

Key 不写入仓库、发布说明或共享模型清单。目录仅保留模型身份和兼容协议，不保存账户额度、权限或账单内容。子包复用仍校验原签名来源和完整源码提交。

发布安装在 workflow 全局使用 CPU ONNX 配置；新 CLI 包与来源证明绑定 `longfa/chainlesschain`。旧子包保留其原始签名锚点，从授权镜像按完整签名提交抓取并校验源码目录。

## 故障排查

出现 model_not_found 时检查 `cc --version` 是否为 .156、连接的模型是否为 `gpt-6.1-sol`，保存 LK 连接后重新测试。账户查询失败时确认保存的是 LK 连接及对应 Key；动态价格和账单以远端账户响应为准。

## 关键文件

`packages/cli/src/lib/lk-account-api.cjs`、`llm-connection-config.js`、`llm-connection-resolution.js`；目录生成脚本为 `packages/cli/scripts/sync-lk-model-catalog.mjs` 与 `sync-lk-ide-presets.mjs`。

## 使用示例

安装已验证的 CLI：`npm i -g chainlesschain@0.166.156 --registry https://registry.npmjs.org`。重启 IDE 宿主，运行 `cc --version`，保存 LK 连接后执行 `cc llm test` 和 `cc llm account`。此轮不发布新的 PC/mobile 安装包。

## 相关文档

[LK 官方模型文档](https://chainlesschain.net/apidoc#model/gpt-6.1-sol)；[公共 CLI .156](https://www.npmjs.com/package/chainlesschain/v/0.166.156)；[VS Code .192 发布任务](https://github.com/longfa/chainlesschain/actions/runs/44308435592)；[JetBrains .207 发布任务](https://github.com/longfa/chainlesschain/actions/runs/44308436365)。

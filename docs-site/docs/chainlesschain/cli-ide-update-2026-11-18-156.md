# LK 模型与账单修复：CLI 0.166.156

CLI **0.166.156** 已发布并从公共 npm 包确认。准确源码 `a8cae89288d3a6119b152e04b750e10d726a5c5f` 的 CLI CI 75/75、Strict Sandbox 6/6、Actions OIDC 发布及公开回读均成功。配套 VS Code 0.37.192、JetBrains 0.4.207 仍在独立发布门禁中，尚未确认公开。

LK 主地址为 `https://api.vv666.ai`，备用为 `https://api.lk666.ai`。OpenAI 兼容连接使用 `/v1` 和模型 `gpt-6.1-sol`。目录来自文档使用的 `/v1/skills/models`，本次包含 202 项，其中 86 项对话模型；下拉按协议筛选，媒体模型不会进入聊天请求。

旧模型名称按同系列迁移：`tt-6.1-sol` → `gpt-6.1-sol`，`tt-6-luna` → `gpt-6-luna`，`fb-5-2` → `claude-fable-5-2`，`gem-3.8-flash` → `gemini-3.8-flash`。不替换未知自定义别名，不把其他平台 Key 用于 LK。

已授权的最小 `gpt-6.1-sol` 生成请求返回 HTTP 200。账户适配器的余额、用量、价格与账单四项只读查询均成功；这不代表全部模型均已实测或对所有 Key 可用。账单单位为算力，不与本地 Token 估算混用。

安装已验证的 CLI：`npm i -g chainlesschain@0.166.156 --registry https://registry.npmjs.org`。重启 IDE 宿主，运行 `cc --version`，保存 LK 连接后执行 `cc llm test` 和 `cc llm account`。此轮不发布新的 PC/mobile 安装包。

发布安装在 workflow 全局使用 CPU ONNX 配置；新 CLI 包与来源证明绑定 `longfa/chainlesschain`。复用子包从其原始签名仓库读取不可变标签并校验源码目录，保留原签名锚点。旧候选 `.155` 已停止发布。

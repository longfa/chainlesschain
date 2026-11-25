# 交互式配置向导 (setup)

## LK 渠道与账户查询（2026-11-19）

CLI **0.166.163** 已在 npm 公开，配套 Open VSX **0.37.198** 已上架。升级后重启宿主，运行 `cc --version` 和 `cc doctor`。 [IDE 配对与商店状态](./cli-ide-update-2026-11-25-163)

通过 `cc setup --skip-download --skip-services`、`cc ui` 的 LLM 配置或 IDE「配置大模型 / Configure LLM」选择 LK，再选择协议、端点和模型。主地址为 `https://api.vv666.ai`，备用为 `https://api.lk666.ai`，主备手动切换；LK 三种对话协议可恢复已保存的 LK Key。OpenAI 兼容连接使用 `https://api.vv666.ai/v1` 和 `gpt-6.1-sol`，不要填写具体 `/chat/completions` 请求路径。

新版会读取 LK 公共目录。离线快照包含 **205 项**，其中 89 个对话模型包括 `gpt-6.2-sol` 和 `gpt-6.2-astra`。聊天下拉仅显示所选协议兼容的对话模型；目录条目不保证当前 Key 权限或真实生成质量，媒体任务提交与轮询不在聊天配置内。旧别名 `tt-6.1-sol`、`tt-6-luna`、`fb-5-2`、`gem-3.8-flash` 分别迁移为 `gpt-6.1-sol`、`gpt-6-luna`、`claude-fable-5-2`、`gemini-3.8-flash`，未知自定义名称保留。

各渠道（含火山）的 Key 独立保存。恢复已保存连接时可留空 Key；首次配置其他服务必须提供该服务自己的凭证，不能复用 LK Key。[协议、地址与迁移指南](./cli-ide-update-2026-11-21-159)列出完整配置。

`cc llm account` 查询动态分组价格、余额、Key 额度、用量与实际 API 账单；`cc llm account --days 7 --scope user --limit 20 --offset 0 --json` 读取全部 Key 的 API 用量并分页。Web 和 IDE 账户刷新复用已保存的 LK 连接。账单单位为平台算力，没有 Token 数；本地 Token 估算单独显示，退款计入净额，Key 限额 0 表示不限额。

CLI 随附更新的 Web 面板；桌面源码的连接和账户设置与 CLI 分开保存。最后已核验历史客户端为 **v5.0.3.145**，当前旧安装包源返回 404，本轮不发布新的 PC/mobile 安装包。

<!-- docs-code-git-sync-2026-10-28 -->

## 0.166.128：共享模型推荐目录

CLI setup、VS Code 和 JetBrains 使用同一模型入门目录 `llm-onboarding-catalog.json` 的推荐信息，并保留自定义 provider、base URL 和模型配置。目录限定为新连接推荐，`runtimeVerified: false` / `accountVerified: false` 明确表示未验证当前运行环境与账户，不是所有列出模型都已通过真实任务验收。

IDE 配置读取区分已配置、未配置与读取失败；读取失败时先检查路径和权限，不按缺省值覆盖旧配置。只读取配置状态不会发起推理；显式连接测试会调用模型，并继续受预算、超时、输出上限与已知用量结算约束。会话覆盖与恢复默认的用法见[IDE 插件指南](./ide-plugin)。

> 引导用户完成 ChainlessChain 的首次配置，包括环境检查、版本选择、LLM 配置、二进制下载和 Docker 服务启动。

## 概述

`setup` 命令提供一个 8 步交互式向导，引导用户完成 ChainlessChain 的首次配置。向导依次执行环境检查、配置目录初始化、版本选择、LLM 提供商配置、桌面应用下载和 Docker 服务启动，完成后将所有配置写入本地 `config.json`。

## 核心特性

- 🔹 **环境检查**: 自动检测 Node.js 版本、Docker、Docker Compose
- 🔹 **版本选择**: 支持个人版和企业版
- 🔹 **LLM 配置**: 选择 LLM 提供商、配置 API 密钥和模型
- 🔹 **二进制下载**: 自动下载桌面应用程序
- 🔹 **服务启动**: 可选启动 Docker 后端服务

## 系统架构

```
setup 命令 → setup.js (Commander) → 交互式向导 (8 步)
                                        │
         ┌──────────┬──────────┬────────┼────────┬──────────┬──────────┐
         ▼          ▼          ▼        ▼        ▼          ▼          ▼
    1.Node.js   2.Docker   3.配置目录  4.版本   5.LLM     6.下载     7.保存配置
      版本检查    检测       初始化     选择     提供商      二进制     config.json
                                                配置       (可跳过)      │
                                                                        ▼
                                                                   8.Docker
                                                                     服务启动
                                                                     (可跳过)
```

## 命令参考

```bash
chainlesschain setup                    # 启动交互式配置向导
chainlesschain setup --skip-download    # 跳过二进制下载
chainlesschain setup --skip-services    # 跳过 Docker 服务配置
```

## 选项说明

| 选项              | 说明                       |
| ----------------- | -------------------------- |
| `--skip-download` | 跳过桌面应用二进制下载步骤 |
| `--skip-services` | 跳过 Docker 服务启动步骤   |

## 向导步骤详解

### 步骤 1：Node.js 版本检查

检查当前 Node.js 版本是否满足最低要求。不满足时自动退出。

### 步骤 2：Docker 环境检查

检测 Docker 和 Docker Compose 是否可用。Docker 为可选依赖（仅后端服务需要）。

### 步骤 3：配置目录初始化

创建 `.chainlesschain/` 配置目录（位于 Electron userData 下）。

### 步骤 4：版本选择

选择使用版本：

- **个人版** (Personal) — 个人 AI 管理
- **企业版** (Enterprise) — 企业级功能

### 步骤 5：LLM 提供商配置

从内置提供商列表中选择，配置 API 密钥和模型：

- 需要 API 密钥的提供商会提示输入（密码输入模式）
- 选择 `custom` 提供商可自定义 API 地址和模型名
- 默认模型可确认使用或自定义修改

### 步骤 6：下载桌面应用

自动下载当前版本的预编译桌面应用。下载失败不会中断向导，可后续使用 `chainlesschain update` 手动下载。

### 步骤 7：保存配置

将所有配置写入 `config.json`，包含：版本、LLM 提供商、API 密钥、模型、完成时间等。

### 步骤 8：Docker 服务启动

可选启动 Docker 后端服务（需要 Docker 可用且有 `docker-compose.yml`）。

## 配置参考

```bash
# CLI 标志
--skip-download      # 跳过桌面应用二进制下载步骤
--skip-services      # 跳过 Docker 服务启动步骤

# 配置路径（平台自适应）
# Windows: %APPDATA%/chainlesschain-desktop-vue/.chainlesschain/config.json
# macOS:   ~/Library/Application Support/chainlesschain-desktop-vue/.chainlesschain/config.json
# Linux:   ~/.config/chainlesschain-desktop-vue/.chainlesschain/config.json

# 环境变量（优先级高于 config.json）
OLLAMA_HOST          # Ollama 服务地址
OPENAI_API_KEY       # OpenAI API 密钥
ANTHROPIC_API_KEY    # Anthropic API 密钥
```

## 性能指标

| 操作             | 目标     | 实际           | 状态 |
| ---------------- | -------- | -------------- | ---- |
| Node.js 版本检查 | < 100ms  | ~50ms          | ✅   |
| Docker 环境检测  | < 1s     | ~400ms         | ✅   |
| 配置目录初始化   | < 50ms   | ~20ms          | ✅   |
| config.json 保存 | < 30ms   | ~10ms          | ✅   |
| 完整向导流程     | < 2 分钟 | 取决于用户输入 | ✅   |

## 测试覆盖率

```
✅ setup.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/setup.js` — 命令实现
- `packages/cli/src/lib/config-manager.js` — 配置读写
- `packages/cli/src/lib/paths.js` — 配置目录管理
- `packages/cli/src/lib/downloader.js` — 二进制下载
- `packages/cli/src/lib/prompts.js` — 交互式提示封装
- `packages/cli/src/constants.js` — 版本、提供商、端口等常量

## 安全考虑

- API 密钥通过密码输入模式收集，输入时不显示明文
- 配置文件存储在用户本地目录，已加入 `.gitignore`
- API 密钥存储在本地 `config.json` 中，不会上传到外部服务
- 建议使用环境变量覆盖敏感配置（优先级高于 config.json）

## 使用示例

### 场景 1：首次完整配置

```bash
chainlesschain setup
```

按提示逐步完成版本选择、LLM 配置、下载和服务启动。配置完成后可直接使用 `chainlesschain start` 启动应用。

### 场景 2：CI/CD 环境快速配置

```bash
chainlesschain setup --skip-download --skip-services
```

跳过下载和 Docker 服务步骤，仅完成基础配置。适用于 CI/CD 或已有二进制的环境。

### 场景 3：重新配置 LLM 提供商

```bash
chainlesschain setup
```

重新运行向导即可修改 LLM 提供商和模型配置。新配置会覆盖旧的 `config.json`。

## 故障排查

| 问题                  | 解决方案                                            |
| --------------------- | --------------------------------------------------- |
| `Node.js X+ required` | 升级 Node.js 到要求的最低版本                       |
| 下载失败              | 检查网络连接，后续可用 `chainlesschain update` 重试 |
| Docker 服务启动失败   | 确认 Docker Desktop 运行中，检查端口占用            |
| `ExitPromptError`     | 用户按 Ctrl+C 取消向导，正常退出                    |
| 配置丢失              | 检查配置目录路径：`chainlesschain config list`      |

## 相关文档

- [启动应用](./cli-start) — 启动桌面应用
- [Docker 服务](./cli-services) — 管理后端服务
- [系统状态](./cli-status) — 查看系统状态
- [环境诊断](./cli-doctor) — 诊断环境问题

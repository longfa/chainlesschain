# CLI 0.166.161 与 LK 模型目录

## 概述

CLI **0.166.161** 已在 npm 公开，发布标签为 `v-npm-0-166-161`，绑定源码提交 `22f4dfea080546d586f75652fd5075671019ffb8`。三系统 CLI CI、Strict Sandbox、六目标原生验证、OIDC 发布和 npm 归档与签名来源核验均已通过。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45084571018) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45084574812) · [原生验证](https://github.com/longfa/chainlesschain/actions/runs/45084580552) · [npm 发布](https://github.com/longfa/chainlesschain/actions/runs/45084688787)

## 使用示例

```sh
npm i -g chainlesschain@0.166.161 --registry https://registry.npmjs.org
cc --version
cc llm models --provider lk --json
```

升级后重启 IDE 宿主。旧扩展所推荐的 CLI 版本以扩展自己的说明为准。

| 渠道                  | 版本         | 状态                                                                                                  |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| npm CLI               | `0.166.161`  | 已公开并回读验证                                                                                      |
| Open VSX              | `0.37.196`   | 配套 CLI `0.166.161`，[发布验证中](https://github.com/longfa/chainlesschain/actions/runs/45095531533) |
| JetBrains Marketplace | `0.4.211`    | 配套 CLI `0.166.161`，[发布验证中](https://github.com/longfa/chainlesschain/actions/runs/45095532301) |
| 移动端和桌面端        | `v5.0.3.147` | 候选，等待两款配套 IDE 公开验证                                                                       |

当前可下载的 Open VSX `0.37.195` 和 JetBrains `0.4.209` 分别推荐 CLI `0.166.160` 和 `0.166.159`。[Open VSX 商店](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) · [JetBrains 商店](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge/versions)

## 核心特性

`cc setup` 和 `cc ui` 的 LLM 配置会读平台公开目录，支持手动刷新。CLI 输出 `source: "live"` 时使用平台目录，`source: "bundled"` 时使用内置快照。配套 IDE 也提供模型刷新。

内置快照有 205 个条目，其中 89 个是对话模型，包括 GPT‑6.2 Sol 和 GPT‑6.2 Astra。两款模型支持 OpenAI Chat Completions 和 Responses。模型调用和账户权限以自己的 LK Key 为准。 [Sol 模型文档](https://chainlesschain.net/apidoc#model/gpt-6.2-sol) · [Astra 模型文档](https://chainlesschain.net/apidoc#model/gpt-6.2-astra)

## 系统架构

CLI 和 Web 工作台通过公开接口取得模型名称、类型和支持的协议。JetBrains 通过配套 CLI 读取该目录。离线快照随安装包提供。

## 配置参考

在 `cc setup` 或 Web 工作台的 LLM 配置里选择 LK 和所需协议。默认 OpenAI 兼容模型为 `gpt-6.1-sol`。选择 `gpt-6.2-sol` 或 `gpt-6.2-astra` 后，用已保存的 LK 连接测试。

## 性能指标

本轮核验了在线目录和离线快照。生成延迟与任务质量需用实际 LK 连接测量。

## 测试覆盖

发布提交通过 Linux、macOS 和 Windows 的 CLI CI 与 Strict Sandbox，原生验证覆盖六个目标。npm 发布后的归档 SHA-512 与 Actions 归档一致。

## 安全考虑

公开目录无需使用 LK Key。模型调用和账户查询使用已保存的 LK Key。生产付费就绪、原生准入和自动晋级的状态分别为 `NOT_PAID_READY`、`NOT_ADMITTED`、`HOLD`。

## 故障排查

目录获取失败时，CLI 输出 `source: "bundled"`。网络恢复后可重新查询，Web 工作台和配套扩展可点击「刷新模型」。通过 `cc doctor` 核对 IDE 当前使用的 CLI 路径。

## 关键文件

- `packages/cli/src/lib/lk-catalog.js` 提供 CLI 目录查询。
- `packages/cli/scripts/sync-lk-model-catalog.mjs` 更新安装包的离线快照。

## 相关文档

[CLI 安装与配置](./cli-setup) · [IDE 指南](./ide-plugin) · [安装部署](./installation)

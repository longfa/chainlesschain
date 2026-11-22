# CLI 0.166.160 与 IDE 扩展升级指南

## 概述

CLI `0.166.160` 和配套 Open VSX `0.37.195` 已公开，发行源码为 `1dd4f2c6cc7128995312be08738ae5d6d692ad25`。公开 JetBrains `0.4.209` 推荐 CLI `0.166.159`。候选 `0.4.210` 推荐 CLI `0.166.160`，其 macOS IntelliJ 2025.2 宿主门禁失败，未上传。[npm 版本](https://www.npmjs.com/package/chainlesschain/v/0.166.160)

| 渠道      | 版本        | 公开状态             | 工作流                                                                                          |
| --------- | ----------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| npm       | `0.166.160` | 已公开验证           | [发布](https://github.com/longfa/chainlesschain/actions/runs/45018972099)                       |
| Open VSX  | `0.37.195`  | 已公开并验证 VSIX    | [发布](https://github.com/longfa/chainlesschain/actions/runs/45020514156)                       |
| JetBrains | `0.4.209`   | 已公开并验证 ZIP     | [下载](https://plugins.jetbrains.com/files/32208/1225644/chainlesschain-ide-bridge-0.4.209.zip) |
| JetBrains | `0.4.210`   | 宿主门禁失败，未上传 | [门禁](https://github.com/longfa/chainlesschain/actions/runs/45020514604)                       |

## 核心特性

- `cc tasks --json` 汇总后台 Shell、MCP、Agent、计划和协作任务，并显示任务状态、到期时间、等待项和停止路径。已到期的任务显示为 `expired`。
- CLI 记录任务停止结果和插件安装结果，并在接入 MCP 工具时验证输入 Schema。
- VS Code 增加会话分叉和工作流地图命令。JetBrains 更新 CLI 推荐版本及能力清单。

## 系统架构

CLI 将各任务来源转换为统一的任务记录，供命令行和状态栏呈现任务状态。VS Code 的会话分叉和工作流地图通过现有聊天面板入口打开。

## 配置参考

在 IDE 扩展设置里检查实际使用的 CLI 路径。并行安装多个 CLI 版本时，将 IDE 的路径指向本轮升级的可执行文件。[IDE 使用指南](./ide-plugin)

## 性能指标

本轮验证聚焦任务状态、停止结果和宿主兼容性，未新增模型任务性能基准。

## 测试覆盖

准确发行提交通过 Linux、Windows 和 macOS 的 CLI CI、CLI Strict Sandbox 和 Native Validation。GitHub Actions 先核验子包，再通过 OIDC 发布 CLI。公开安装、归档完整性及签名来源校验均已通过。[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45007170952) · [CLI Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45007170928) · [Native Validation](https://github.com/longfa/chainlesschain/actions/runs/45007199839) · [npm 发布](https://github.com/longfa/chainlesschain/actions/runs/45018972099)

## 安全考虑

本轮发行范围为 CLI 和配套 IDE 扩展。付费就绪 `NOT_PAID_READY`、原生准入 `NOT_ADMITTED` 和自动晋级 `HOLD` 仍按各自门禁执行。

## 故障排查

升级后重启 IDE，使用扩展的 Doctor 检查 CLI 路径与版本。若 `cc` 指向系统 C 编译器，改用 `chainlesschain --version` 并检查 npm 可执行目录是否在 `PATH` 中。

## 关键文件

任务聚合在 `packages/cli/src/lib/task-record.js`，CLI 入口在 `packages/cli/src/commands/tasks.js`，VS Code 命令注册在 `packages/vscode-extension/package.json`。

## 使用示例

```bash
npm i -g chainlesschain@0.166.160 --registry https://registry.npmjs.org
cc --version
cc doctor
cc tasks --json
```

## 相关文档

在扩展商店选择配套版本。VS Code 也支持从 VSIX 安装。[Open VSX 扩展](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) · [下载 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.195/file/chainlesschain.chainlesschain-ide-0.37.195.vsix) · [JetBrains Marketplace 版本列表](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge/versions) · [安装部署](./installation)

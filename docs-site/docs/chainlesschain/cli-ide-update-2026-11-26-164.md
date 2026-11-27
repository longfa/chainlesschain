# CLI 0.166.165 与 IDE 升级

## 概述

CLI **0.166.165** 已公开。Open VSX **0.37.200** 和 JetBrains **0.4.215** 已上架，均推荐该 CLI。按 Esc 可关闭模型选择器或中断任务。 [npm 发布](https://github.com/longfa/chainlesschain/actions/runs/45885605925) · [已核验 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.200/file/chainlesschain.chainlesschain-ide-0.37.200.vsix) · [JetBrains 下载](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1229060)

全屏输入、任务中斜杠命令和默认授权从 CLI **0.166.164** 起提供。上一组配套版本为 Open VSX **0.37.199** 和 JetBrains **0.4.214**。 [上一版 CLI](https://github.com/longfa/chainlesschain/actions/runs/45781019483) · [Open VSX 0.37.199](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide/0.37.199) · [JetBrains 0.4.214](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1228899)

## 使用示例

```sh
npm i -g chainlesschain@0.166.165 --registry https://registry.npmjs.org
cc --version
cc doctor
cc agent
```

升级 IDE 扩展后，重启宿主并用 Doctor 核对实际加载的 CLI 路径。VS Code 用户可以下载 VSIX，在扩展面板选择「从 VSIX 安装」。使用 Open VSX 的编辑器可在扩展面板更新。

## 核心特性

- 在支持交互的终端运行 `cc agent`。历史和模型输出显示在上方，底部输入区保持可编辑。用 Page Up 和 Page Down 翻阅输出。
- 输入 `/` 显示命令建议，用方向键和 Enter 执行。`/status`、`/help` 和 `/interrupt` 可以在任务进行中使用。
- 输入普通消息并按 Enter，将消息加入队列。当前轮次结束后按顺序处理。底部输入区为空时，按上方向键可取回最近一条待执行的消息并修改。
- 输入 `/model` 浏览和搜索当前供应商的模型，或通过 `/model <模型 ID>` 直接选择。运行期间切换的模型从下一轮生效。

## 系统架构

终端窗口维护交互输入和滚动位置，Agent 会话管理正在运行的轮次和待处理消息。选择模型时，运行中的轮次继续使用已绑定模型，下一轮读取新选择。

## 配置参考

用 `cc agent --provider <供应商> --model <模型 ID>` 指定初始模型，进入会话后可用 `/model` 切换。IDE 在 **Configure LLM** 中设置供应商和初始模型，也可刷新 LK 目录。 [IDE 配置](./ide-plugin)

## 性能指标

模型输出时，输入区继续响应。普通消息的等待时间取决于当前轮何时结束，`/status` 等即时命令可在该轮结束之前响应。

## 安全考虑

新 CLI 交互会话和配套 IDE 聊天默认自动批准常规工具调用。组织托管权限、显式拒绝规则和已批准计划的范围继续生效。CLI 使用 `/permissions strict` 恢复逐项确认。配套 IDE 使用 `/normal` 切回常规确认。

## 故障排查

CLI 0.166.164 的全屏模式可能漏掉单独按下的 Esc，可用 `/interrupt` 中断任务。CLI 0.166.165 已修复这一问题。 [Esc 修复](https://github.com/longfa/chainlesschain/pull/32)

## 测试覆盖

CLI **0.166.165** 的发行标签 `v-npm-0-166-165` 指向源码 `206e4e72257ec9178ddb66dcc28107e0ce3c43aa`。Linux、Windows 和 macOS 的 CLI CI 与 Strict Sandbox 均通过。公网 npm 安装包也已在 Windows 真终端验证全屏输入、默认授权、`/model` 和 Esc 中断。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45785746570) · [CLI Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45785746838)

CLI 发布标签 `v-npm-0-166-164` 指向源码 `80de4089bbc05773a37ff62737b85e39ab8927d3`。该提交通过 Linux、Windows 和 macOS 的 CLI CI 与 Strict Sandbox。发布工作流核验了 npm 归档和签名来源。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45768026105) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45768026017) · [设计与验证](https://design.chainlesschain.com/release-runtime-update-2026-11-26-164.html)

付费准入、原生客户端准入和自动晋级的状态分别为 `NOT_PAID_READY`、`NOT_ADMITTED` 和 `HOLD`。

## 关键文件

- [终端窗口和按键处理](https://github.com/longfa/chainlesschain/blob/206e4e72257ec9178ddb66dcc28107e0ce3c43aa/packages/cli/src/repl/terminal-window.js)
- [交互会话、命令与轮次队列](https://github.com/longfa/chainlesschain/blob/206e4e72257ec9178ddb66dcc28107e0ce3c43aa/packages/cli/src/repl/agent-repl.js)

## 相关文档

- [CLI Agent 使用指南](./cli-agent)
- [IDE 安装与配置](./ide-plugin)

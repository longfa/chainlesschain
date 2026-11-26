# 全屏交互终端、模型切换与授权

CLI **0.166.165** 的 Esc 修复已通过原提交 `206e4e72257ec9178ddb66dcc28107e0ce3c43aa` 的三平台验证并发布。Open VSX **0.37.200** 已公开且推荐该 CLI。JetBrains **0.4.215** 推荐 CLI **0.166.165**。 [npm](https://github.com/longfa/chainlesschain/actions/runs/45885605925) · [Open VSX](https://github.com/longfa/chainlesschain/actions/runs/45887848455) · [JetBrains](https://github.com/longfa/chainlesschain/actions/runs/45887849007) · [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45785746570) · [CLI Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45785746838)

公开发行的 CLI **0.166.164** 和 Open VSX **0.37.199** 对应源码 `80de4089bbc05773a37ff62737b85e39ab8927d3`。JetBrains **0.4.214** 也已公开，包内文件与正式构建核对一致。Esc 修复已经合入 `206e4e72257ec9178ddb66dcc28107e0ce3c43aa`，对应源码版本 CLI **0.166.165**、Open VSX **0.37.200** 和 JetBrains **0.4.215**。 [交互终端](https://github.com/longfa/chainlesschain/pull/28) · [Esc 修复](https://github.com/longfa/chainlesschain/pull/32) · [用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-26-164.html)

## 终端与轮次

`terminal-window.js` 管理屏幕绘制、底部输入、历史滚动和选择器，`agent-repl.js` 管理会话与轮次。交互 TTY 可使用全屏窗口，普通行输入兼容模式和 headless 继续使用原有入口。输出渲染与输入编辑分开，任务期间也能编辑当前输入。

`/status`、`/help`、`/interrupt` 等支持即时处理的命令可在当前轮执行。普通输入进入待发送队列，当前轮结束后依次取出。中断结束当前轮后，队列仍按会话规则继续。 [终端窗口源码](https://github.com/longfa/chainlesschain/blob/206e4e72257ec9178ddb66dcc28107e0ce3c43aa/packages/cli/src/repl/terminal-window.js) · [轮次调度源码](https://github.com/longfa/chainlesschain/blob/206e4e72257ec9178ddb66dcc28107e0ce3c43aa/packages/cli/src/repl/agent-repl.js)

## 模型切换

`/model` 从当前供应商的模型目录呈现可搜索的选项，也接收精确模型 ID。轮次开始时绑定该轮模型。运行期间选择的新模型存为下一轮配置，待执行消息在出队开启新轮次时使用它。模型弃用提醒跟随模型选择和实际使用路径。 [模型选择回归](https://github.com/longfa/chainlesschain/pull/29)

## 会话权限

CLI 的新交互会话默认使用 `auto`。IDE 按会话有效模式呈现权限状态，并支持 `/normal`。CLI 用 `/permissions strict` 返回逐项确认。授权仍经过组织托管策略、显式允许或拒绝规则和计划批准范围。计划约束保留自己的权限边界。

## 终端回归与发行

Windows 验证通过 ConPTY 的真实子进程检查关闭行为，同时核对退出回执、退出码和 PID 回收。后续回归覆盖 Node 对单独 Esc 设置 `meta: true` 的情况，通过按键序列区分单独 Esc 和 Alt+Esc。 [Windows 退出验证](https://github.com/longfa/chainlesschain/pull/31) · [Esc 测试](https://github.com/longfa/chainlesschain/pull/32)

CLI **0.166.164** 的相同源码提交通过 Linux、Windows 和 macOS 的 CLI CI 和 Strict Sandbox，npm 通过 GitHub Actions OIDC 发布。Open VSX 校验了公开 VSIX 与标签制品的一致性。JetBrains 上传在三平台宿主、构建和兼容性检查通过后执行。Marketplace 审核完成后，重新下载并核对了 ZIP 的包内内容。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45768026105) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45768026017) · [npm](https://github.com/longfa/chainlesschain/actions/runs/45781019483) · [Open VSX](https://github.com/longfa/chainlesschain/actions/runs/45783391508) · [JetBrains 发行记录](https://github.com/longfa/chainlesschain/actions/runs/45783392448) · [公开 ZIP](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1228899)

付费准入为 `NOT_PAID_READY`，原生客户端准入为 `NOT_ADMITTED`，自动晋级为 `HOLD`。

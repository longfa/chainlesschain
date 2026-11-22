# CLI 0.166.160 与 IDE 任务生命周期

CLI **0.166.160** 和 Open VSX **0.37.195** 已公开核验，发行源码为 `1dd4f2c6cc7128995312be08738ae5d6d692ad25`。JetBrains **0.4.210** 在 macOS IntelliJ 2025.2 宿主门禁失败，上传任务未执行。已核验可下载的 JetBrains **0.4.209** 推荐 CLI **0.166.159**。[CLI 发布](https://github.com/longfa/chainlesschain/actions/runs/45018972099) · [Open VSX 发布](https://github.com/longfa/chainlesschain/actions/runs/45020514156) · [JetBrains 门禁](https://github.com/longfa/chainlesschain/actions/runs/45020514604)

## 任务状态读取

实现提交 `75976d2790` 从后台 Shell、MCP、Agent、计划和协作任务生成统一记录。`cc tasks --json` 输出 `taskId`、`parentTaskId`、`source`、`state`、`lastEventAt`、`endsAt`、`waitingOn`、`stopPath` 和 `permissionProfileDigest`。`endsAt` 已过的任务显示为 `expired`，未知来源保留在结果中。既有任务列表计数继续由原有接口提供。

| 层       | 责任                                | 源码                                                                                              |
| -------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| 任务来源 | 提供事件和各自的停止路径            | `packages/cli/src/harness/background-task-manager.js`、`packages/cli/src/lib/mcp-task-runtime.js` |
| 统一记录 | 归一化任务 ID、状态、依赖和到期信息 | `packages/cli/src/lib/task-record.js`                                                             |
| 读取入口 | 命令行输出及状态栏渲染              | `packages/cli/src/commands/tasks.js`、`packages/cli/src/lib/status-line.cjs`                      |
| VS Code  | 从现有面板调用会话分叉与工作流地图  | `packages/vscode-extension/src/extension.js`、`packages/vscode-extension/src/chat/chat-view.js`   |

## 执行与权限

后台任务停止回执区分请求和清理结果。权限配置摘要随任务状态呈现，权限判断仍由执行入口负责。MCP 工具的输入 Schema 在接入处校验，插件安装回报结构化结果。`d6a2d7936a` 同步公开能力清单；源码中的推荐版本和实际公开可下载版本以各渠道回读为准。

## 发行证据

准确提交的 CLI CI、Strict Sandbox 和 Native Validation 覆盖 Linux、Windows 和 macOS。正式 OIDC 发布先核验 13 个子包，再核验 CLI 公开安装、归档完整性和签名来源。Open VSX 发布覆盖 Windows、macOS 和 Linux 宿主，以及浏览器和 Remote SSH，公开 VSIX 内的推荐 CLI 为 `0.166.160`。

本轮发布覆盖 CLI 与 Open VSX，JetBrains 候选仍受宿主门禁约束。`NOT_PAID_READY`、`NOT_ADMITTED` 和 `HOLD` 按各自验收范围执行。本轮没有新增模型任务验收。历史 PC 和移动客户端为 **v5.0.3.145**，旧下载源暂不可用。

[用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-22-160.html) · [实现提交](https://github.com/longfa/chainlesschain/commit/75976d2790) · [准确发行提交](https://github.com/longfa/chainlesschain/commit/1dd4f2c6cc7128995312be08738ae5d6d692ad25)

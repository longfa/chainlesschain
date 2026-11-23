# ChainlessChain 借鉴最新 Codex / Claude Code 的产品与工程实施方案（2026-11-22）

审核日期：2026-11-22。本文接续[2026-11-20 学习清单](./cli-ide-codex-claude-learning-review-2026-11-20.md)。11-20 版本判定 8 个工程任务包已完成；本轮不再重复"是否已有入口"，而是逐条把上游最新版本的**具体修复**映射到本仓库文件级证据上，区分"已具备""确有缺口""待核对"，并按可执行顺序给出实施方案。

结论以本节列出的源码路径、命令输出和官方 changelog 为准；未取到证据的项目显式标注，不按通过处理。

## 结论摘要

本节记录初审发现。当前实现和仍需验收的路径见“继续实施与本地验收”。

上游 2026-11-20 这一批发布的重心已从"新增能力"转向**生命周期边界的补洞**：任务停止能不能真停住、共享资源最后一个使用者退出时才关闭、安装副作用能不能被程序读到、非交互场景无人应答时默认拒绝、失败必须体现在退出码。Codex 0.171 则继续把 TUI 工作区、子代理转录和远程执行收进同一控制面。

结合本项目复核，四个**已证实**的缺口最值得优先做：

1. **统一任务视图名不副实。** [`lib/task-list.js`](../../../../packages/cli/src/lib/task-list.js) 注释写着 "Mirrors Claude Code /tasks behavior"，但实现只 `import { listBackgroundShellTasks }`，MCP 任务、审批等待、子代理、计划任务都不在列表里；CLI 190 个命令文件中也**没有**统一的 `tasks` 命令。
2. **状态栏没有任务状态词表。** [`lib/statusline.js`](../../../../packages/cli/src/lib/statusline.js) 里检索 `running/paused/failed/waiting` 均为 0 命中，说明它渲染的是数值/配置字段，而不是"哪个任务在等我"。
3. **插件安装的执行结果不可结构化读取。** [`commands/plugin.js`](../../../../packages/cli/src/commands/plugin.js) 只有 `auditPluginInstall()`（依赖 `CC_INSTALL_AUDIT`/`installPolicy`，**默认关闭**）和文本态 capability notice；全 CLI 源码检索 `commandFailed`/`commandPrinted` 为 0 命中。上游 2.1.330 正是给 `plugin install --json` 补了这两个字段。
4. **共享 MCP server 缺"最后一个使用者才关闭"的引用计数。** 全 CLI 源码中 `refcount` 仅出现在 `lib/process-execution-broker/platform-sandbox.js` 和 `lib/user-profile.js`；上游 2.1.330 修的正是"一个子代理结束时关掉了其它子代理仍在用的 MCP server"。

## 本次官方基线

| 产品        | 本日可核实版本            | 本批官方变更重点（与本项目相关）                                                                                                                                                                                                                                                                                                                                                                                                     | 资料                                                                  |
| ----------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Codex CLI   | **0.171.0**（2026-11-20） | TUI Workspace 默认启用；子代理转录、文档/图片预览；GPT-6.2 Sol/Astra 模型目录；`codex exec --remote`；工作区切换保留未跟踪文件                                                                                                                                                                                                                                                                                                       | [ChatGPT & Codex Changelog](https://learn.chatgpt.com/docs/changelog) |
| Claude Code | **2.1.330**（2026-11-20） | 子代理场景的 MCP server 共享生命周期；任务并发更新不丢依赖/元数据；后台会话恢复后不回到旧权限档；无人应答时破坏性命令直接拒绝；`plugin install --json` 增加 `commandPrinted`/`commandFailed`；`/loop` 类计划任务延长到 30 天并声明结束时间；self-hosted runner 新增 order→registered→first-session 指标与 spawn-runner hook 并发上限；VS Code 新增 `/fork`、`/workflows`、`contextUsageThreshold`；`claude -p` 落盘失败时改为 exit 1 | [Claude Code Changelog](https://code.claude.com/docs/en/changelog)    |

上游工具与 ChainlessChain 各自维护版本序列。仓库发布身份见下方“当前公开版本”。

## 值得借鉴的机制与本仓库证据

以下证据记录实施前的基线。当前入口与验收结果见后文。

每条格式为：上游做了什么 → 本项目现状（含取证方式）→ 应学到什么。

### 1. 任务中心必须覆盖"停止、结束时间、等待原因"

Claude 2.1.330 把递归计划任务和 `/loop` 从 7 天延长到 30 天，并**要求说明何时结束**；同时修了"任务依赖和元数据在并发更新时丢失"。Codex 0.171 把队列输入、恢复线程、子代理转录放进同一 TUI。

**本项目现状（已取证）**

- `packages/cli/src/lib/task-list.js`（全文 54 行）只聚合 `listBackgroundShellTasks()`，返回字段仅 `count/active/completed/tasks/formatted`，无 `state` 词表、无 `parentTaskId`、无"等待审批/等待 MCP 输入"来源。
- `packages/cli/src/commands/` 共 190 个 `.js`，存在 `mcp-tasks.js`、`agenda.js`、`ccron.js`、`loop.js`、`goal.js`、`background-session.js`，但**没有** `tasks.js`。
- `input_required` 只出现在 `lib/a2a-protocol.js`、`lib/dynamic-workflow-runtime.js`、`lib/mcp-stateless-protocol.js`、`lib/mcp-tasks.js`，在 `lib/mcp-task-journal.js`、`lib/statusline.js`、`lib/session-projection.js` 中为 0 命中——协议层有该状态，统一投影层没有。

**应学到什么**

- 单一 `TaskRecord` 视图要合并 source：`background-shell | mcp | agent | schedule | cowork`，字段至少 `taskId/parentTaskId/source/state/lastEventAt/endsAt/waitingOn/stopPath`。
- 计划任务必须显示 `endsAt` 与"到期后如何处理"，而不是只显示"运行中"。
- 并发更新走同一个 canonical writer，并且**读回校验**（`lib/mcp-task-journal.js` 已有 "canonical writer lock + readback" 注释，可作为其它来源的模板）。

### 2. 插件/安装副作用要能被程序读到，而不是只打印给人看

Claude 2.1.330 给 `claude plugin install --json` 增加 `commandPrinted`（安装命令写过 stderr）与 `commandFailed`（非 0、被杀、超时）。

**本项目现状（已取证）**

- `commands/plugin.js` 的 `auditPluginInstall()` 明确写着"opt-in，默认关闭，关闭时什么都不写"；这是审计轨迹，不是返回值。
- 全 CLI 源码无 `commandFailed`/`commandPrinted`。

**应学到什么**

- `cc plugin add/upgrade --json` 输出补充：`installCommand: { ran, exitCode, timedOut, signaled, printedToStderr, stderrDigest }`。
- 审计（默认关闭）与结果（总是返回）解耦：CI 和 IDE 需要的是**结果字段**，不是可选审计文件。
- 同类字段应复用到 `cc skill install`、`cc mcp add --command`。

### 3. 共享资源的生命周期：最后一个使用者退出才关闭

Claude 2.1.330 修了"子代理声明的 MCP server 在其中一个子代理结束时被关掉，而其它子代理或会话仍在使用"；同批还修了"被停止的后台子代理有时没有保持停止"。

**本项目现状（已取证）**

- 全 CLI 源码 `refcount` 仅 2 个无关文件命中（`platform-sandbox.js`、`user-profile.js`）。
- `lib/session-mcp-recovery`、`lib/mcp-host-recovery-runtime.js`、`lib/mcp-call-ledger.js` 已覆盖恢复与账本，但没有"按订阅者计数"的持有语义。

**应学到什么**

- MCP server 句柄引入 `holders: Set<taskId>`，`release(taskId)` 只在集合空时真正 shutdown；子代理 spawn/finish 必须成对 acquire/release。
- **停止要幂等且可验证**：`stop(taskId)` 返回 `{ requested, confirmed, orphanRisk }`，并在事件流中留下 `stop_requested → stop_confirmed | stop_timeout`；不能把"已发出信号"写成"已停止"。

### 4. 权限档位必须跟着会话走，不能跟着进程走

Claude 2.1.330 修了"后台会话在批准计划后有时以之前的权限模式醒来"，以及"权限提示期间附加的文本/图片在命令失败后丢失"。

**本项目现状（待核对）**

- 有 `lib/permission-side-effect-center.js`、`commands/permissions.js`、`commands/perm.js`、`lib/auto-mode-safety-classifier.js`，但本轮**未**取证"审批后权限档位是否随会话恢复"。列为 B 阶段专项验收，不按通过处理。

**应学到什么**

- 权限档位属于会话状态（写进 journal 的 `permissionProfileDigest`），恢复时以 journal 为准；进程/后台化、计划批准、模型切换都不得隐式改动它。
- 审批请求必须携带它针对的 `turnId`，防止旧审批在新 turn 上生效。

### 5. 无人应答时，破坏性动作默认拒绝

Claude 2.1.330 把更多针对根目录、home、顶层目录、工作目录的 `rm` 改成需要审批，并明确"**没人能回答时直接拒绝**"。

**本项目现状（待核对）**

- `rm -rf`/destructive 相关守卫分布在 23 个 lib 文件（如 `auto-mode-safety-classifier.js`、`permission-side-effect-center.js`、`process-execution-broker/index.js`、`side-effect-ledger.js`），覆盖面广；但"非交互（`-p`、CI、cron）无人应答时是拒绝还是放行"本轮未取证。

**应学到什么**

- 三分支显式化：`interactive-assent | policy-allow | no-answer → deny`。第三支必须落日志并给出可执行的下一步提示，而不是静默跳过。
- 把该分支纳入 CI 负向用例：无人应答路径**必须**得到非 0/拒绝结果。

### 6. 失败必须体现在退出码和输出上

Claude 2.1.330 修了 "`claude -p` 输出重定向到已满磁盘时静默 exit 0"。

**本项目现状（待核对，高风险）**

- CLI 有大量 headless 路径（`runtime/headless-runner.js`、`commands/agent.js` 的 `--remote`、`commands/batch.js`）。同款静默成功在本仓库风险更高，因为发布流水线依赖退出码。

**应学到什么**

- 统一"交付确认"：写入成功 → 读回校验 → 才允许 exit 0；`--json` 模式下 stdout 必须只剩 JSON，诊断走 stderr。
- 增加故障注入用例：只读目录、满盘、断网、EPERM（Windows 上 `npm i -g` 的 EBUSY/EPERM 已是本仓历史问题）。

### 7. 宿主/runner 的生命周期也要有数字

Claude 2.1.330 给 self-hosted runner 加了 `order_to_registered_seconds`、`order_to_first_session_seconds`，并让 spawn-runner hook 受 `--hook-concurrency`（默认 4）约束；checkout hook 返回 108 时立即停止本次启动、不再换 runner 重试。

**本项目现状（已取证）**

- `--remote` 出现在 `commands/agent.js`、`serve.js`、`hub.js`、`activitypub.js`、`sync-providers.js`；`lib/` 下无 self-hosted runner/orchestrator 模块（`self-hosted` 命中集中在 `cloud-client.js`、`remote-approval-bridge.js`、`execution-location-contract.js`）。

**应学到什么**

- 远程执行链路补"接单→注册→首个会话"三段计时，作为 `cc status`/`session-observability` 的字段，而不是只写日志。
- 启动钩子并发要有上限（与 `--hook-concurrency` 对应），并规定某一阶段失败的**终止语义**（停止本次启动 vs 换端点重试）。

### 8. IDE 侧：会话分叉和工作流地图

Claude 2.1.330 的 VS Code 扩展加了 `/fork`（在最后一条回复后分叉会话）、`/workflows`（打开带运行中 workflow 的 agent map）、`contextUsageThreshold`（控制上下文指示器何时出现）、`pinPrompt`、`escapeStopsClaude`。

**本项目现状（已取证）**

- `packages/vscode-extension/package.json` 中与任务/上下文相关的命令只有 `chainlesschain.worktree.tasks`、`chainlesschain.context.show`；无 fork、无 agent map/workflow 视图。

**应学到什么**

- 会话分叉是最便宜的"试错"能力：从任一 assistant 消息处分叉，派生新 `taskId` 并继承 `permissionProfile`，**不共享**副作用账本。
- 工作流地图应读同一份 task/journal 投影，而不是另建状态。
- 上下文指示器阈值化：低于阈值不占视觉空间。

### 9. 协议与工具层的健壮性修复值得照抄

Claude 2.1.330 修了：大量 MCP 工具的 `inputSchema` 被 API 拒绝导致 "JSON schema is invalid" 且**会话文件涨到几 MB**；LSP 调用在语言服务器冷启动期间并发失败；grep 在模式含换行且未开 multiline 时报"无匹配"而不是报错。

**本项目现状（待核对）**

- 有 `lib/mcp-stateless-protocol.js`、`commands/mcpscaf.js`、`commands/codeintel.js`，但未取证"非法 inputSchema 是否被提前拒绝并给出可行动错误"，以及"错误对象是否会把大 payload 写进会话文件"。

**应学到什么**

- 外部 schema 先校验后转发；拒绝时返回"哪个工具、哪个字段、如何修"，且**不落大 payload**。
- 语言服务器未就绪时，工具调用应排队或明确失败，而不是并发读到半初始化状态。
- "无匹配"与"模式非法"必须区分开——这是本仓库 `code_intelligence` 降级路径的同款风险。

### 10. 模型与推理档位的传播

Claude 2.1.330 让子代理的模型回退（fallback）**传导**给它派生的代理与区域设置；prompt hook 的 `model` 字段接受 `haiku`/`sonnet` 别名；未被识别的含 `sonnet`/`haiku` 的模型名改用短系统提示。

**本项目现状（待核对）**

- 有 `lib/task-model-selector.js`、`commands/sync-providers.js`、`lib/model-catalog-review.js`。未取证"父任务模型回退是否传导到子代理与 compaction"。

**应学到什么**

- 把 `modelDecision`（请求模型、实际模型、回退原因、区域/端点）写进 task 事件，父子任务共用同一决策来源。
- 别名解析集中在一处，禁止各命令自行比对字符串。

## 已有能力核对表

| 能力                          | 取证方式                                                                | 结论                         |
| ----------------------------- | ----------------------------------------------------------------------- | ---------------------------- |
| MCP Task journal 并发写       | `lib/mcp-task-journal.js` 含 canonical writer lock + readback 注释      | 已具备（可作为其它来源模板） |
| OTel / span 导出              | `lib/observability/otlp-exporter.js`、`lib/telemetry/span-recorder.js`  | 已具备                       |
| 远程执行入口                  | `commands/agent.js`/`serve.js`/`hub.js` 的 `--remote`                   | 已具备（缺生命周期指标）     |
| Hook 运行时与信任             | `lib/hooks-v2-runtime.js`、`lib/hook-trust.js`、`lib/doctor-checkup.js` | 已具备                       |
| Agent Team / worktree         | `lib/agent-team/`、`lib/agent-worktree.js`、`lib/worktree-isolator.js`  | 已具备                       |
| 破坏性命令守卫                | 23 个 lib 文件命中 `rm -rf`/`destructive`                               | 已具备（无人应答分支待核对） |
| 统一任务视图                  | `lib/task-list.js` 仅聚合 background shell；无 `commands/tasks.js`      | **缺口**                     |
| 状态栏任务状态                | `lib/statusline.js` 无状态词表                                          | **缺口**                     |
| 插件安装命令结果字段          | 全 CLI 无 `commandPrinted`/`commandFailed`；仅有 opt-in 审计            | **缺口**                     |
| MCP server 多订阅者计数       | 全 CLI 无 `refcount` 语义                                               | **缺口**                     |
| VS Code 会话分叉 / 工作流地图 | `packages/vscode-extension/package.json` 仅 worktree.tasks/context.show | **缺口**                     |
| 计划任务 endsAt 与到期处理    | 有 `agenda/ccron/loop` 命令，未取证 endsAt 投影                         | 待核对                       |
| 审批后权限档位随会话恢复      | 有权限模块，未取证恢复语义                                              | 待核对                       |
| headless 落盘失败 exit 码     | 有 headless runner，未做故障注入                                        | 待核对                       |
| 非法 MCP inputSchema 提前拒绝 | 有协议模块，未取证                                                      | 待核对                       |
| 模型回退向子代理传导          | 有 model selector，未取证                                               | 待核对                       |

## 实施方案

排期按"先立协议与字段，再修生命周期，最后做体验"推进。每个任务包都必须留下可复现的失败/通过证据，禁止用"已实现"代替"已验收"。

| 优先级 | 任务包                  | 主要改动点                                                                                                                        | 通过条件                                                                                                                                       |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| P0     | 统一 TaskRecord 投影    | 新增 `lib/task-record.js`（source adapters）+ `commands/tasks.js`；改造 `lib/task-list.js` 为多来源聚合                           | 一个 MCP 长任务 + 一个后台 shell 任务 + 一个计划任务同时出现在 `cc tasks --json`；含 `state/endsAt/waitingOn/stopPath`；未知来源不得被静默丢弃 |
| P0     | 停止语义                | `stop(taskId)` 返回 `{requested,confirmed,orphanRisk}`；子代理/后台会话统一走该路径                                               | 停止后事件流出现 `stop_confirmed` 或 `stop_timeout`；故意制造孤儿进程时 `orphanRisk=true` 且能被 doctor 列出                                   |
| P0     | 插件安装结果字段        | `cc plugin add/upgrade --json` 增加 `installCommand{ran,exitCode,timedOut,signaled,printedToStderr,stderrDigest}`；skill/mcp 同构 | 安装一个执行 stderr 输出的插件，`--json` 能读出 `printedToStderr=true` 与 `exitCode`；失败安装不返回成功状态                                   |
| P0     | 无人应答拒绝分支        | 在破坏性命令判定中显式区分 `interactive-assent / policy-allow / no-answer`；`no-answer` 落审计并拒绝                              | 非交互模式下对 home/根目录类 `rm` 得到拒绝 + 可行动提示；负向用例必须失败（非 0），不得静默通过                                                |
| P1     | MCP 句柄引用计数        | server 句柄持 `holders:Set<taskId>`；子代理 acquire/release 成对；shutdown 仅在集合空时                                           | 两个子代理共用同一 server，先结束者不得关闭它；两者都结束后 server 关闭且有事件证据                                                            |
| P1     | 权限档位随会话          | `permissionProfileDigest` 写入 journal 并在恢复时以 journal 为准；审批请求绑定 `turnId`                                           | 后台会话批准计划后恢复仍保持批准后的档位；旧审批不得作用于新 turn                                                                              |
| P1     | 计划任务 endsAt         | agenda/ccron/loop 输出 `endsAt`、到期动作、下一次运行时间                                                                         | `cc tasks --json` 与状态栏都能看到 endsAt；到期后状态为 `expired` 而非"运行中"                                                                 |
| P1     | headless 退出码契约     | 写盘/读回/交付三段校验；stdout 仅 JSON                                                                                            | 满盘/只读目录/EPERM 注入下 exit≠0 且有可行动错误；`--json` 输出可被 `JSON.parse` 直接解析                                                      |
| P2     | 状态栏任务字段          | `lib/statusline.js` 增加 `taskState/contextPct/approvalsPending/mcpErrors`，并支持阈值隐藏                                        | 状态栏能显示"等待审批"和待审数量；阈值以下不显示上下文指示器                                                                                   |
| P2     | VS Code 会话分叉与地图  | 新增 fork 命令（从消息处分叉，派生 taskId、不共享副作用账本）；工作流地图读同一投影                                               | 分叉后两条会话各自独立完成、互不覆盖；地图中运行中 workflow 与 `cc tasks` 一致                                                                 |
| P2     | runner 生命周期指标     | 远程/宿主补 order→registered→first-session 计时；启动钩子并发上限与失败终止语义                                                   | `cc status --json` 能读到三段耗时；钩子并发超限时有排队记录；某阶段失败时停止本次启动而非换端点重试                                            |
| P2     | 外部 schema 与 LSP 竞态 | inputSchema 先校验后转发；LSP 冷启动排队；"无匹配"与"模式非法"分离                                                                | 非法 schema 返回结构化拒绝且会话文件不增长；冷启动期调用得到明确排队/失败结果                                                                  |

### 阶段划分

- **阶段 A（1 个迭代，P0）**：先立字段与契约——`TaskRecord`、停止语义、安装结果字段、无人应答拒绝。改完后先跑负向用例，再跑正向用例。
- **阶段 B（1–2 个迭代，P1）**：生命周期闭环——MCP 引用计数、权限档位随会话、endsAt、headless 退出码。每项必须有"故意制造故障"的用例。
- **阶段 C（2 个迭代，P2）**：体验与可观测——状态栏、IDE 分叉与地图、runner 指标、schema/LSP 健壮性。
- **阶段 D（后续）**：把上述字段接入能力清单与文档站；发布前按新提交重跑完整矩阵，不复用旧标签门禁。

### 建议的实现顺序（文件级）

1. `packages/cli/src/lib/task-record.js`（新建）→ `commands/tasks.js`（新建）→ 改 `lib/task-list.js` 保持向后兼容（旧返回值字段不删）。
2. `lib/mcp-task-journal.js` 的 state 词表提升为共享常量，供 `mcp-tasks.js`、`statusline.js`、`session-projection.js` 引用；先只读投影，不改写入语义。
3. `commands/plugin.js` 的 install 路径增加结果字段；`lib/install-command-policy.js` 的审计保持默认关闭，避免改变现有行为。
4. `lib/agent-team/` + `lib/background-task-manager.js` 接入统一 `stop()`。
5. `packages/vscode-extension/package.json` + 对应 provider 增加 fork / workflow map 命令，复用既有 webview 通道。

## 继续实施与本地验收

提交 `75976d2790` 建立了统一任务字段。下表记录继续实施后的工作树，发布记录对应已归档的发行提交。

| 任务包                | 当前证据                                                                                                                                                                                                                                      | 剩余验收                                                                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 统一任务投影          | 独立运行 `cc tasks --json` 可读持久化后台 shell、MCP 日志、后台 Agent、计划任务和项目内 Cowork 工作流。跨进程测试同时读回 shell、MCP 和计划任务。MCP 默认扫描最近 100 个 canonical 会话，`--session <id>` 可指定会话。REPL 可读同进程子代理。 | 即时 `run_shell` 命令的内存状态仍由所属运行时读取。跨宿主长期并发验收待补。                                                             |
| 停止与诊断            | 重复停止复用回执。后台 shell 可读回 `stop_requested`、`stop_timeout` 和后续 `stop_confirmed`，Doctor 会提示孤儿风险。后台 Agent 的 `cc tasks --json` 提供可执行的 `stopPath`，从持久时间戳读回 `stopEvents`。                                 | 已验证持久化重载后的孤儿风险、Doctor 告警和原持有者回收，也已验证第二层子代理正在调用模型时停止真实后台会话。跨平台长时间运行仍需复验。 |
| 插件安装结果          | Marketplace `add` 和 `upgrade` 与 Git 来源共用 `installCommand` 字段。本机 registry 退出 0/17，Git 获取退出 0/128。已实测外部 HTTPS 获取、回环代理拒绝和 120 秒超时。MCP 注册与 `cc skill add --json` 创建脚手架均返回 `ran: false`。         | 外部仓库获取成功但制品不符合插件格式时，CLI 仍以非零退出并保留 Git 回执。                                                               |
| 无人应答拒绝          | 无人应答策略和破坏性 Git 负向通过。真实 Agent 循环的 mock-provider 回归验证删除请求被拒绝，隔离目录内文件保留。                                                                                                                               | 已验证单次 CLI 和多轮 `stream-json` 输入均返回非零，并保留拒绝记录。多轮输入可继续处理后续合法消息。                                    |
| MCP 共享生命周期      | 活跃子代理持有同一 MCPClient 的 transport。宿主请求关闭时等待最后一个持有者释放。MCPClient 回归验证第一次释放后连接仍在，最后一次释放仅执行一次断开。                                                                                         | 本机有状态 HTTP MCP 已验证两个同时运行的子代理释放顺序。跨客户端共享与外部宿主长时间运行待验收。                                        |
| 计划任务与状态栏      | 到期时统一 `state` 和兼容别名，清理等待与停止提示。Windows REPL 在等待审批时输出 `task waiting` 和 `approvals 1`，占用低于设置阈值时隐藏上下文读数。                                                                                          | 调度宿主截图待补。                                                                                                                      |
| 权限档位与旧审批      | 流式和交互 REPL 批准均写入会话日志。Windows 与 Linux 已验证 `cc daemon resume` 和新 CLI REPL 进程恢复批准档位，并拒绝同工具改参数或重放已结算事项。                                                                                           | macOS 的交互复测待补。                                                                                                                  |
| Headless 交付失败     | Windows 真实只读会话文件通过。Linux 满盘与只读挂载下，单次 JSON 和多轮 NDJSON 均退出 1，保留 `before-model` 回执。Linux `/dev/full` 与 Windows 只读文件句柄均实测 stdout 写入失败，两种模式都退出 1。                                         | `EPERM` 与 `EACCES` 已覆盖注入测试。macOS 的 stdout 重定向仍待复验。                                                                    |
| VS Code 分叉与地图    | `cc session fork <id> --json` 支持按已验证的历史回复分叉。Windows 和 Linux 的 VS Code 1.145.2 安装候选 VSIX 后，两个聊天标签分别完成任务。已核对历史边界、两个独立的文件写入账本，以及工作流地图与 `cc tasks --json --active-only` 的一致性。 | macOS 宿主复测待补。                                                                                                                    |
| MCP Schema 与 LSP     | 首次发现、发现缓存及 `list_changed` 刷新共用 schema 准入。非法替换保留已接纳的工具目录，诊断含工具名和字段路径，回归验证大段描述未进入诊断。                                                                                                  | 真实 TypeScript 语言服务器已验证冷启动并发查询。已验证首次接入的非法 Schema 在准入前后不改变会话文件，模型目录不含被拒绝工具。          |
| Runner 指标与模型传播 | `cc status --runner-state` 可读 Runner 的首会话租约时间和三段耗时。模型回退结果接入子代理、内置自动压缩和会话日志。执行位置矩阵已验证本地 Linux、Windows、WSL、容器和严格 SSH 的目标进程及生命周期。                                          | macOS 执行位置、外部 provisioning 和真实模型供应商链路的端到端证据待补。                                                                |

### 可复现的本地验证

- CLI 跨进程、MCP、任务管理器和状态栏目标套件通过 148 项。覆盖多源任务读回、分叉后的独立回复、停止回执、MCP 引用释放和 Schema 刷新拒绝。跨进程场景由 `packages/cli/__tests__/integration/task-lifecycle-projection.test.js` 固化。
- 会话历史目标套件通过 41 项，包含独立 CLI 进程从所选历史回复处分叉。Shell 审批、破坏性删除和状态栏目标套件通过 28 项。
- Headless 持久化目标套件通过 18 项。实际 Marketplace command source 子进程与运行边界套件通过 11 项。
- VS Code 扩展通过 358 项 Node 测试。匹配版本的 Chromium Headless Shell 下，`npm run test:settings-ui` 通过三个面板的浏览器 smoke。
- CLI command manifest、help index、四项 startup SLO 和源码出站分类检查均通过。
- JetBrains 修复了动作完成时与在途轮询竞争而丢失刷新请求的问题。Windows 本地 Gradle `test` 成功，1,041 项通过、3 项跳过。真实 macOS 宿主的等待输入可见性仍需重新测量。

### 阶段 D 的命令参考

- 文档站已补充任务投影与停止事件、headless 写盘失败和状态栏阈值。另补充插件与 MCP 安装回执、Runner 三段耗时、VS Code 分叉与工作流对照命令。[Agent](../../../../docs-site/docs/chainlesschain/cli-agent.md#任务状态与停止回执) · [插件](../../../../docs-site/docs/chainlesschain/cli-plugin.md#安装命令回执) · [MCP](../../../../docs-site/docs/chainlesschain/cli-mcp.md#add) · [Runner](../../../../docs-site/docs/chainlesschain/cli-status.md#执行位置-runner) · [IDE](../../../../docs-site/docs/chainlesschain/ide-plugin.md#从历史回复分叉并查看工作流)
- 已通过 CLI 命令清单和公开 IDE 能力清单校验。文档站结构检查覆盖 352 个文件。VitePress 本地构建生成 707 个 HTML 页面，其中五份修改后的命令参考均已核对渲染结果。
- 公开 IDE 能力清单增加任务投影、状态栏上下文、安装命令回执、headless 持久化错误、Runner 启动时间和会话分叉的字段映射。校验器核对命令注册与指南路径，`cc tasks` 直接注册的命令入口也纳入核对。[能力清单](../../../cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json)
- `cc skill add --json` 已验证项目创建、全局创建、重复名称和无项目四条路径。成功回执返回技能位置，失败回执返回 `error.message` 和退出码 1。两者共用 `installCommand`，均未启动子进程。技能与插件回执的 13 项进程测试和 6 项能力清单测试通过。新增技能参考和状态栏字段也已在 707 页文档站构建中验证。

### 2026-11-23 续验

- 流式 headless 逐会话创建 `PlanModeManager`。批准时把档位、工具白名单和已批准事项摘要写入会话日志。单次 headless 续跑采用同一执行锁。新进程回归验证了档位恢复和事项结算，并验证显式档位冲突、快照篡改和快照丢失会拒绝启动。
- `cc status --json --runner-state <file>` 可读取执行位置 Runner 的接单、注册和首个会话租约获准时间及三段耗时。接单时间由调用方提供。已授权的 post-session hook 走 FIFO 并发队列，前一项失败后会释放槽位。实际远程目标进程启动时间和 provisioning 钩子仍需远程宿主提供证据。
- 配置回退和可运行供应商回退都使用成功请求的模型决策。子代理继承实际模型和连接，声明的子代理模型可覆盖继承结果。内置自动压缩可沿用同一连接，持久会话的决策事件仅保存模型、供应商和端点来源摘要。严格计量路径继续遵守现有的每次物理请求结算边界。
- 本轮目标套件通过 222 项。计划与旧审批 30 项，模型回退与子代理 96 项，Runner 与目标执行位置 60 项，压缩与计量 36 项。`headless-stream-plan.test.js` 包含新进程读取、单次 headless 续跑和篡改拒绝。`execution-location-runner-lifecycle.test.js` 通过独立的 CLI 进程验证 JSON 输出。命令清单、启动 SLO 和源码出站分类检查通过。

### LK 聚合平台目录

- 平台公开目录已返回 `gpt-6.2-sol` 和 `gpt-6.2-astra`，两者支持 Chat Completions 和 Responses。已同步至内置模型快照。[GPT-6.2 Sol 文档](https://chainlesschain.net/apidoc#model/gpt-6.2-sol) · [GPT-6.2 Astra 文档](https://chainlesschain.net/apidoc#model/gpt-6.2-astra)
- `cc setup`、`cc llm models --provider lk --json`、Web、VS Code、JetBrains 和桌面设置按需获取公开目录。设置页可手动刷新，平台暂时不可达时使用内置目录。目录请求无需 LK Key。真实模型调用和账户权限待按账户验证。
- 本机 CLI 以 `source: "live"` 读取到 205 个模型及两个 GPT-6.2 ID。CLI、Web、VS Code、JetBrains 与桌面本地测试覆盖离线回退、协议筛选、配置草稿及凭据边界。VS Code 设置页浏览器 smoke 通过。

### 2026-11-23 晚间验收

- 单次 headless 原先会在拒绝删除后被模型的最终回复覆盖为成功。本轮默认模式与 `--unattended` 均保留 `dangerous-delete` 拒绝记录，返回退出码 1、`is_error: true` 和 `CC_DESTRUCTIVE_SHELL_DENIED`。测试只使用临时用户目录，拒绝后标记文件完整。即使模型最后给出满足 Schema 的对象，流式外层进程也返回同一退出码。Schema 重试仅在运行成功且输出校验失败时继续。[进程级回归](../../../../packages/cli/__tests__/e2e/headless-destructive-denial.test.js)
- 从本机临时 registry 启动真实 `cc plugin add --json`，成功回执记录安装程序退出码 0；失败回执记录安装程序退出码 17、CLI 退出码 1。两次均记录 `printedToStderr` 和一致的 SHA‑256 摘要。[registry 安装回归](../../../../packages/cli/__tests__/e2e/plugin-marketplace-command-receipt.test.js)
- 两个真实 `SubAgentContext` 在本机重叠运行并共享一个有状态 HTTP MCP 会话。宿主请求关闭后，第一个子代理退出，`tools/call` 仍使用原会话成功。最后一个子代理退出后，服务端收到一次携带原会话 ID 的 `DELETE`。[共享连接集成回归](../../../../packages/cli/__tests__/integration/subagent-mcp-late-connection.test.js)
- 真实 `typescript-language-server` 4.4.1 与 TypeScript 5.9.3 冷启动时，同时查询跨文件定义和引用均返回正确文件。诊断、文档符号和重命名预览也通过。[真实语言服务器回归](../../../../packages/cli/src/lib/lsp/__tests__/code-intelligence.integration.test.js)

Windows 本地进程级回归 6 项、MCP 集成与单元回归 92 项、LSP 集成与单元回归 40 项、Schema 与拒绝记录单元回归 56 项、headless 拒绝摘要回归 6 项通过。命令清单、四项 CLI 启动 SLO 与改动文件的 ESLint 错误检查通过。

以上为该轮源码的本地证据。后台进程回收的后续结果见下一节。

### 2026-11-23 多轮协议与任务回收验收

- 两条消息通过真实 CLI 的 `--input-format stream-json` 输入。第一轮的危险删除被拒绝，返回 `CC_DESTRUCTIVE_SHELL_DENIED`，拒绝记录持久化。符合 Schema 的模型回复未被当作第一轮成功值发布。第二轮合法请求成功并产生 Schema 校验结果。stdin 结束后，进程以退出码 1 反映第一轮失败。临时用户目录内的标记文件完整。[多轮进程回归](../../../../packages/cli/__tests__/e2e/headless-destructive-denial.test.js)
- 本机 MCP HTTP 服务在 `tools/list` 返回包含长描述的非法 `inputSchema`。运行中 headless 会话的 JSONL 在准入前后字节相同，模型请求及最终会话不含该工具或长描述。错误包含字段路径，普通回复仍可持久化。[Schema 会话边界回归](../../../../packages/cli/__tests__/integration/mcp-schema-admission-session.test.js)
- 对同一本机 registry 执行 `cc plugin upgrade --json`。fixture 产物摘要改变时沿用显式来源变更审批。安装程序退出 0 时激活 `2.0.0`，退出 17 时 CLI 返回非零及回执，激活指针保持 `1.0.0`。[安装与升级回归](../../../../packages/cli/__tests__/e2e/plugin-marketplace-command-receipt.test.js)
- 实际启动后台 Shell worker 及其 Node 子进程。重载任务记录后的管理器没有进程句柄，发起停止时记录 `stop_requested`、`stop_timeout`。`cc tasks --json` 显示 `orphanRisk: true`，`cc doctor --json` 发出未确认停止告警。原持有者清理进程树后，子进程退出，状态变为 `cancelled`，风险字段清除。[实际进程回收与诊断回归](../../../../packages/cli/__tests__/integration/task-lifecycle-projection.test.js)
- 通过 Windows 的文件只读属性在会话准入后制造真实写入失败。CLI 返回退出码 1 和 `before-model` 持久化诊断，JSON 可解析。测试确认模型未调用，原会话字节保持不变。[只读会话文件回归](../../../../packages/cli/__tests__/integration/headless-readonly-session.test.js)

Windows 本地进程级回归 9 项、任务与 MCP 回归 79 项、流式协议与拒绝记录单元回归 125 项、实际只读会话文件回归 1 项通过，共 214 项。命令清单校验、改动文件的 ESLint 错误检查及 Git 差异检查通过。

### 2026-11-23 后台宿主与两层子代理验收

- `cc daemon resume` 重建启动档案。新宿主将档案中的原权限档位用作会话没有有效批准时的默认值，并在执行前核验会话日志中的批准回执与计划执行锁。显式替换档案时仍检查权限档位冲突。批准快照缺失或与回执不匹配时拒绝启动。
- 持久会话在执行前将工具参数与该工具的下一项批准事项核对。Windows 端到端测试让原后台宿主退出，用流式 CLI 为同一会话批准 `acceptEdits`，再启动新宿主。测试验证改写到未批准路径会被拒绝，批准的文件写入成功，重复执行已结算事项也会被拒绝。
- Windows 端到端测试让后台 Agent 通过真实工具调用派生两层子代理。第二层到达本机 Ollama 协议测试端点后，`cc agents stop` 终止后台进程及在途请求。独立运行 `cc tasks --json` 可从 `stopEvents` 按顺序读回 `stop_requested` 和 `stop_confirmed`。
- `packages/cli/__tests__/e2e/background-agent-lifecycle.test.js` 的两个用例均通过，模型回复由本机测试服务提供。计划模式、任务投影、后台启动档案和真实后台进程回归均通过，命令清单与 `git diff --check` 通过。

### 2026-11-23 VS Code 原生宿主验收

- Windows 上用 VS Code 1.145.2 安装当前源码打包的扩展 `0.37.196`。从历史回复分叉后，源会话保持打开，新标签从选定的回复继续。两边各写了一个文件，测试等到界面读回已保存的回复后，分别核对了 canonical 历史与 `file-write` 账本。模型响应由本机测试服务提供。[原生宿主测试入口](../../../../packages/vscode-extension/test/extension-host/run-session-fork.cjs)
- Workflow Map 显示了同一个正在运行的 Cowork 工作流。测试把名称、状态、任务 ID 和父任务 ID 与独立执行的 `cc tasks --json --active-only` 逐项核对。
- 从仓库根目录运行 `npm --prefix packages/vscode-extension run package -- --out <VSIX 绝对路径>` 打包，再运行 `node packages/vscode-extension/test/extension-host/run-session-fork.cjs --vscode-executable <绝对路径> --vscode-version 1.145.2 --vsix <VSIX 绝对路径>` 复现。
- 扩展 Node 套件通过 359 项。

### 2026-11-23 交互审批与安装回执验收

- 管道驱动 Windows 的真实 CLI readline REPL。原进程在 `acceptEdits` 档位批准计划并退出。新进程恢复为 `trusted`，拒绝显式 `manual` 冲突及 `/permissions autopilot` 切换。模型三次请求写文件，只有批准路径和参数的一次执行成功。未批准路径未创建，已结算事项的重放被拒绝。[REPL 进程回归](../../../../packages/cli/__tests__/e2e/repl-plan-approval.test.js)
- 同一 REPL 退出计划后遇到需要确认的工具请求。等待审批时，终端输出待审数量 1，低上下文占用下隐藏上下文指示器。500 ms 无应答后工具被拒绝。
- `cc plugin add --json` 从临时 Git 仓库克隆并安装，记录 Git 退出码 0 和 stderr 摘要。缺失仓库返回 CLI 退出码 1 与 Git 退出码 128。回执也用于 Git 来源的升级。[安装回执进程回归](../../../../packages/cli/__tests__/e2e/plugin-marketplace-command-receipt.test.js)
- `cc mcp add --command --json` 输出可直接由 `JSON.parse` 解析。测试注册一个写标记的 Node 命令，回执为 `ran: false`，标记文件未创建。数据库启动和关闭诊断输出到 stderr。
- 上述 CLI 进程套件通过 6 项，后台 Agent 与无人应答套件另通过 6 项。REPL、插件、MCP 和 Runner 相关单元测试通过 382 项。命令清单、四项启动 SLO 和公开 IDE 能力清单校验通过。

### 2026-11-23 Linux 原生文件系统验收

- 实际满盘复现了单次 headless 的预算文件锁在模型调用前失败、stdout 为空的问题。修复后，单次入口将原始文件系统错误投影为 `CC_SESSION_PERSISTENCE_FAILED`，保留 `before-model` 阶段与退出码 1。流式入口使用同一回执契约。
- Linux x64 容器中使用 Node 22.20.0、npm `0.166.161` 的依赖和当前工作树的 CLI 源码。分别把 `sessions` 挂在用满的 1 MiB tmpfs 和只读 tmpfs 上。单次 JSON 和流式 NDJSON 的四个组合均退出 1，输出可解析，且模型调用数为 0。
- stdout 重定向到 Linux `/dev/full` 后，两种入口均退出 1 并向 stderr 输出写入失败。正常 stdout 的对照请求退出 0，返回完整 JSON。
- 在已安装依赖的 Linux 仓库中，按可靠性工作流创建两种挂载并设置 `CC_CLI_RELIABILITY_DISK_ENOSPC_HOME` 与 `CC_CLI_RELIABILITY_DISK_EROFS_HOME`，再运行 `node packages/cli/__tests__/fixtures/headless-native-filesystem.mjs`。[挂载配置](../../../../.github/workflows/cli-reliability-soak.yml) · [原生回归脚本](../../../../packages/cli/__tests__/fixtures/headless-native-filesystem.mjs)

### LK 目录发布候选 0.166.161

- 上一候选 `9438b5c91eabb7b4f494eb3457dc41bd2cc67dec` 的 Strict Sandbox 和六目标原生验证通过。本地流式与计划套件 95 项通过。CLI CI 在三个系统上均发现同一个过期的 `EACCES` 断言。[上一轮 CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45047479777) · [上一轮原生验证](https://github.com/longfa/chainlesschain/actions/runs/45047591088)
- `v-npm-0-166-161` 固定到 `22f4dfea080546d586f75652fd5075671019ffb8`。CLI CI、Strict Sandbox 三系统矩阵和六目标原生验证通过。13 个上游子包已公开下载校验。CLI 通过 OIDC 发布为 npm `latest`，公开归档与发行工作流归档的 SHA-512 相同，签名来源验证通过。[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45084571018) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45084574812) · [原生验证](https://github.com/longfa/chainlesschain/actions/runs/45084580552) · [npm OIDC 发布](https://github.com/longfa/chainlesschain/actions/runs/45084688787)
- IDE 精确源码 `f7abc5e74e87238e4673bb6eda3e409833fe18a6` 通过 IDE Extensions 和 ARM64 宿主验证。Open VSX `0.37.196` 已公开为最新版，公开 VSIX 和流水线制品的 SHA-256 均为 `23d7ddae1f1272ae8f8893bc51e4258a3f42b522282f589cf38306f75d299ecf`，包内推荐 CLI `0.166.161`。JetBrains `0.4.211` 已通过全宿主验证并上传商店，公开上架待核验。[IDE Extensions](https://github.com/longfa/chainlesschain/actions/runs/45047153828) · [ARM64](https://github.com/longfa/chainlesschain/actions/runs/45047153787) · [Open VSX 发布](https://github.com/longfa/chainlesschain/actions/runs/45095531533) · [JetBrains 发布](https://github.com/longfa/chainlesschain/actions/runs/45095532301)
- JetBrains Marketplace 已批准并公开 `0.4.211`（更新 ID `1226836`）。公开 ZIP 的 SHA-256 为 `717a0ef85b9572ffec7e757205cfaa93c0b9cd805e98f93a276f1ab402986a98`。与流水线 ZIP 逐项核对，两项归档内容一致，内置插件描述符推荐 CLI `0.166.161`。[JetBrains 公开 ZIP](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1226836)
- 移动与桌面候选 `v5.0.3.147` 等待 Android 内嵌 CLI `0.166.161`。当前 Android 固定归档对应 `0.166.145`，上游归档下载返回 404。[Android 当前归档](https://github.com/chainlesschain/chainlesschain/releases/tag/internal-binaries-android-v20261110)

### CLI 0.166.162 与配套 IDE 的发布候选

- 候选 `89e7bc37cdeb951014e6690953f5805422461ba6` 在 `main` 补齐技能回执和公开能力清单。CLI、Open VSX 和 JetBrains 版本分别为 `0.166.162`、`0.37.197` 和 `0.4.212`。两款插件的推荐 CLI 都是 `0.166.162`。三个候选版本尚未上架。[候选源码](https://github.com/longfa/chainlesschain/commit/89e7bc37cdeb951014e6690953f5805422461ba6)
- 13 个上游 npm 包沿用已发布版本。已按 npm 的完整性字段下载并校验所有归档，CLI 直接依赖与仓库固定版本相同。OIDC 发布工作流还会比较候选和公开子包归档，并核验签名来源。
- Windows VS Code 1.145.2 安装 `0.37.197` 候选 VSIX 后复跑了两条会话分叉、各自的文件写入账本及运行中工作流地图对照。候选命令清单、帮助索引、补全、IDE 能力清单和 Marketplace 元数据检查已通过。复审 `agent-core.js` 相对上一发布标签的差异后更新了模型出站审查摘要，88 个源码文件和脚本通过预检。
- Linux x64 的 12 项 CLI 进程回归通过，覆盖交互审批恢复、后台进程回收、插件安装回执与无人应答拒绝。Windows 通过 `openSync(path, "r")` 将只读文件句柄传给子进程 stdout。正常输出对照成功，单次 JSON 与流式 NDJSON 写入均报告 `EBADF` 并退出 1。
- Windows 使用真实 Git HTTPS transport，向临时回环代理发起 CONNECT。代理返回 502 时，`cc plugin add --json` 退出 1，Git 回执退出码 128。代理保持连接但不回应时，Git 在约 120 秒后被终止，CLI 退出 1，回执包含 `timedOut: true`、`signaled: true`、`exitCode: null` 和 stderr 摘要。两次均使用测试域名，代理未转发请求。
- 从隔离项目运行 `cc plugin add https://github.com/octocat/Hello-World.git --json`，实际 Git HTTPS 获取成功，回执记录 `ran: true` 和 `exitCode: 0`。仓库缺少插件制品，CLI 以 1 退出并返回 `CC_PLUGIN_INSTALL_FAILED`，同一响应保留底层 Git 回执。
- 上一候选 `5321e5338e` 在 Windows 本地构建并打包。隔离目录安装该归档后，`cc --version` 输出 `0.166.162`，Web Panel 构建资源随包交付，10 个 CLI 直接依赖的内部 npm 包均解析到公开 npm 上的固定版本。候选 VS Code 扩展的 359 项 Node 测试全部通过。
- Linux x64 容器内使用 Xvfb 启动通过官方 SHA-256 校验的 VS Code 1.145.2。真实宿主安装扩展 `0.37.197` 后完成分叉测试。进程退出 0，两条会话的历史和副作用账本独立，运行中的 Cowork 工作流在 IDE 与 CLI 投影一致。另有 41 项本地发布归档、精确提交门禁及来源验证测试通过。[原生宿主测试入口](../../../../packages/vscode-extension/test/extension-host/run-session-fork.cjs)
- 上一提交的 IDE 预检发现 JetBrains 兼容性章节中的安装命令仍引用上一 CLI 版本。修正示例后，JetBrains 发布元数据、VS Code Marketplace 元数据、公开能力清单、路线图 fixture 校验和 14 项 CLI 依赖门禁测试均在本地通过。[上一轮 IDE 预检](https://github.com/longfa/chainlesschain/actions/runs/45181512001/job/137716210861)
- 五组验证已按新的候选 SHA 发起，上一候选的门禁已提交取消请求。全部适用门禁通过后，按顺序发布 CLI，核对公开 npm 归档和来源，再发布并核对两款 IDE 插件。[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45191381509) · [严格沙箱](https://github.com/longfa/chainlesschain/actions/runs/45191381615) · [原生构建](https://github.com/longfa/chainlesschain/actions/runs/45191426226) · [IDE Extensions](https://github.com/longfa/chainlesschain/actions/runs/45191381375) · [IDE ARM64](https://github.com/longfa/chainlesschain/actions/runs/45191426766)
- 运行时源码提交 `73286530a5507cf311e165d132399f85f6238d0b` 已通过本地 Linux、Windows、WSL、容器和严格 SSH 的执行位置验证。下载五份制品后用仓库验证器复核了来源、文件摘要、进程生命周期和每个位置 100 次轨迹，共 500 次。第一轮 macOS 作业未获分配宿主即被取消，六个位置的汇总门禁未通过。第二轮已按同一 SHA 重跑完整矩阵。[首轮结果](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/1) · [第二轮验证](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/2)

### CLI 0.166.160 发布验证记录

已发布 CLI 和 Open VSX 的准确源码提交为 `1dd4f2c6cc7128995312be08738ae5d6d692ad25`。

| 项目                     | 结果                                                                                                     | 验证依据                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI CI                   | Linux、Windows、macOS 门禁通过，Windows PDH 复跑通过                                                     | [GitHub Actions](https://github.com/longfa/chainlesschain/actions/runs/45007170952/attempts/2)                                                                   |
| CLI Strict Sandbox       | 通过                                                                                                     | [GitHub Actions](https://github.com/longfa/chainlesschain/actions/runs/45007170928)                                                                              |
| CLI Native Validation    | 六个平台与汇总通过                                                                                       | [GitHub Actions](https://github.com/longfa/chainlesschain/actions/runs/45007199839)                                                                              |
| IDE Extensions 与 ARM64  | 手动触发的 IDE 验证与 ARM64 宿主验证均通过                                                               | [IDE Extensions](https://github.com/longfa/chainlesschain/actions/runs/45011424891) · [ARM64](https://github.com/longfa/chainlesschain/actions/runs/45011532658) |
| npm OIDC 发布            | 上游 13 个子包经核验后发布 CLI                                                                           | [GitHub Actions](https://github.com/longfa/chainlesschain/actions/runs/45018972099)                                                                              |
| Open VSX 发布            | 配套版本已公开                                                                                           | [GitHub Actions](https://github.com/longfa/chainlesschain/actions/runs/45020514156)                                                                              |
| JetBrains 候选 `0.4.210` | macOS Intel IntelliJ 2025.2 的 `needs_input` 可见性 P95 为 2,706 ms，门槛为低于 2,000 ms。上传作业已跳过 | [失败作业](https://github.com/longfa/chainlesschain/actions/runs/45020514604/job/137202314448)                                                                   |

## 2026-11-22 公开版本记录

| 渠道                  | 版本        | 公开读回                                                                                                  | 精确标签                 |
| --------------------- | ----------- | --------------------------------------------------------------------------------------------------------- | ------------------------ |
| npm                   | `0.166.160` | [npm 包](https://www.npmjs.com/package/chainlesschain/v/0.166.160)                                        | `v-npm-0-166-160`        |
| Open VSX              | `0.37.195`  | [公开扩展与 VSIX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide/0.37.195)              | `ide-vscode-v0.37.195`   |
| JetBrains Marketplace | `0.4.209`   | [公开 ZIP](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1225644)，推荐 CLI `0.166.159` | `ide-jetbrains-v0.4.209` |

继续实施后的改动仍需在新提交上通过相应发布矩阵。Codex 冷首次扫描继续使用 `recency_at + useStateDbOnly`，上游修复验证后再解除 HOLD。

## 不建议直接照搬的部分

- **不要用"上游有该字段"论证本项目已具备。** 本次复核里 `task-list.js` 的注释就写着 mirrors `/tasks`，实现却只有一种来源；注释不是证据。
- **不要让审计替代结果。** 默认关闭的审计轨迹不能承担 CI 判定，插件安装必须返回结构化结果。
- **不要用信号代替确认。** `kill()` 成功不等于子代理已停止，回收必须有 `stop_confirmed` 事件。
- **不要把云/远程执行当成本机执行。** 控制面转移不改变数据面权限，云结果不得冒充本机已应用。
- **不要为对齐上游而扩大公共 API。** `task-list.js` 新字段应增量添加，避免破坏既有调用方。
- **不要把"无发现"当"通过"。** 每个任务包都要有会失败的反例；只跑正向用例的验收不计入完成。

## 本轮验收清单

1. `cc tasks --json` 同时列出后台 shell、MCP 长任务、计划任务，且各自带 `state`、`endsAt`、`waitingOn`。
2. 停止一个有两级子代理的任务：事件流出现 `stop_requested → stop_confirmed`；制造孤儿进程时 `orphanRisk=true` 且 doctor 可见。
3. 安装一个会往 stderr 写内容的插件：`cc plugin add --json` 读出 `printedToStderr=true`、`exitCode` 正确；故意失败的安装不得返回成功。
4. 非交互模式对 home 目录执行删除类命令：得到拒绝与提示，且用例本身期望非 0。
5. 两个子代理共用同一 MCP server：先结束者不关闭它，全部结束后关闭并有事件证据。
6. 后台会话批准计划后恢复：权限档位保持批准后的值；旧审批不作用于新 turn。
7. 满盘/只读目录/EPERM 三种注入下 headless 运行：exit≠0，`--json` 仍可解析。
8. 状态栏在等待审批和低上下文占用两种情形下的显示符合阈值设置。
9. VS Code 中从一条回复分叉会话：两条会话独立完成，副作用账本不共享。
10. 非法 MCP `inputSchema`：被提前拒绝且会话文件大小不增长；LSP 冷启动期间的调用得到排队或明确失败。

## 资料与边界

- [ChatGPT & Codex Changelog](https://learn.chatgpt.com/docs/changelog)（Codex CLI 0.171.0，2026-11-20）
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog)（2.1.330，2026-11-20）
- [2026-11-20 学习清单](./cli-ide-codex-claude-learning-review-2026-11-20.md)
- [2026-11-08 差距复核](./cli-ide-codex-claude-gap-review-2026-11-08.md)
- 本仓库取证路径：`packages/cli/src/lib/task-list.js`、`packages/cli/src/lib/statusline.js`、`packages/cli/src/lib/mcp-task-journal.js`、`packages/cli/src/commands/plugin.js`、`packages/cli/src/lib/install-command-policy.js`、`packages/vscode-extension/package.json`、`packages/cli/src/lib/observability/otlp-exporter.js`

官方资料中的版本和能力会继续变化。下一次复核应重新读取 changelog，并把新增能力与准确提交、实际平台、账号可用性和真实任务证据分开记录；本轮标注为"待核对"的项目在取得源码或运行证据前不计入任何完成状态。

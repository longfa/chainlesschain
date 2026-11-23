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

下表记录 2026-11-22 的实施前基线。

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

提交 `75976d2790` 建立了统一任务字段。以下状态对应 2026-11-24 05:05（北京时间）的实际验证结果。

### 当前任务实际完成情况

| 任务                         | 实际状态                            | 已取得的验证证据                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 剩余验收                                                                       |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 统一任务投影                 | 已实现，场景通过                    | `cc tasks --json` 同时读回真实后台 Shell、HTTP MCP 长任务和计划任务，覆盖 `state`、`endsAt`、`waitingOn`、`stopPath`。MCP 默认扫描最近 100 个 canonical 会话，可用 `--session` 指定会话。Windows 和 SSH Linux 容器四个 Shell 重叠运行 121.246 秒，两端分别读回本地任务。                                                                                                                                                                                                       | 独立物理设备的并发场景待验收。即时 `run_shell` 的内存状态由所属运行时读取。    |
| 未知任务来源                 | 投影保留已复验                      | 在候选提交中调用 `listTasks({ sources })` 输入 MCP、自定义来源和无标签三条记录。JSON 保留三条记录、自定义来源名、等待原因、截止时间和无标签原始数据，未识别状态显示为 `unknown`。                                                                                                                                                                                                                                                                                              | —                                                                              |
| 停止、回收与诊断             | 已实现，场景通过                    | 两级子代理运行中停止后记录 `stop_requested` 和 `stop_confirmed`。超时负向覆盖 `stop_timeout`、孤儿风险与 `cc doctor` 告警。Windows 和 SSH Linux 已验证先停一个 Shell 时另一个继续运行，最终两端活跃列表归零。当前候选的 Windows 后台 Agent 端到端测试通过两项。                                                                                                                                                                                                                | macOS 长任务与后台会话实机复验仍待完成。                                       |
| 插件、技能与 MCP 安装结果    | 已实现，场景通过                    | 插件添加、升级和 Git 来源提供 `installCommand` 回执。已核对 stderr、退出 0/17、代理失败、120 秒超时，以及 Git 成功获取后因制品格式错误仍返回失败。技能脚手架与 MCP 注册返回 `ran: false`。                                                                                                                                                                                                                                                                                     | —                                                                              |
| 非交互无人应答拒绝           | 已实现，场景通过                    | 单次和多轮 headless 命令均拒绝破坏性操作并以非零退出，保留审计记录和隔离目录文件。多轮输入可继续处理后续合法消息。                                                                                                                                                                                                                                                                                                                                                             | —                                                                              |
| MCP 共享、释放与延迟连接     | 共享释放通过，Windows 有间歇失败    | 两个活跃子代理共享 transport，后释放的持有者仍可调用。Windows 至 Linux 的两个独立会话维持五分钟并各收到一次 `DELETE`。Linux 候选归档通过延迟连接套件 16 项。Windows 真实 HTTP 用例在两次并行运行返回 `outcome_unknown`，单独运行、带诊断和原版 MCP 用例的整组复跑均通过。                                                                                                                                                                                                      | 复核 Windows 并行失败的触发条件。                                              |
| 调度到期与状态栏             | 三个入口已实现，本地通过            | `agenda`、`lab ccron` 和 `loop` 输出截止时间、到期动作和下次运行时间。跨进程任务列表验证 `expired` 与空的 `nextRunAt`。回归 324 项通过，1 项 POSIX 用例在 Windows 跳过。                                                                                                                                                                                                                                                                                                       | 新候选三平台发布回归。                                                         |
| 调度命令参考                 | 文档站本地构建通过                  | 已核对 `agenda`、`loop` 及 `lab ccron` 的截止时间说明与渲染结果。最新 VitePress 构建生成 707 页。[调度命令参考](../../../../docs-site/docs/chainlesschain/cli-agenda.md#cc-lab-ccron-的进程内截止时间)                                                                                                                                                                                                                                                                         | 正式发布后更新版本标记。                                                       |
| 权限档位与旧审批             | 已实现，部分平台待验                | Windows 与 Linux 验证后台会话恢复、批准档位回读、参数变化拒绝和旧审批防重放。流式及交互 REPL 的批准均写入会话日志。当前候选的 Windows REPL 审批跨进程恢复已单独复跑通过。                                                                                                                                                                                                                                                                                                      | macOS 交互恢复复验。                                                           |
| 状态栏审批与上下文阈值       | Windows、Linux 安装包标准 REPL 通过 | 设阈值为 20%，实际占用 19.9% 时隐藏指示器，20% 和 20.1% 时显示，待审数量均为 1。30 项状态栏单元测试通过。从候选 `7107396e19` 的同一归档隔离安装后，Windows、Linux 的原版 REPL 用例均在既有时限下通过，完整用例分别耗时 30.17 和 15.73 秒，覆盖审批、恢复、拒绝及状态栏。早期 Windows 源码和 Linux 归档复验曾出现提示符启动超时。                                                                                                                                               | GitHub Actions 的三平台发布门禁待完成。                                        |
| Headless 失败交付            | 已实现，部分平台待验                | Linux 满盘、只读挂载和 `/dev/full`，以及 Windows 只读会话文件和 stdout 句柄均有实测。单次 JSON 与多轮 NDJSON 失败可解析并退出 1。`EPERM`、`EACCES` 有注入覆盖。                                                                                                                                                                                                                                                                                                                | macOS stdout 重定向复验。                                                      |
| VS Code 会话分叉和工作流地图 | 已实现，部分平台待验                | Windows 与 Linux 的 VS Code 1.145.2 已验证两个标签独立完成任务并分别写入副作用账本。Windows 用当前 CI 候选 VSIX `0.37.197` 复跑通过，工作流地图与独立 CLI 的活跃任务读回一致。[候选制品来源](https://github.com/longfa/chainlesschain/actions/runs/45225095657/job/137877503254)                                                                                                                                                                                               | macOS 真实宿主复验。                                                           |
| VS Code macOS 启动与恢复     | 发布候选 Intel 两版通过             | `009e5f3a3c` 在 Intel 稳定版 `1.147.0` 与最低版 `1.85.2` 均通过双根工作区、独立窗口和重启恢复。已复核两份报告、72 个文件，并确认安装的 VSIX 与候选摘要一致。[当前宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859263412) · [历史诊断制品](https://github.com/longfa/chainlesschain/actions/runs/45200157659/artifacts/14839808388)                                                                                                  | macOS 会话分叉与 ARM64 宿主待验。                                              |
| MCP Schema 与 LSP 冷启动     | 已实现，场景通过                    | 非法 Schema 在首次发现及刷新时被拒绝，并保留已接纳的工具目录。已核对会话文件无增长、模型目录未接纳非法工具，以及真实 TypeScript 语言服务器冷启动的并发查询。                                                                                                                                                                                                                                                                                                                   | —                                                                              |
| Runner 指标与严格 SSH        | 受控环境通过                        | `cc status --json --runner-state` 从 Windows 候选安装包读回三段耗时，Runner 生命周期 6 项测试通过。Windows 到 Linux 容器验证了固定主机密钥、钩子文件摘要、FIFO 回执和重放拒绝。三个会话后钩子分别以 `7, 0, 0` 退出。                                                                                                                                                                                                                                                           | macOS 执行位置及正式远程供应阶段的失败终止行为仍待验收。                       |
| 回退模型、子代理与压缩       | 已实现，本机通过                    | 真实 Ollama 首选模型返回 404，父任务与子代理实际使用 `qwen2:7b`。确定性自动压缩完成，独立语义摘要复验覆盖结构化接纳和降级。显式持久会话的严格计量负向退出 5。                                                                                                                                                                                                                                                                                                                  | 外部模型供应商的实际账户环境。                                                 |
| JetBrains 等待输入可见性     | 发布候选六个 x64 宿主通过           | 原候选 `1d5ea8f725` 的 macOS Intel `2025.2` 首轮 P95 为 2,168 ms。发布候选 `009e5f3a3c` 的 Linux、Windows、macOS Intel 各通过 `2024.2` 和 `2025.2`，每个宿主观测 100 次，全部达到 P95 低于 2,000 ms 的门槛。macOS Intel 两版 P95 分别为 1,274 和 1,007 ms。[原候选记录](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14852106933) · [当前 2025.2 证据](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859111966) | IDE ARM64 矩阵的三个 macOS 作业仍在排队。                                      |
| JetBrains macOS 启动与恢复   | 发布候选 Intel 两版通过             | `009e5f3a3c` 的 Intel `2024.2` 与 `2025.2` 均通过聊天、控制、重启恢复和停止。已复核四份报告及 208 个文件，重跑独立会话恢复与原生呈现校验。[2024.2 制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859355309) · [2025.2 制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859111966)                                                                                                                      | macOS ARM64 宿主待验。                                                         |
| LK 模型目录                  | 已实现，公开目录已验证              | CLI、Web 和 IDE 能刷新公开目录，内置快照包含 GPT-6.2 Sol 与 Astra。                                                                                                                                                                                                                                                                                                                                                                                                            | 使用生产账户验证模型调用及权限。                                               |
| 执行位置全矩阵               | 第六轮五个位置、500 次通过          | `73286530a5` 的第六轮 Linux、Windows、WSL、容器、严格 SSH 各通过 100 次。已下载同轮五份制品，独立复核来源、摘要和轨迹。macOS ARM64 因托管运行器容量不足，在启动前取消，六位置汇总未生成。[第六轮](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/6) · [第七轮](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/7)                                                                                                       | 第七轮完整重跑，等待同轮六位置证据。                                           |
| Codex 冷首次扫描             | 保持 HOLD                           | 稳定版 `0.171.0` 的 Linux 方向检查与 Windows、Linux 同时间排序检查已记录。预发布 `0.173.0-alpha.4` 使用生成的协议 Schema，在 Windows、Linux 每端跑六次不同时间戳和六次相同时间戳的冷首次扫描，共 24 次。全部翻完两页，不同时间戳的升降序均符合请求。相同时间戳的两种方向在两个平台均返回同一顺序。[稳定版](https://github.com/openai/codex/releases/tag/rust-v0.171.0) · [预发布版](https://github.com/openai/codex/releases/tag/rust-v0.173.0-alpha.4)                        | 维持 `recency_at + useStateDbOnly`，待稳定版通过跨平台冷启动和同时间排序门禁。 |
| CLI 与 IDE 正式发布          | 三个候选版本均待发布                | CLI `0.166.162` 的 Linux、Windows 门禁已有通过记录。严格沙箱 macOS ARM64 边界通过，原生能力与 CLI CI 的 macOS PDH 等待重跑。IDE `0.37.197`、`0.4.212` 的主分支矩阵共 18 个作业通过。[严格沙箱第二轮](https://github.com/longfa/chainlesschain/actions/runs/45251759303/attempts/2)                                                                                                                                                                                             | 完成候选提交的三平台 CLI 门禁和待验 IDE 宿主，CLI 公网归档核验后再发布 IDE。   |

### 可复现的本地验证

- CLI 跨进程、MCP、任务管理器和状态栏目标套件通过 148 项。覆盖多源任务读回、分叉后的独立回复、停止回执、MCP 引用释放和 Schema 刷新拒绝。跨进程场景由 `packages/cli/__tests__/integration/task-lifecycle-projection.test.js` 固化。
- 会话历史目标套件通过 41 项，包含独立 CLI 进程从所选历史回复处分叉。Shell 审批、破坏性删除和状态栏目标套件通过 28 项。
- Headless 持久化目标套件通过 18 项。实际 Marketplace command source 子进程与运行边界套件通过 11 项。
- VS Code 扩展通过 358 项 Node 测试。匹配版本的 Chromium Headless Shell 下，`npm run test:settings-ui` 通过三个面板的浏览器 smoke。
- CLI command manifest、help index、四项 startup SLO 和源码出站分类检查均通过。
- JetBrains 修复了动作完成时与在途轮询竞争而丢失刷新请求的问题。Windows 本地 Gradle `test` 成功，1,041 项通过、3 项跳过。真实 macOS 宿主的等待输入可见性仍需重新测量。

### 实进程任务、调度到期与 MCP 连接

- 候选 `89e7bc37cd` 在 Windows 上从独立 CLI 进程运行 `cc tasks --json --session <id>`。同时观测到正常运行的后台 Shell 和 HTTP MCP 任务，以及待执行计划。MCP 任务由 [durable-child](../../../../packages/cli/__tests__/fixtures/mcp-tasks/durable-child.mjs) 通过真实 `tools/call` 建立，凭据保存在临时 DPAPI vault。保持三个来源并发至少 12 秒后，另一个进程轮询 MCP 得到 `input_required`，CLI 投影显示 `waitingOn: "mcp-input"`，网络上共派发一次工具调用。旁观进程中 Shell 的 `stopPath` 为 `null`。原持有者请求停止并确认回收后，独立 CLI 读回 `cancelled`。
- 双进程复验发现，原来的同步 Shell 调用会阻塞工作进程心跳，导致长任务被误判超时。修复后同一台 Windows 宿主上的两个管理进程各运行一个真实 Shell 任务，并发 121 秒。6 次独立 `cc tasks --json` 调用验证了运行状态和停止后的读回。第一个持有者确认回收后，第二个进程继续执行。第二个任务也停止后，`--active-only` 不再返回这两个任务。相关回归 99 项通过。[修复与测试](https://github.com/longfa/chainlesschain/commit/bf05fdb4f827926db991d5baf1867ca44596e6aa)
- 在 Linux 容器内，用候选的 Shell 执行器和 broker 文件替换安装验证环境中的对应文件。实际命令运行期间事件循环仍可以处理其他事件。子进程收到 stdin EOF，非零退出保留退出码和两路输出。
- 在无网络 Linux 容器内，以非 root 用户从候选归档运行两个独立的后台 Shell 管理进程。两项任务并发 125 秒，通过挂载 `registerTasksCommand` 的独立进程执行 6 次任务查询。第一项停止后第二项仍可运行，最后两个 Shell 的原生 PID 均已消失，`--active-only` 返回零项。前两次完整 CLI 查询超过测试夹具的 45 秒时限。后续复验中，完整 `cc tasks --json --active-only` 在 29.454 秒后返回两项 `running`，独立命令入口另外完成 6 次查询，两项任务并发 126 秒并确认回收。
- 用候选归档在 Windows 和经严格 SSH 连接的 Linux 容器中各运行两个真实 Shell。四项任务重叠 121.246 秒。Windows 使用完整 CLI 查询 7 次，Linux 使用完整 CLI 读回两项 `running`，另通过独立命令入口查询 6 次。两边的查询各自读到本地环境中的两个任务。两边均确认先停止一项时另一项继续运行，最后原生 PID 均已回收，活跃列表归零。
- 使用 `AgentScheduleStore.scheduleWakeup` 创建独立测试任务，让到期时间早于计划执行时间。配置状态栏命令从 stdin 读取上下文的 `task.schedule_ends_at`。分别运行 `cc statusline preview --json`、`cc tasks --json` 和 `cc agenda run`。状态栏在到期前读到日期，调度进程随后持久化 `expired`，并从 `--active-only` 结果移除任务，清除状态栏预览的日期和停止路径。[Windows 命令输出截图](../implementation/evidence/task-lifecycle-20261123/windows-schedule-expiry.png) · [状态栏实现](../../../../packages/cli/src/lib/status-line.js)
- Windows 的两个实际 MCPClient 通过 HTTP 连接 Linux Docker 测试服务。第一个客户端发起关闭后释放第一个持有者，再保持最后一个持有者五分钟。两个会话每五秒各调用一次工具，其间均无提前断开。释放第一个客户端的最后一个持有者后，第二个客户端仍可调用。最终两个会话分别完成 61 和 62 次调用，服务端各收到一次 `DELETE`，无拒绝请求。[子代理持有回归入口](../../../../packages/cli/__tests__/integration/subagent-mcp-late-connection.test.js)
- 使用从安装归档部署的 CLI `0.166.162` 在 Windows ConPTY 中复验了默认状态栏。打开 REPL 后显示 `schedule ends` 和实际截止时间。到期后运行 `cc agenda run`，重启 REPL 时该提示消失。`cc tasks --json` 显示 `pending` 转为 `expired`，`stopPath` 清空，任务从 `--active-only` 移除，全程模型调用为 0。截图摘录了交互输出与独立进程读回的任务记录。Windows 交互审批回归也已通过。[Windows ConPTY 输出摘录](../implementation/evidence/task-lifecycle-20261123/windows-schedule-terminal.png)

### 阶段 D 的命令参考

- `cc agenda list --json` 在原有 `expiresAt`、`dueAt` 和 `nextAt` 上补齐 `endsAt`、`expiresAction` 与 `nextRunAt`。`cc tasks --json` 将已到期任务显示为 `expired`，最早可执行时间达到截止时，`nextRunAt` 为空。`cc loop --ends-at <timestamp>` 将截止时间保存在可恢复会话中，等待期间的 `loop_wait` 事件记录下次可执行时间。到期后停止派发新轮次。`cc lab ccron register-profile-v2 --ends-at <timestamp>` 为进程内 profile 设定截止时间。到期归档 profile、取消队列中的 tick，并保留在途 tick 的结算。使用独立临时工作区启动三个 CLI 子进程，已验证 `ccron` 到期、`loop` 保存和跨进程恢复。

- 文档站已补充任务投影与停止事件、headless 写盘失败和状态栏阈值。另补充插件与 MCP 安装回执、Runner 三段耗时、VS Code 分叉与工作流对照命令。[Agent](../../../../docs-site/docs/chainlesschain/cli-agent.md#任务状态与停止回执) · [插件](../../../../docs-site/docs/chainlesschain/cli-plugin.md#安装命令回执) · [MCP](../../../../docs-site/docs/chainlesschain/cli-mcp.md#add) · [Runner](../../../../docs-site/docs/chainlesschain/cli-status.md#执行位置-runner) · [IDE](../../../../docs-site/docs/chainlesschain/ide-plugin.md#从历史回复分叉并查看工作流)
- 已通过 CLI 命令清单和公开 IDE 能力清单校验。文档站结构检查覆盖 352 个文件。VitePress 本地构建生成 707 个 HTML 页面，其中五份修改后的命令参考均已核对渲染结果。
- 本轮更新 `agenda` 和 `loop` 参考页后，文档站结构检查和 VitePress 构建通过。已核对两个页面渲染的截止时间示例、JSON 字段和 `loop_wait` 事件。[Agenda](../../../../docs-site/docs/chainlesschain/cli-agenda.md) · [Loop](../../../../docs-site/docs/chainlesschain/cli-loop.md)
- 从候选 npm 归档安装后执行 `cc lab ccron register-profile-v2 --ends-at` 示例，JSON 返回 `archived`、`expired`、`retire` 和空的 `nextRunAt`。另一 CLI 进程的 profile 列表为空，与进程内生命周期一致。
- 公开 IDE 能力清单增加任务投影、状态栏上下文、安装命令回执、headless 持久化错误、Runner 启动时间和会话分叉的字段映射。校验器核对命令注册与指南路径，`cc tasks` 直接注册的命令入口也纳入核对。[能力清单](../../../cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json)
- `cc skill add --json` 已验证项目创建、全局创建、重复名称和无项目四条路径。成功回执返回技能位置，失败回执返回 `error.message` 和退出码 1。两者共用 `installCommand`，均未启动子进程。技能与插件回执的 13 项进程测试和 6 项能力清单测试通过。新增技能参考和状态栏字段也已在 707 页文档站构建中验证。

### 2026-11-23 续验

- 流式 headless 逐会话创建 `PlanModeManager`。批准时把档位、工具白名单和已批准事项摘要写入会话日志。单次 headless 续跑采用同一执行锁。新进程回归验证了档位恢复和事项结算，并验证显式档位冲突、快照篡改和快照丢失会拒绝启动。
- `cc status --json --runner-state <file>` 可读取执行位置 Runner 的接单、注册和首个会话租约获准时间及三段耗时。接单时间由调用方提供。已授权的 post-session hook 走 FIFO 并发队列，前一项失败后会释放槽位。实际远程目标进程启动时间和 provisioning 钩子仍需远程宿主提供证据。
- 用三个真实 Linux Docker 子进程验证了授权后的 post-session hook 队列。Runner 在排空三条租约后进入 `parked`，一个钩子运行、两个等待。每个容器都在临时文件系统中写入并读回自己的回执。首个钩子按测试预设以 7 退出，后两个按入队顺序执行并以 0 退出。重放已消费的授权会被拒绝，独立 CLI 进程从 Runner 状态重读了三段启动耗时。该验证使用本机 Docker，远程部署仍需单独验收。[Runner 实现](../../../../packages/cli/src/lib/execution-location-runner-lifecycle.js)
- Windows Runner 通过严格 SSH 连接独立的 Linux 容器目标，先验证固定主机密钥、Linux 进程 PID 和钩子文件摘要，再记录注册时间。错误主机密钥被拒绝。独立 CLI 读回接单至注册 1.973 秒、接单至首租约 2.083 秒、注册至首租约 0.110 秒。三条租约排空后，SSH 钩子按容量 1 排队，退出码为 `7, 0, 0`。每份回执从另一条 SSH 连接读回，已消费授权的重放被拒绝。该夹具覆盖真实 SSH 目标，生产远程供应环境仍待验收。[Runner 实现](../../../../packages/cli/src/lib/execution-location-runner-lifecycle.js)
- 使用候选 `bf05fdb4f8` 的 `cc agent --provider ollama --fallback-model qwen2:7b` 连接真实的本机 Ollama。首选的不存在模型返回 HTTP 404，备用模型返回 HTTP 200 并生成 `spawn_sub_agent` 工具调用。子代理直接用 `qwen2:7b` 完成一次真实推理，随后父任务继续完成，CLI 以 0 退出。回环代理只放行两个指定模型和一个委派工具，推理使用 2,048 token 上下文。无工具对照也成功完成模型回退。此处覆盖本机 Ollama 链路，内置压缩和外部供应商各有独立验收范围。
- 用候选 `bf05fdb4f8` 复验 Ollama 回退后的自动压缩。独立配置启用 `aggressive` 阈值，声明规划窗口为 4,096 token。首选模型返回 HTTP 404，`qwen2:7b` 返回真实只读工具调用。运行时跟踪确认压缩使用回退模型，估算上下文为 7,710 token，触发阈值为 1,638。常规 CLI 复验收到 `strategy=canonical` 和 `status=committed`，估算节省 7,535 token，最终退出 0。本次自动压缩通过本地规则完成。另用显式会话验证了严格计量负向路径，首选模型的 404 直接返回给调用方，CLI 退出 5。
- 单独调用内置语义压缩组件，将真实 Ollama 回退结果中的模型和端点传给摘要请求。该请求使用相同的 `qwen2:7b`，工具目录为空，Ollama 返回 HTTP 200。普通 JSON 模式返回了不合规的 `objective`，组件保留用量并降级为 `extractive-fallback`。回环夹具用 Ollama 的 JSON Schema 输出重跑后，组件接纳 `llm-structured`，读回 213 个输入 token 和 223 个输出 token。该次验证直接调用压缩组件，JSON Schema 由测试代理传递。[语义压缩组件](../../../../packages/cli/src/harness/provider-backed-compaction.js) · [Ollama 结构化输出](https://docs.ollama.com/capabilities/structured-outputs)
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

| 当前发布候选                             | 实际状态                          | 正在验证的精确源码与作业                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI `0.166.162`                          | 新候选在验证中                    | `7107396e197719b0c709393f7e14f9d964215fa3` 包含状态栏阈值修复。源码审计覆盖 88 个文件，30 项状态栏单元测试通过。五项发布验证已绑定同一提交。[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45251759378) · [严格沙箱](https://github.com/longfa/chainlesschain/actions/runs/45251759303) · [原生验证](https://github.com/longfa/chainlesschain/actions/runs/45251782460) · [后台会话](https://github.com/longfa/chainlesschain/actions/runs/45251782946) · [macOS 启动器](https://github.com/longfa/chainlesschain/actions/runs/45251759701) |
| Open VSX `0.37.197`、JetBrains `0.4.212` | 主分支 IDE 工作流通过，ARM64 待验 | `009e5f3a3cfb65e4210b59725887071206766c7d` 的 IDE Extensions 18 个作业全部通过，涵盖 VS Code、JetBrains 三平台 x64 宿主。当前 ARM64 矩阵的三个 macOS 作业仍在排队。三个已替换候选的旧矩阵只剩 macOS 排队项，已取消。发布仍需完成候选检查并确认 CLI `0.166.162` 的公网归档。[IDE 三平台](https://github.com/longfa/chainlesschain/actions/runs/45250998556) · [IDE ARM64](https://github.com/longfa/chainlesschain/actions/runs/45250998617)                                                                                                                 |

| 当前候选制品复核                   | 实际状态                                 | 已核对的结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI Linux 原生构建                 | x64、ARM64 通过                          | 对照 `7107396e19` 的 Git 树核对两份宿主报告。两种架构都运行版本和 `status --json`，并通过安装事务、更新应用及发布清单三套测试。[Linux x64](https://github.com/longfa/chainlesschain/actions/runs/45251782460/artifacts/14856943424) · [Linux ARM64](https://github.com/longfa/chainlesschain/actions/runs/45251782460/artifacts/14855069453)                                                                                                                                                                                                                                                                                                                                                                                              |
| CLI Linux、Windows 后台会话        | 每个平台 94 项通过                       | 核对 `7107396e19` 两个平台的宿主提交检查与四份报告。每个平台的 4 项后台重连与 90 项迁移契约测试全部通过。macOS 等待运行器。[Linux 报告](https://github.com/longfa/chainlesschain/actions/runs/45251782946/artifacts/14855403822) · [Windows 报告](https://github.com/longfa/chainlesschain/actions/runs/45251782946/artifacts/14857192980)                                                                                                                                                                                                                                                                                                                                                                                                |
| IDE 两份 VSIX                      | 188 个文件一致                           | `009e5f3a3c` 的 x64 和 ARM64 工作流分别生成 VSIX。两份归档通过身份与摘要校验，解包后全部 188 个文件逐字节一致。[x64 归档](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14857207943) · [ARM64 归档](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14856628358)                                                                                                                                                                                                                                                                                                                                                                                                                |
| IDE Linux ARM64 宿主               | 四个用例通过                             | 已重算 `009e5f3a3c` 四份宿主报告与 178 个文件的摘要。VS Code `1.147.0` 和 `1.85.2` 安装同一候选 VSIX，均通过双根、独立窗口和重启恢复。JetBrains `2024.2` 与 `2025.2` 各观测 100 次，P95 分别为 364 和 368 ms。[VS Code 报告](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14856943842) · [JetBrains 2024.2](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14855538087) · [JetBrains 2025.2](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14855094723)                                                                                                                                                                                         |
| CLI Linux 随包辅助程序             | CI 两种架构通过                          | 已重算 `7107396e19` 的两份 CI 测试归档摘要，确认与独立辅助程序制品逐字节一致。两种架构均在无编译器的断网容器中从归档运行，均回收两个进程，耗时约 123 和 124 ms。[x64 测试制品](https://github.com/longfa/chainlesschain/actions/runs/45251759378/artifacts/14856974049) · [ARM64 测试制品](https://github.com/longfa/chainlesschain/actions/runs/45251759378/artifacts/14857505513)                                                                                                                                                                                                                                                                                                                                                       |
| CLI 本地候选归档                   | 内容校验通过                             | `7107396e19` 的本地 `chainlesschain-0.166.162.tgz` SHA-256 为 `b0dbbaec46cc5b69317248037066bf60a543ff67cf51e8fb64ebb0c1278f940a`。已校验 CLI 版本、Web Panel、变更日志及两种本地辅助程序。Docker Desktop 首轮触发 8 秒总超时，复验时本地归档和 CI 归档中的 x64 辅助程序均在无编译器断网容器中通过，从进程就绪到完成回收均约 123 ms。                                                                                                                                                                                                                                                                                                                                                                                                      |
| VS Code Windows ARM64              | 两版宿主通过                             | `009e5f3a3c` 的稳定版 `1.147.0` 与最低版 `1.85.2` 已复核两份报告和 64 个文件。两次均安装同一候选 VSIX，验证了双根、多窗口、独立桥接令牌与重启恢复。[Windows ARM64 报告](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14857910309)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CLI Windows 原生构建               | x64、ARM64 通过                          | 对照 `7107396e19` 的 Git 树核对两份 Windows 宿主报告。两种架构均实际启动候选二进制，运行版本及 `status --json`，通过安装事务、更新应用和发布清单三套测试。[Windows x64](https://github.com/longfa/chainlesschain/actions/runs/45251782460/artifacts/14857397217) · [Windows ARM64](https://github.com/longfa/chainlesschain/actions/runs/45251782460/artifacts/14859250136)                                                                                                                                                                                                                                                                                                                                                               |
| IDE Windows 发布宿主               | VS Code x64 与 JetBrains x64、ARM64 通过 | `009e5f3a3c` 的 x64 VS Code 两版均安装同一候选 VSIX，双根、多窗口及重启恢复通过，已复核 68 个文件。x64 JetBrains `2024.2`、`2025.2` 各观测 100 次，P95 分别为 638 和 665 ms，复核 208 个文件及会话恢复与停止。ARM64 JetBrains `2026.2.0.1` 的 100 次观测 P95 为 1,052 ms，已复核 55 个文件。[VS Code](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14858630610) · [JetBrains 2024.2](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14856729088) · [JetBrains 2025.2](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14857825546) · [JetBrains ARM64](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14858745327)   |
| IDE 三平台浏览器                   | 汇总复核通过                             | 在精确检出 `009e5f3a3c` 上复跑 Linux、macOS、Windows 三份证据的汇总，覆盖 21 个文件，输出与 CI 制品逐字节一致。[三平台汇总](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14858201818)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| CLI 严格沙箱                       | Linux、Windows、macOS 边界通过           | `7107396e19` 的 Linux x64、ARM64、Windows 分别通过 2,847、57、2,872 条。macOS ARM64 使用 Node `22.12.0`，边界、后台监督、安全映射分别通过 2,806、23、29 条。四个平台均为零失败。已复核 macOS 四份制品和 27 个源码摘要。原生能力首轮因容量取消，第二轮单独补跑。[Linux x64](https://github.com/longfa/chainlesschain/actions/runs/45251759303/artifacts/14858160333) · [Linux ARM64](https://github.com/longfa/chainlesschain/actions/runs/45251759303/artifacts/14856604290) · [Windows](https://github.com/longfa/chainlesschain/actions/runs/45251759303/artifacts/14858541152) · [macOS ARM64 制品](https://github.com/longfa/chainlesschain/actions/runs/45251759303/artifacts/14860489188)                                           |
| CLI macOS MCP 启动器               | 发布候选 x64 通过，ARM64 排队            | `7107396e19` 的 macOS Intel 已通过平台原语、编译告警及共享源码、打包资源、Broker 契约。此前旧候选仅剩 ARM64 等待分配宿主，已取消旧轮。当前候选 ARM64 仍在队列。[当前 x64 作业](https://github.com/longfa/chainlesschain/actions/runs/45251759701/job/137980335441) · [当前 ARM64 作业](https://github.com/longfa/chainlesschain/actions/runs/45251759701/job/137980336049)                                                                                                                                                                                                                                                                                                                                                                |
| IDE Linux x64 与 macOS Intel       | 三个 JetBrains 宿主通过                  | `009e5f3a3c` 的 Linux `2024.2`、`2025.2` 和 macOS Intel `2024.2` 各完成 100 次观测，P95 分别为 362、364、1,274 ms。已复核六份报告、312 个文件及独立会话恢复与停止。macOS Intel `2025.2` 的结果见本表独立记录。[Linux 2024.2](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14858970994) · [Linux 2025.2](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859490484) · [macOS 2024.2](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859355309)                                                                                                                                                                                                 |
| IDE 受控 Remote-SSH 容器           | 主分支门禁通过                           | `009e5f3a3c` 的 VSIX 已在真实 SSH 容器扩展宿主中验证双根工作区。复核 40 个文件，两份来源信封身份与摘要均通过，重算的范围汇总与 CI 制品逐字节一致。`releaseReady=true` 覆盖受控容器用例。[宿主证据](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14855624674) · [CI 汇总](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14858761037)                                                                                                                                                                                                                                                                                                                                          |
| CLI CI 原生 PDH                    | Linux 和 Windows 通过                    | `7107396e19` 的源码审计及 Linux、Windows x64 PDH 作业通过。两份宿主报告各通过 4,485 项，失败为 0，报告另记 125 项跳过。已核对提交、Node ABI、PDH `0.4.66` 和两种实际驱动的版本。首轮 macOS PDH 因托管运行器容量不足，在启动前取消，依赖该作业的三平台矩阵未完成。第二轮在同一提交补跑 macOS PDH 及受影响的作业。[源码审计](https://github.com/longfa/chainlesschain/actions/runs/45251759378/job/137968418296) · [Linux 报告](https://github.com/longfa/chainlesschain/actions/runs/45251759378/artifacts/14858935333) · [Windows 报告](https://github.com/longfa/chainlesschain/actions/runs/45251759378/artifacts/14857496137) · [第二轮 macOS PDH](https://github.com/longfa/chainlesschain/actions/runs/45251759378/job/138012738389) |
| IDE JetBrains macOS Intel `2025.2` | 已复核宿主通过                           | `009e5f3a3c` 的 100 次等待输入观测均低于 2,000 ms，P95 为 1,007 ms，最大 1,089 ms。已复核两份报告、104 个文件，会话恢复与停止通过。提交至接受、后台排队、前置校验、CLI 动作、动作返回至界面可见的 P95 分别为 230、2、240、182、496 ms。[宿主报告](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859111966)                                                                                                                                                                                                                                                                                                                                                                                                |
| VS Code x64 宿主                   | 三平台两版通过                           | `009e5f3a3c` 的 Linux、Windows、macOS Intel 各通过 `1.147.0` 和 `1.85.2`。已复核六份报告及 212 个文件，三平台安装同一份候选 VSIX，验证双根、独立窗口和重启恢复。[Linux 制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14860100685) · [Windows 制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14858630610) · [macOS 制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859263412)                                                                                                                                                                                                                                                   |
| JetBrains `0.4.212` 打包           | 主分支候选通过                           | `009e5f3a3c` 已通过单元测试、构建和兼容性验证。核对 ZIP 内插件 ID `com.chainlesschain.ide`、版本 `0.4.212`、推荐 CLI `0.166.162` 和 SHA-256 `31b248698ac107149bf7a655c56019a8d316c45561c9a51f52bf903407daafac`。[打包制品](https://github.com/longfa/chainlesschain/actions/runs/45250998556/artifacts/14859787870)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CLI macOS Intel 原生构建           | 匹配宿主通过                             | 已核对 `7107396e19` 的 Git 树和候选版本 `0.166.162`。Intel 宿主运行版本及 `status --json`，通过安装事务、更新应用和发布清单三套测试。原生验证已覆盖五个目标。首轮 macOS ARM64 因托管运行器容量不足，在启动前取消。同一提交的第二轮复用五个成功作业，macOS ARM64 重新排队，六目标汇总待验。[macOS x64 报告](https://github.com/longfa/chainlesschain/actions/runs/45251782460/artifacts/14860710849) · [首轮容量记录](https://github.com/longfa/chainlesschain/actions/runs/45251782460/job/137963045082) · [第二轮 ARM64](https://github.com/longfa/chainlesschain/actions/runs/45251782460/job/138007312415)                                                                                                                             |
| CLI Windows 安装包执行验收         | 9 项通过                                 | 从 `7107396e19` 归档隔离安装后，回执套件通过 5 项，覆盖 Git 子进程、MCP 注册及插件添加和升级。无人应答保护通过 4 项，覆盖普通 JSON、无人值守 JSON、流式 Schema 及双工后续安全消息。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| CLI Windows 方案回归               | 最近三轮均为 134 / 134 项通过            | `7107396e19` 的 11 套测试使用两个 worker。Runner 读取用例走正式 `cc` 入口。真实 HTTP MCP 延迟连接在前两轮返回 `outcome_unknown`，随后原版用例及两种诊断复跑均通过。最新轨迹中工具列表完成到派发相隔约 5.5 秒，服务器只收到一次 `tools/call`，返回 HTTP 200，账本为 `completed`。两次早期失败原因待定位。                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CLI Linux 候选归档 MCP 回归        | 16 / 16 项通过                           | 将 `7107396e19` 的候选归档解包到隔离路径，核对 Agent、MCP 客户端和调用账本文件后运行原版套件。覆盖真实 HTTP 初始化、工具列表和单次派发，以及目录撤销、终止与共享会话释放。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

- 调度候选提交 `1d5ea8f72550330bd91bd962df14be353e59fd16` 包含三个调度入口的截止时间与下次运行字段。CLI、Open VSX 和 JetBrains 版本分别为 `0.166.162`、`0.37.197` 和 `0.4.212`。两款插件推荐 CLI `0.166.162`。[候选源码](https://github.com/longfa/chainlesschain/commit/1d5ea8f72550330bd91bd962df14be353e59fd16)

调度实现提交 `8edf2ce503` 的 CLI CI 在源码身份核验时报告 `agenda.js` 审计摘要过期。已比对源码和网络调用后刷新摘要。本地复核覆盖 88 个文件，31 项审计测试通过。全套发布作业已重新绑定调度候选。[原校验结果](https://github.com/longfa/chainlesschain/actions/runs/45223310954/job/137863545420)

| 调度候选验证记录                         | 实际状态                   | 证据与剩余条件                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13 个上游 npm 包                         | 公网归档已复核             | 按候选提交的版本从 npm registry 下载全部归档，验证 SHA-512 与归档内名称、版本。候选 CLI 的 10 条直接内部依赖对齐，连同上游包共检查 15 条内部依赖约束。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| CLI CI 与 CLI Strict Sandbox             | 两套矩阵均已重跑           | CLI CI 首轮源码审计及 Linux、Windows PDH 通过，macOS PDH 未分配到运行器便取消。第二轮已通过六个作业，macOS PDH 等待运行器。严格沙箱首轮 Linux 两种架构及 Windows 边界作业通过，两个 macOS 作业因托管运行器容量不足而取消。已在同一候选提交启动严格沙箱第二轮完整矩阵。[CLI CI 第二轮](https://github.com/longfa/chainlesschain/actions/runs/45225011599/attempts/2) · [严格沙箱第二轮](https://github.com/longfa/chainlesschain/actions/runs/45225095992/attempts/2) · [macOS 原生能力](https://github.com/longfa/chainlesschain/actions/runs/45225095992/job/137877327594) · [macOS 原生边界](https://github.com/longfa/chainlesschain/actions/runs/45225095992/job/137877327760) |
| CLI 原生构建                             | 5 个目标通过               | Linux 和 Windows 两种架构以及 macOS x64 通过。已复核 macOS x64 的实际宿主运行与安装更新制品。macOS ARM64 首轮未获宿主便取消，同一提交的第二轮等待宿主。[原生验证](https://github.com/longfa/chainlesschain/actions/runs/45225096629/attempts/2) · [macOS ARM64 重跑](https://github.com/longfa/chainlesschain/actions/runs/45225096629/job/137947914640)                                                                                                                                                                                                                                                                                                                           |
| CLI 后台会话交互                         | Linux、Windows 通过        | 已复核候选提交两平台的报告。每个平台通过 4 项真实 worker 断开与重连测试及 90 项远程控制迁移契约测试。macOS 首轮因托管宿主容量不足未启动，第二轮在同一候选提交上排队。[Linux 报告](https://github.com/longfa/chainlesschain/actions/runs/45225095842/artifacts/14845136347) · [Windows 报告](https://github.com/longfa/chainlesschain/actions/runs/45225095842/artifacts/14843201675) · [macOS 重跑](https://github.com/longfa/chainlesschain/actions/runs/45225095842/job/137942313239)                                                                                                                                                                                            |
| macOS MCP 启动器                         | x64 通过，ARM64 第三轮排队 | macOS Intel 第二轮通过编译警告门禁、平台原语和契约测试。ARM64 前两轮均因托管运行器容量不足，在分配前取消，未执行测试。已在同一候选提交定向重跑 ARM64 第三轮。[x64 作业](https://github.com/longfa/chainlesschain/actions/runs/45225011304/job/137923249360) · [ARM64 第二轮取消](https://github.com/longfa/chainlesschain/actions/runs/45225011304/job/137923244393) · [ARM64 第三轮](https://github.com/longfa/chainlesschain/actions/runs/45225011304/job/137955865593)                                                                                                                                                                                                          |
| IDE 浏览器验证                           | 三个平台通过               | Linux、Windows 和 macOS Intel 的浏览器验证通过。macOS 完成真实 CLI 持久化、双来源浏览器操作与回放验证。已下载三平台制品并复跑汇总，结果与 CI 制品逐字节一致。[macOS 作业](https://github.com/longfa/chainlesschain/actions/runs/45225095657/job/137877503573) · [三平台汇总制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14847549456)                                                                                                                                                                                                                                                                                                          |
| VS Code Remote-SSH 容器                  | 双根工作区通过             | 候选 VSIX `0.37.197` 在 Linux 容器的远程扩展宿主中安装并激活。已重算 40 个制品文件的摘要，重跑汇总与 CI 输出逐字节一致。改动一份制品后，摘要校验按预期拒绝。此次为手动验证，发布标签仍需通过正式门禁。[宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14846277316) · [汇总制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14847232526)                                                                                                                                                                                                                                                                    |
| VS Code x64 宿主                         | 三平台两版本通过           | 已复核 Windows、Linux 和 macOS Intel 的六份报告及 212 个文件。三平台都用同一候选 VSIX，在稳定版 `1.147.0` 和最低版 `1.85.2` 通过双根、多窗口、重启恢复。[Windows 制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14845304557) · [Linux 制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14849219410) · [macOS 制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14850961032)                                                                                                                                                                                                    |
| IDE 宿主与 ARM64                         | JetBrains 2025.2 未通过    | IDE Extensions 通过 16 个作业。JetBrains Intel `2025.2` 未达到等待输入门槛，会话恢复与停止未运行。独立 IDE ARM64 矩阵通过 7 个作业，macOS ARM64 仍在排队。[JetBrains 2025.2 作业](https://github.com/longfa/chainlesschain/actions/runs/45225095657/job/137877503657) · [IDE ARM64](https://github.com/longfa/chainlesschain/actions/runs/45225095722)                                                                                                                                                                                                                                                                                                                             |
| CLI 候选 npm 归档                        | Windows、Linux 本地通过    | 隔离 Windows 安装通过六次调度 CLI 调用。Linux 从同一归档安装，八套调度测试共 319 项通过，含 POSIX 目录 `fsync` 故障恢复用例。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 桌面端综合测试                           | Linux、Windows 复验通过    | 首轮 5 项失败来自 `llm:lk-models` 的旧注册断言。修复提交 `fe0ead3eda` 的两平台主报告各通过单元、集成、性能、数据库和 UKey 五套测试，退出码均为 0。[Linux 报告](https://github.com/longfa/chainlesschain/actions/runs/45241167244/artifacts/14853286014) · [Windows 报告](https://github.com/longfa/chainlesschain/actions/runs/45241167244/artifacts/14852134832)                                                                                                                                                                                                                                                                                                                  |
| CLI `0.166.162`                          | 待发布                     | 待候选门禁全部通过后由 GitHub Actions OIDC 发布并验证公网归档。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Open VSX `0.37.197`、JetBrains `0.4.212` | 待发布                     | 待 IDE 门禁和 CLI 公网归档验证。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

本地 `chainlesschain-0.166.162.tgz` SHA-256 为 `d25a8c7f28a9dafd5782e91a339926e2df47539f1077d09d8bb037c43e9e8b48`。已验证归档清单中的候选提交、Web Panel 静态资源和两个 Linux 辅助程序。隔离前缀安装后重建 SQLite 原生依赖，六个调度源码文件与候选逐字节一致，`agenda`、`tasks`、`lab ccron` 和 `loop` 保存及恢复共六次子进程调用通过。 Linux x64 容器以 Node.js `22.20.0` 安装相同归档并校验六个调度源文件。八套测试 319 项全部通过，包含 Windows 平台跳过的目录 `fsync` 故障恢复用例。

此前在候选提交下复核了 15 份 IDE 宿主报告及 671 个证据文件。VS Code `1.85.2` 和 `1.147.0` 在 Windows x64、Windows ARM64、Linux ARM64 的六次真实 DOM 双根工作区旅程通过。JetBrains 复核了 Linux x64 `2024.2`、`2025.2`，Windows x64 `2024.2`、`2025.2` 与 Windows ARM64 `2026.2.0.1` 的宿主证据。另已复核此前 Linux ARM64 的两份 JetBrains 报告。两个工作流分别生成 VSIX，均通过其归档摘要及同一候选提交校验，解包后 188 个文件逐字节一致。[VS Code Windows 宿主](https://github.com/longfa/chainlesschain/actions/runs/45225095657/job/137878502621) · [JetBrains Windows ARM64](https://github.com/longfa/chainlesschain/actions/runs/45225095722/job/137877208433)

按派发顺序对齐四个宿主各 100 次界面观测及 CLI 轨迹。同一 `daemon resume` 进程的启动和输出按进程实例 ID 匹配。各列为独立计算的 P95。

| JetBrains 宿主       | 提交到界面可见 | 提交到 CLI 启动 | CLI 夹具启动到输出 | CLI 输出到界面可见 | 制品                                                                                                |
| -------------------- | -------------: | --------------: | -----------------: | -----------------: | --------------------------------------------------------------------------------------------------- |
| macOS Intel `2025.2` |       2,168 ms |        1,499 ms |               7 ms |             768 ms | [宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14852106933) |
| macOS Intel `2024.2` |       1,283 ms |          765 ms |               3 ms |             583 ms | [宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14849762950) |
| Windows `2025.2`     |         428 ms |          258 ms |               1 ms |             199 ms | [宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14847303207) |
| Linux `2025.2`       |         357 ms |          173 ms |               1 ms |             192 ms | [宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45225095657/artifacts/14845369179) |

macOS Intel `2025.2` 的 8 个超限样本都在 `daemon resume` 启动前耗时超过 1 秒。启动前阶段包含界面提交、排队和前置读取，当前复验采集各自耗时。验收沿用 100 次观测和 P95 小于 2,000 ms 的门槛。

已在 JetBrains 宿主诊断记录对话框接受时间、后台线程排队、前置校验和 CLI 动作耗时。记录只在现有宿主诊断模式启用，并在安排界面更新后写入。Windows JDK 21 的 Gradle 编译、插件打包及单元测试通过，共 1,043 项通过、3 项跳过。提交 `4c7e14ad45` 的三平台 IDE 宿主复验已启动，macOS Intel `2025.2` 的复验结果见下表。[分段计时实现](../../../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/SessionsWorkbenchToolWindowFactory.java) · [宿主复验](https://github.com/longfa/chainlesschain/actions/runs/45244831397/job/137939069339)

| 分段计时复验                   | 实际状态       | 核对结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linux JetBrains `2025.2`       | 宿主通过       | 已核对 `4c7e14ad45` 的两份宿主报告与 104 个文件。100 次观测均与分段计时匹配，端到端 P95 为 360 ms。提交至接受、后台排队、前置校验、CLI 动作和动作返回至界面可见的 P95 分别为 75、0、49、38、203 ms。[Linux 宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14853363340)                                                                                                                                                                                                                                                                                                                   |
| Linux JetBrains `2024.2`       | 宿主通过       | 已复核两份报告与 104 个文件。100 次观测均与分段计时匹配，端到端 P95 为 366 ms。提交至接受、后台排队、前置校验、CLI 动作和动作返回至界面可见的 P95 分别为 79、0、65、64、189 ms。[Linux 宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14854860125)                                                                                                                                                                                                                                                                                                                                       |
| Windows JetBrains `2024.2`     | 宿主通过       | 已复核两份报告与 104 个文件。100 次观测均与分段计时匹配，端到端 P95 为 648 ms。提交至接受、后台排队、前置校验、CLI 动作和动作返回至界面可见的 P95 分别为 91、1、117、109、357 ms。[Windows 宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14853778180)                                                                                                                                                                                                                                                                                                                                   |
| Windows JetBrains `2025.2`     | 宿主通过       | 已复核两份报告与 104 个文件。100 次观测均与分段计时匹配，端到端 P95 为 632 ms。提交至接受、后台排队、前置校验、CLI 动作和动作返回至界面可见的 P95 分别为 87、1、120、90、356 ms。[Windows 宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14854428159)                                                                                                                                                                                                                                                                                                                                    |
| macOS Intel JetBrains `2025.2` | 宿主通过       | 分段诊断提交 `4c7e14ad45` 的两份报告和 104 个文件已复核。100 次端到端观测 P95 为 1,635 ms，最大 1,868 ms，全部低于 2,000 ms。提交至接受、后台排队、前置校验、CLI 动作和动作返回至界面可见的 P95 分别为 246、4、437、351、606 ms。聊天、控制、独立会话恢复和停止验证均通过。[macOS 宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14855470854)                                                                                                                                                                                                                                            |
| macOS Intel JetBrains `2024.2` | 宿主通过       | 已复核 `4c7e14ad45` 的两份报告和 104 个文件。100 次端到端观测的 P95 为 1,589 ms，最大 2,090 ms，有 1 次达到或超过 2,000 ms。提交至接受、后台排队、前置校验、CLI 动作和动作返回至界面可见的 P95 分别为 242、3、459、395、635 ms。聊天、控制、独立会话恢复和停止验证均通过。[macOS 宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14856368841)                                                                                                                                                                                                                                             |
| VS Code x64 宿主               | 三平台通过     | `4c7e14ad45` 的 Windows、Linux、macOS Intel 稳定版 `1.147.0` 与最低版 `1.85.2` 均通过。已核对六份报告和 212 个文件，确认安装同一份候选 VSIX，并验证双根工作区、独立窗口与重启恢复。[Windows 制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14852773292) · [Linux 制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14852944846) · [macOS 制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14854284267)                                                                                                                      |
| VS Code Remote-SSH 容器        | 双根工作区通过 | 同一提交的 VSIX 在受控 Linux 容器远程宿主通过。已重算 40 个文件的摘要，汇总与 CI 制品逐字节一致。该次为手动复验，发布标签仍需正式门禁。[宿主制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14853491682) · [汇总制品](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14853626811)                                                                                                                                                                                                                                                                                |
| IDE ARM64 制品身份             | 修复归档已核对 | 手动复验 `45250079280` 的检出目标是 `4c7e14ad45`，清单却记录派发时的 `fdb2b593ec`。旧作业余下三个尚未分配宿主的任务已取消。修复 `009e5f3a3c` 统一检出、清单生成和校验使用的 SHA。已下载修复提交的新 VSIX，复核清单的完整提交、工作流、版本 `0.37.197` 和两个归档摘要。16 项工作流测试与 17 项归档自检通过，三平台宿主结果待验。[原始清单](https://github.com/longfa/chainlesschain/actions/runs/45250079280/artifacts/14856536554) · [修复后 VSIX](https://github.com/longfa/chainlesschain/actions/runs/45250998617/artifacts/14856628358) · [ARM64 新矩阵](https://github.com/longfa/chainlesschain/actions/runs/45250998617) |
| 浏览器证据                     | 三平台通过     | 下载 `4c7e14ad45` 的 Linux、Windows、macOS 制品。复跑汇总校验覆盖 21 个文件，输出与 CI 汇总逐字节一致。[三平台汇总](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14853642609)                                                                                                                                                                                                                                                                                                                                                                                                                    |
| JetBrains 诊断构建             | 18 个作业通过  | `4c7e14ad45` 诊断工作流完成纯逻辑测试、JUnit、打包与兼容性验证。已读取 ZIP 内插件描述符，版本为 `0.4.212`，推荐 CLI `0.166.162`。工作流按手动验证运行，商店上传步骤跳过。[诊断工作流](https://github.com/longfa/chainlesschain/actions/runs/45244831397) · [诊断 ZIP](https://github.com/longfa/chainlesschain/actions/runs/45244831397/artifacts/14859220409)                                                                                                                                                                                                                                                                  |

#### 补齐调度字段前的发布验证

- 补齐调度字段前的候选 `bf05fdb4f827926db991d5baf1867ca44596e6aa` 修复了后台 Shell 心跳，包含 `89e7bc37cd` 补齐的技能回执和公开能力清单。CLI、Open VSX 和 JetBrains 版本分别为 `0.166.162`、`0.37.197` 和 `0.4.212`。两款插件的推荐 CLI 都是 `0.166.162`。三个候选版本尚未上架。[候选源码](https://github.com/longfa/chainlesschain/commit/bf05fdb4f827926db991d5baf1867ca44596e6aa)

下表记录补齐调度字段前的候选证据。

| 发布相关项目                             | 实际状态                | 证据与剩余条件                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13 个上游 npm 包                         | 公开归档已核验          | 固定版本和公开归档完整性已验证，发布工作流仍将核对归档与签名来源。                                                                                                                                                                                                                                                                                              |
| CLI CI                                   | 等待 macOS              | Linux 与 Windows 的 PDH 前置作业已通过。macOS PDH 仍在排队，完整矩阵尚未结束。[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45200158257)                                                                                                                                                                                                       |
| CLI Strict Sandbox                       | 第 2 轮 macOS 排队      | 首轮 Linux、Windows 及 macOS 的严格原生边界作业均通过。macOS 原生能力作业未获分配 ARM64 宿主，执行步骤为 0。已在同一候选提交重跑该作业。[首轮取消记录](https://github.com/longfa/chainlesschain/actions/runs/45200158007/job/137782329489) · [第 2 轮](https://github.com/longfa/chainlesschain/actions/runs/45200158007/attempts/2)                            |
| CLI 原生构建                             | 5 个目标通过            | Linux 和 Windows 两种架构均通过。macOS x64 已通过构建、实际宿主执行和三组安装、更新与清单回归，已核对制品记录的候选提交与架构。macOS ARM64 仍在排队。[macOS x64 作业](https://github.com/longfa/chainlesschain/actions/runs/45200225404/job/137781475352) · [验证制品](https://github.com/longfa/chainlesschain/actions/runs/45200225404/artifacts/14839260168) |
| IDE 宿主与 ARM64                         | Linux、Windows 作业通过 | 候选提交的 macOS Intel JetBrains 2024.2 宿主验证已开始运行。其余 macOS IDE 宿主作业仍在排队。[JetBrains 2024.2 作业](https://github.com/longfa/chainlesschain/actions/runs/45200224843/job/137781964307) · [IDE ARM64](https://github.com/longfa/chainlesschain/actions/runs/45200222588)                                                                       |
| CLI 后台会话交互                         | 第 3 轮 macOS 排队      | Linux 和 Windows 已通过。前两轮 macOS 均未获得宿主，执行步骤为 0。GitHub 标注 ARM64 宿主容量不足。已在同一候选提交重跑 macOS 作业。[第 2 轮取消记录](https://github.com/longfa/chainlesschain/actions/runs/45200158090/job/137824225239) · [第 3 轮](https://github.com/longfa/chainlesschain/actions/runs/45200158090/attempts/3)                              |
| macOS MCP 启动器                         | 等待 macOS              | 当次候选的 x64 和 ARM64 unsigned contract 仍在排队。[启动器验证](https://github.com/longfa/chainlesschain/actions/runs/45200157804)                                                                                                                                                                                                                             |
| CLI `0.166.162`                          | 待发布                  | 等待同一候选的完整门禁，通过后用 GitHub Actions OIDC 发布并验证公网归档。                                                                                                                                                                                                                                                                                       |
| Open VSX `0.37.197`、JetBrains `0.4.212` | 待发布                  | 等待 IDE 门禁和 CLI 公网归档验证。[Open VSX](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) · [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32208)                                                                                                                                                                            |

- 13 个上游 npm 包沿用已发布版本。已按 npm 的完整性字段下载并校验所有归档，CLI 直接依赖与仓库固定版本相同。OIDC 发布工作流还会比较候选和公开子包归档，并核验签名来源。
- Windows VS Code 1.145.2 安装 `0.37.197` 候选 VSIX 后复跑了两条会话分叉、各自的文件写入账本及运行中工作流地图对照。候选命令清单、帮助索引、补全、IDE 能力清单和 Marketplace 元数据检查已通过。复审 `agent-core.js` 相对上一发布标签的差异后更新了模型出站审查摘要，88 个源码文件和脚本通过预检。
- Linux x64 的 12 项 CLI 进程回归通过，覆盖交互审批恢复、后台进程回收、插件安装回执与无人应答拒绝。Windows 通过 `openSync(path, "r")` 将只读文件句柄传给子进程 stdout。正常输出对照成功，单次 JSON 与流式 NDJSON 写入均报告 `EBADF` 并退出 1。
- Windows 使用真实 Git HTTPS transport，向临时回环代理发起 CONNECT。代理返回 502 时，`cc plugin add --json` 退出 1，Git 回执退出码 128。代理保持连接但不回应时，Git 在约 120 秒后被终止，CLI 退出 1，回执包含 `timedOut: true`、`signaled: true`、`exitCode: null` 和 stderr 摘要。两次均使用测试域名，代理未转发请求。
- 从隔离项目运行 `cc plugin add https://github.com/octocat/Hello-World.git --json`，实际 Git HTTPS 获取成功，回执记录 `ran: true` 和 `exitCode: 0`。仓库缺少插件制品，CLI 以 1 退出并返回 `CC_PLUGIN_INSTALL_FAILED`，同一响应保留底层 Git 回执。
- 上一候选 `5321e5338e` 在 Windows 本地构建并打包。隔离目录安装该归档后，`cc --version` 输出 `0.166.162`，Web Panel 构建资源随包交付，10 个 CLI 直接依赖的内部 npm 包均解析到公开 npm 上的固定版本。候选 VS Code 扩展的 359 项 Node 测试全部通过。
- 从新候选 `89e7bc37cd` 重新构建 Web Panel 并打包 CLI。隔离目录通过 `npm install --ignore-scripts` 安装本地归档后，核对了 `cc --version`、`cc tasks --json` 和 `cc skill add --json`。安装后的技能回执字段与包内能力清单一致。候选的文档站渲染门禁已通过。[Docs-Site Build Gate](https://github.com/longfa/chainlesschain/actions/runs/45191381292)
- 从当前候选 `bf05fdb4f8` 重建了 Web Panel 和变更日志并重新打包。隔离安装后输出版本 `0.166.162`，归档包含 253 个 Web Panel 资源，两处修复文件的 SHA-256 与候选源码一致，10 个直接内部依赖解析到固定的公开版本。用安装后 CLI 复测两个后台 Shell，121 秒内及停止过程中 7 次独立查询均符合预期。
- Linux x64 容器内使用 Xvfb 启动通过官方 SHA-256 校验的 VS Code 1.145.2。真实宿主安装扩展 `0.37.197` 后完成分叉测试。进程退出 0，两条会话的历史和副作用账本独立，运行中的 Cowork 工作流在 IDE 与 CLI 投影一致。另有 41 项本地发布归档、精确提交门禁及来源验证测试通过。[原生宿主测试入口](../../../../packages/vscode-extension/test/extension-host/run-session-fork.cjs)
- 上一提交的 IDE 预检发现 JetBrains 兼容性章节中的安装命令仍引用上一 CLI 版本。修正示例后，JetBrains 发布元数据、VS Code Marketplace 元数据、公开能力清单、路线图 fixture 校验和 14 项 CLI 依赖门禁测试均在本地通过。[上一轮 IDE 预检](https://github.com/longfa/chainlesschain/actions/runs/45181512001/job/137716210861)
- 验证已按 `bf05fdb4f8` 发起。全部适用门禁通过后，先发布 CLI 并核对公开 npm 归档和来源，再发布并核对两款 IDE 插件。[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45200158257) · [严格沙箱](https://github.com/longfa/chainlesschain/actions/runs/45200158007) · [原生构建](https://github.com/longfa/chainlesschain/actions/runs/45200225404) · [IDE Extensions](https://github.com/longfa/chainlesschain/actions/runs/45200224843) · [IDE ARM64](https://github.com/longfa/chainlesschain/actions/runs/45200222588)
- 同一提交已触发进程所有权恢复、后台会话交互和 macOS MCP 启动器验证。[进程所有权](https://github.com/longfa/chainlesschain/actions/runs/45200157513) · [后台交互](https://github.com/longfa/chainlesschain/actions/runs/45200158090) · [macOS MCP 启动器](https://github.com/longfa/chainlesschain/actions/runs/45200157804)
- 运行时源码提交 `73286530a5507cf311e165d132399f85f6238d0b` 已通过本地 Linux、Windows、WSL、容器和严格 SSH 的执行位置验证。首轮下载五份制品后用仓库验证器复核了来源、文件摘要、进程生命周期和每个位置 100 次轨迹，共 500 次。前三轮的 macOS 作业均在未获分配宿主、未执行步骤的情况下被取消。第三轮再次独立复核五份制品的 500 次轨迹，汇总以 `LOCAL_RESULT: abandoned` 失败。GitHub 给出 ARM64 宿主容量提示，已完整重跑第四轮。[第四轮结果](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/4) · [首轮结果](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/1) · [第二轮结果](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/2) · [第三轮完整重跑](https://github.com/longfa/chainlesschain/actions/runs/45179047694/attempts/3)

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

继续实施后的改动仍需在新提交上通过相应发布矩阵。Codex 冷首次扫描继续使用 `recency_at + useStateDbOnly`，HOLD 保持。

### Codex 0.171.0 冷首次扫描续验

- 使用官方 npm `0.171.0` 二进制在 Windows 和 Linux 各生成协议 Schema，并据此验证请求和响应。两个时间点不同的合成 rollout 在两端各六个未索引目录均于首次扫描完整分页，`limit: 1` 时首屏游标可继续读取第二屏。[Codex 0.171.0 发布](https://github.com/openai/codex/releases/tag/rust-v0.171.0) · [上游 rollout 测试夹具](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/app-server/tests/common/rollout.rs)
- 用仓库历史探针生成两条真实会话，模型响应来自专用回环夹具。Windows 的独立升序和降序冷目录首次均完整翻了两页，方向顺序互反。Linux 的三个独立复验也都能完整翻两页，但两个方向返回同一顺序，`cold-direction-order` 检查失败。随后用完全相同的文件时间和会话时间重测，两端各六次均能翻全两页，升序和降序均按同一顺序返回。[仓库历史探针](../../../../packages/cli/scripts/codex-app-server-history-probe.mjs)

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

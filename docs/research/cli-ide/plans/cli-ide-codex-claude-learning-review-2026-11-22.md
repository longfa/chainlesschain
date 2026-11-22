# ChainlessChain 借鉴最新 Codex / Claude Code 的产品与工程实施方案（2026-11-22）

审核日期：2026-11-22。本文接续[2026-11-20 学习清单](./cli-ide-codex-claude-learning-review-2026-11-20.md)。11-20 版本判定 8 个工程任务包已完成；本轮不再重复"是否已有入口"，而是逐条把上游最新版本的**具体修复**映射到本仓库文件级证据上，区分"已具备""确有缺口""待核对"，并按可执行顺序给出实施方案。

结论以本节列出的源码路径、命令输出和官方 changelog 为准；未取到证据的项目显式标注，不按通过处理。

## 结论摘要

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

版本是上游工具版本，不能与仓库 CLI `0.166.159` 按数字比较。仓库自身的准确发布身份见下方"当前公开版本"。

## 值得借鉴的机制与本仓库证据

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

## 当前公开版本与既有边界（沿用 11-21 回执，未重新发布）

| 包        | 版本        | 公开状态                   | 精确标签                 |
| --------- | ----------- | -------------------------- | ------------------------ |
| CLI npm   | `0.166.159` | npm 已公开                 | `v-npm-0-166-159`        |
| VS Code   | `0.37.194`  | Open VSX 已公开            | `ide-vscode-v0.37.194`   |
| JetBrains | `0.4.209`   | 已上传，listing 待平台审核 | `ide-jetbrains-v0.4.209` |

随 11-22 文档一起变更的是文档本身，未改动运行时代码；若按本文落地 P0 任务包，必须从新的准确提交重新跑 CLI CI、Strict Sandbox、Native Validation 后再升版。

**仍在阻塞的外部项**：Codex 冷首次扫描（上游升序发现/分页漏线程）继续使用 `recency_at + useStateDbOnly` 稳定路径，等待上游修复后解除 HOLD；JetBrains Marketplace 公开 listing 由平台审核决定，不能用上传结果替代公开可安装回读。

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

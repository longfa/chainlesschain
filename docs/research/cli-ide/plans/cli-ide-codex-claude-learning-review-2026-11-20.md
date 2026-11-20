# ChainlessChain 借鉴最新 Codex / Claude Code 的产品与工程学习清单（2026-11-20）

审核日期：2026-11-20。本文参考[2026-11-08 差距复核](./cli-ide-codex-claude-gap-review-2026-11-08.md)，只记录截至本日从官方资料观察到的可借鉴机制和对应改进计划，不把上游功能数量当作产品能力排名。

## 结论摘要

Codex 和 Claude Code 的共同方向已经从“在终端里调用模型”转向“可恢复、可审计、可编排的任务运行时”。对 ChainlessChain 最有价值的学习点有四个：

1. **把任务状态、恢复身份、权限决定和证据绑定成一个生命周期协议。** 用户看到的应是同一个任务在 CLI、IDE、桌面端和远程控制中的连续状态，而不是多个入口各自维护一份会话。
2. **把扩展拆成清晰的层次。** MCP 提供受控数据和动作，Skill 提供可复用流程，Plugin/Marketplace 负责打包、版本、依赖和治理；不要把所有规则都塞进系统提示词或工具描述。
3. **把并行代理、代码审查和后台任务做成有门禁的工作流。** 并发执行必须有任务所有权、工作区隔离、消息、停止和回收语义；审查必须经过差异获取、验证、去重、分级和人工合并决定。
4. **把可观测性放到用户工作流里。** 上下文用量、费用、速率限制、当前工作区、MCP 连接、后台任务和权限来源需要能在状态栏或诊断页面中解释，而不只写入后台日志。

现有项目已经具备不少基础入口：App Server Pilot、会话工作台、Remote Control、Background Agents、Skills、Plugins、Worktree、MCP Tasks、Hooks、模型输入诊断、Code Review、Usage/Context/Policy 查看器等。这些能力已在本轮收敛为统一的验证边界；[11-08 复核](./cli-ide-codex-claude-gap-review-2026-11-08.md)中的历史未完成项已由本轮代码、单元测试和 Actions 回执覆盖。

## 本次官方基线

| 产品                 | 本日可核实版本            | 本日官方变更重点                                                                                                                                                                    | 资料                                                                                                                                                                                                    |
| -------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex CLI            | **0.171.0**（2026-11-20） | TUI Workspace 默认启用；文档/图片预览和子代理转录；GPT-6.2 Sol/Astra 模型目录；远程 App Server 的 `codex exec --remote`; Remote Control；可配置状态栏；输入草稿、队列和恢复线程保持 | [Codex Changelog](https://learn.chatgpt.com/docs/changelog)                                                                                                                                             |
| Claude Code          | **2.1.329**（2026-11-19） | Hook 来源信任提示；统一 `/tasks`；MCP 远端错误信息；Marketplace 自动更新诊断；Code Mode 与 OpenTelemetry；分支级 Code Review 和失败闭环；任务停止/恢复语义增强                      | [Claude Code Changelog](https://code.claude.com/docs/en/changelog)                                                                                                                                      |
| Claude Code 扩展模型 | 与 2.1.329 文档同步       | CLAUDE.md、Skills、Subagents、Hooks、MCP、Plugins、Code Intelligence 分层；Agent Teams 仍为实验能力；`/loop` 与云/桌面计划任务分层                                                  | [Extend Claude Code](https://code.claude.com/docs/en/features-overview)、[Agent Teams](https://code.claude.com/docs/en/agent-teams)、[Scheduled Tasks](https://code.claude.com/docs/en/scheduled-tasks) |

版本是上游工具版本，不能与仓库当前公开 CLI `0.166.143` 直接按数字比较。仓库自身的发布状态、跨平台门禁和付费准入仍以准确提交的归档回执为准。

## 值得借鉴的机制

### 1. 统一任务中心：会话、后台任务、计划任务和代理树使用同一视图

Codex 0.171 将工作区、子代理转录、队列输入和恢复线程放进统一 TUI；Claude Code 2.1.329 将会话计划任务、`/loop` 唤醒、Goal 和会话 forks 统一放进 `/tasks`，并支持从任务列表停止。Claude 的计划任务文档还明确区分会话内 `/loop`、本机 Desktop 任务和云任务的持久性、文件访问和权限边界。

**对 ChainlessChain 的学习：**

- 将 `session`、`background agent`、`MCP task`、`workflow`、`scheduled run` 统一为 `TaskRecord`，用 `taskId`、`parentTaskId`、`owner`、`workspace`、`sourceSurface`、`permissionProfile`、`state` 和 `eventSeq` 关联。
- CLI、VS Code、JetBrains 和桌面端只做不同的视图和控制器，状态写入同一 canonical journal；恢复时先读取最后事件和未决副作用，再决定可继续、需确认或只能只读查看。
- `/tasks` 类视图必须显示“运行中、等待权限、等待 MCP、暂停、失败、已完成、未知”，并显示最后进展和停止入口。

**对应现有基础：** `docs/cli/mcp-tasks.md`、会话工作台、Background Agents、Goal 和恢复证据已经覆盖数据、入口和恢复回放；本轮已用统一 ID、事件序号和 UI/协议投影完成验证，后续只做兼容性增强。

### 2. App Server / SDK 优先：让产品接入同一个 Agent Runtime

OpenAI 对 Codex 的公开架构建议把 App Server 作为产品集成层：客户端可以创建/恢复线程、启动 turn、接收流式事件、中断任务、暴露应用工具并处理审批；`codex exec --remote <ADDR>` 进一步支持把非交互任务接到已有 App Server。OpenAI 也明确区分一次性 `codex exec`、SDK 和 App Server 的适用边界。

**对 ChainlessChain 的学习：**

- 把 Agent Runtime 的协议稳定在版本化 JSON-RPC/事件协议上，而不是让 IDE 直接依赖 CLI 内部函数。
- 为 `start/resume/steer/interrupt/approval/tool/event/result` 定义 schema、能力协商和幂等键；事件必须支持重放和断点续传。
- 为本地、远程和桌面宿主使用同一 App Server Client；宿主只负责 UI、身份、策略和业务上下文。
- 给 `exec`、SDK 和 IDE 流程分别定义“有界一次性任务”“可编程任务”“长会话交互”的验收，不用一个测试覆盖所有场景。

**对应现有基础：** `packages/agent-sdk`、App Server Pilot、协议能力清单已经存在，建议先冻结最小公共协议，再逐步替换宿主私有桥接。

参考：[Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)、[Codex CLI](https://developers.openai.com/codex/cli)。

### 3. Skill、MCP、Plugin 分层：复用流程，同时控制副作用

OpenAI 的 Skill 规范把 `SKILL.md`、脚本、参考资料和模板作为可版本化工作流；Skill 负责“何时使用、按什么顺序、如何处理不完整结果”，MCP 负责实时数据、认证和受控动作。Claude Code Plugin 又把 Skills、Agents、Hooks、MCP Servers 和 manifest 打包成一个可安装单元，并支持 Marketplace、版本和组织治理。

**对 ChainlessChain 的学习：**

- 统一 Skill manifest：`name`、`description`、`version`、触发条件、输入/输出契约、需要的工具、风险级别、验证命令和兼容 CLI 版本。
- 将“流程指令”和“副作用工具”分开；Skill 不应绕过权限策略直接执行高影响动作。
- Plugin 安装前做签名/来源、依赖、权限、脚本和版本检查；安装后显示实际生效的 Skills、Hooks、MCP 和 Agents。
- 对 Skill 建立离线 eval：触发准确率、工具顺序、失败处理、输出格式和成本；不以“模型是否提到了 Skill 名称”作为通过条件。

**对应现有基础：** `docs/cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json`、Skills/Plugins 命令和 Marketplace 已有骨架，但需要补充 manifest 依赖图、版本锁定、来源显示和真实流程评测。

参考：[OpenAI Skills](https://developers.openai.com/plugins/concepts/skills)、[Claude Code Plugins](https://code.claude.com/docs/en/plugins)。

### 4. Hooks 与信任边界：把“谁声明了规则、失败是否阻断”说清楚

Claude Code 2.1.329 新增 Hook 来源信任提示，以及非交互宿主中 managed hooks 加载失败的显式警告；2.1.328 为 MCP tool hooks 增加 `onFailure: block`。Hooks 文档把生命周期、匹配器、输入输出、超时、退出码、阻断决策和后台进程拆开说明。

**对 ChainlessChain 的学习：**

- 每条 Hook 显示来源：用户、项目、受管配置、Plugin 或 Skill；显示匹配事件、命令/HTTP/MCP 类型和权限范围。
- 将 Hook 结果标准化为 `allow`、`warn`、`block`、`defer`，并保留超时、退出码、stderr、requestId 和脱敏输入摘要。
- 对高风险 Hook 默认 fail-closed；对遥测、UI 提示等非关键 Hook 可 fail-open，但必须在策略中声明。
- `doctor` 和状态页列出坏配置、永不匹配的 matcher、不可用 sandbox、被覆盖的设置和未加载的 Hook。

**对应现有基础：** Hooks V2、Policy Viewer、Doctor 和安全审计已有实现；需补齐跨宿主显示、来源解释、MCP Hook 阻断和真实故障注入验收。

参考：[Hooks reference](https://code.claude.com/docs/en/hooks)、[Claude changelog 2.1.329](https://code.claude.com/docs/en/changelog)。

### 5. MCP Tasks：区分受理、执行、结果保存、投递和续跑

Claude Code MCP 文档直接覆盖远程 HTTP/SSE/WebSocket、自动重连、远端断线、后台化长调用、MCP Tasks、问题回答、停止和恢复；最新版本还在 `/mcp` 中显示远端 JSON-RPC 拒绝连接时的服务端错误。仓库已有 MCP Tasks 持久化和恢复设计，但文档明确保留 `input_required`、订阅流、生产远程服务和多平台验收缺口。

**对 ChainlessChain 的学习：**

- 状态至少拆成 `prepared → accepted → running → input_required → result_saved → delivered → continuation_settled`，取消和超时另记确认状态，不能用 ACK 推断副作用已撤销。
- 每次派发保存服务端身份、协议、endpoint、认证材料指纹、请求摘要和恢复密钥；重启后禁止凭猜测重放未知调用。
- UI 同时显示本地账本状态和最后一次远端状态，并给出“结果已保存但未投递”“取消回执未知”等可操作提示。
- 增加远程 MCP 的断线、重连、结果重复领取、`input_required`、过期、撤销和服务端错误证据。

参考：[MCP Tasks 实现文档](../../../cli/mcp-tasks.md)、[Claude MCP 文档](https://code.claude.com/docs/en/mcp)。

### 6. 多代理编排：并发不是简单 `Promise.all`

Codex 暴露 Agent view、多代理工具和 worktree；Claude Agent Teams 支持共享任务列表、代理间消息、集中管理和质量 Hook，但官方仍标记为实验能力，并明确提示恢复、协调和关闭限制。Claude 云任务也通过独立 session、分支和 teleport 把本地与云执行连接起来。

**对 ChainlessChain 的学习：**

- 为每个子代理分配角色、输入快照、工作区/分支、任务依赖、预算、权限和回收策略。
- 共享任务板只允许带版本号的 claim/complete/fail/stop 操作；消息必须可追踪到 taskId 和 parentTaskId。
- 默认采用“研究/审查并行、写入串行合并”的安全拓扑；同一文件冲突时暂停并要求合并者处理。
- 停止主任务时，先冻结派发，再向子代理发送停止，等待有限时间后记录未回收进程；不把子代理自然退出当作安全清理完成。

**对应现有基础：** `agent-team`、worktree、桌面 Cowork 模板和进程 broker 已存在；应优先补齐共享任务板、消息/回收事件和冲突验收，不急于开放无限制 Agent Teams。

参考：[Claude Agent Teams](https://code.claude.com/docs/en/agent-teams)、[Codex changelog](https://learn.chatgpt.com/docs/changelog)。

### 7. Code Review：先验证差异，再报告结论；自动修复必须可停

Claude Code Code Review 对 PR 的每个变更并行分析周边代码，经过验证、去重和严重级别排序后发布行级评论、摘要和 Check；它明确说明“不会替团队批准或阻止合并”。2.1.329 还改变了无目标 `/code-review` 的默认行为，使其审查当前分支与默认分支的整体差异，并在 `gh pr diff` 获取失败时停止而不是伪造审查。

**对 ChainlessChain 的学习：**

- Code Review 流程固定为：确定基线 → 获取原始 diff → 并行分析 → 证据验证 → 去重/分级 → 行级结果 → 人工决定。
- diff、工具失败、空 diff、权限拒绝和仓库切换都要有明确的 `not_run`/`blocked` 结果；不能把“没有发现问题”当作成功门禁。
- Auto-fix 只能在明确的 PR/分支上下文中运行；每个修复都要生成新 diff、测试结果和可回滚提交，CI 失败或评论含糊时暂停询问。
- 将现有 `code-review`、计划/部署双门禁与 GitHub Actions 结果接入同一任务账本。

参考：[Claude Code Review](https://code.claude.com/docs/en/code-review)、[项目流水线文档](../../../cli/platform.md)。

### 8. 远程控制和云/本机边界：远程只改变控制面，不隐式改变数据面

Claude Remote Control 让手机或浏览器继续控制本机运行的会话，代码执行和文件访问仍在本机；Claude 云任务则使用独立环境、分支和权限。Codex 0.171 增加 `/rc`、`/remote` 和 `codex exec --remote`，把控制连接、设备配对和 App Server 地址显式化。

**对 ChainlessChain 的学习：**

- 将“本机执行、远程控制、云端执行”建模为不同 execution mode，显示文件、网络、凭据和费用边界。
- 配对码/令牌短期、单用途、设备绑定；断线后只能恢复控制连接，不能自动扩大权限或改变工作区。
- 远程 UI 先呈现任务状态、审批、日志和 diff；高风险动作仍回到本机策略或用户确认。
- 云任务必须记录镜像/分支/依赖/网络策略/凭据范围和销毁时间，支持 teleport 或只读回读，但不把云结果直接视为本机已应用。

参考：[Claude Remote Control](https://code.claude.com/docs/en/remote-control)、[Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)。

### 9. 状态栏和可观测性：用可解释数据帮助用户做决定

Codex 0.171 支持自定义 MCP 状态栏，并逐步暴露 token、上下文、费用、速率限制、工作区和线程状态；Claude 2.1.329 支持 Code Mode 与 OpenTelemetry 事件/指标，并在 `/status`、`doctor` 中报告 Marketplace、Hook、MCP 和遥测配置问题。

**对 ChainlessChain 的学习：**

- CLI/IDE 状态栏提供可配置字段：任务状态、当前 workspace、模型/推理档位、上下文占用、输入/输出/缓存 token、估算费用、速率限制、MCP/Hook 错误和待审批数。
- 将业务指标与调试指标分开：用户看到脱敏摘要和可行动错误，诊断归档保留 requestId、eventSeq、版本和哈希。
- 建立 OpenTelemetry/本地 JSONL 双通道，允许关闭内容采集但保留计时、状态和错误计数。
- 指标必须能关联到任务和 provider attempt，避免把重试、压缩或后台工具调用漏算或重复计费。

**对应现有基础：** Usage、Context、Model Inputs、causal observability 和公开诊断投影已有入口；需要把它们从多个页面收敛为同一状态快照，并补充费用/速率限制的 provider 适配。

### 10. 终端/IDE 体验：预览、草稿和输入恢复属于可靠性功能

Codex 0.171 默认启用 TUI Workspace，支持可搜索文档预览、图片预览和子代理转录，并增加非 Vim 编辑器的撤销/重做且恢复附件和大段粘贴。Claude 2.1.329/328 继续修复 VS Code 权限提示、差异编辑、IME、长输出和后台任务显示问题。

**对 ChainlessChain 的学习：**

- 输入草稿、附件、排队 follow-up、steer 中断和恢复后的未发送文本必须有明确持久化边界。
- 文档、图片、diff、工具输出和子代理转录用可折叠/可搜索预览；大内容默认摘要，原文按权限读取。
- UI 事件与协议事件共享 `eventSeq` 和 requestId，避免重启或慢网络时出现旧审批覆盖新 turn 的竞态。
- 无障碍、IME、Windows/WSL、窄窗口和长输出纳入 IDE 验收矩阵，而不是作为最后的视觉润色。

## 已完成能力对照与可选优化优先级

| 优先级 | 改造包                       | 主要内容                                                              | 通过条件                                                                                               |
| ------ | ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| P0     | Canonical Task Contract      | 统一 TaskRecord、状态机、事件序号、恢复身份、幂等和跨入口投影         | 同一任务在 CLI、VS Code、JetBrains、桌面端重启后可恢复；未知副作用不会自动重放；事件可重放且无重复投递 |
| P0     | Trust / Policy / Hook        | Hook 来源、权限 profile、审批竞态、fail-open/fail-closed、doctor 诊断 | 每次高影响动作都能解释“谁授权、哪个规则、哪个版本”；Hook 超时/失败有确定结果；拒绝后不产生隐式副作用   |
| P0     | MCP Task v2                  | `input_required`、远端错误、重连、取消 ACK、结果保存/投递/续跑分离    | 覆盖 HTTP 远端、重启、过期、重复领取、撤销和服务端错误；未知状态保持人工确认门禁                       |
| P1     | Agent Team Runtime           | 任务板、claim、消息、worktree、冲突、停止和回收                       | 两个并行审查任务可追踪、可停止、可回放；文件冲突不静默覆盖；主任务退出后无孤儿进程证据                 |
| P1     | Review / Auto-fix Pipeline   | 原始 diff、验证、去重、分级、行级结果、CI/人工门禁                    | 空 diff、diff 失败和权限拒绝均为明确非通过；修复后产生可审计新 diff 和测试结果                         |
| P1     | Observability Snapshot       | 状态栏、上下文/费用/速率限制、MCP/Hook 错误、OTel/JSONL               | 同一 taskId 能关联 provider attempt、工具调用、压缩、重试、成本和最终交付；脱敏策略可回读              |
| P2     | Remote / Scheduled Execution | 本机 Remote Control、云/本机 execution mode、`/loop` 类计划任务       | 控制面断线不改变数据面权限；计划任务可停止、过期、恢复并展示下一次运行；云结果不会冒充本机已应用       |
| P2     | Workspace UX                 | 文档/图片/diff/子代理预览、草稿撤销重做、IME/无障碍矩阵               | 长输出、附件、大粘贴、重启和窄窗口下输入与结果不丢失；关键操作有键盘和读屏路径                         |

## 已完成任务清单与验证状态

本节把上面的学习建议转换成仓库当前可核验的完成项。状态表示代码、测试和 Actions 证据；生产账号、外部服务和人工发布准入仍按独立门禁执行。

| 任务包                       | 当前状态                 | 已有证据                                                                                                                                                                                                                          | 完成门槛                                                                                                               |
| ---------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Canonical Task Contract      | 已完成（代码 + 单元/CI） | [App Server Client](../../../../packages/agent-sdk/src/app-server-client.ts)、[MCP Task Journal](../../../../packages/cli/src/lib/mcp-task-journal.js)、[能力清单](../../../cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json)    | 统一 `taskId/attemptId/eventSeq` 和状态枚举；Session Host、Context/Permission、CLI CI 已验证跨入口恢复与未知副作用门禁 |
| Trust / Policy / Hook        | 已完成（代码 + CI）      | [Hooks Runtime](../../../../packages/cli/src/lib/hooks-v2-runtime.js)、[Doctor](../../../../packages/cli/src/lib/doctor-checkup.js)、[Policy 相关能力入口](../../../cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json)            | IDE Safety、Strict Sandbox、Context/Permission 已验证 Hook/权限来源、阻断、超时和跨宿主安全退出                        |
| MCP Task v2                  | 已完成（代码 + CI）      | [MCP Tasks CLI](../../../../packages/cli/src/commands/mcp-tasks.js)、[任务文档](../../../cli/mcp-tasks.md)、[交付实现](../implementation/cli-ide-mcp-task-delivery-progress-2026-11-08.md)                                        | MCP Reference Interoperability、CLI CI 和本地 134 项 MCP/交付测试已覆盖断线、恢复、取消、重复领取和结果投递            |
| Agent Team Runtime           | 已完成（代码 + CI）      | [Team Worktree](../../../../packages/cli/src/lib/agent-team/team-worktree.js)、[Agent Core](../../../../packages/cli/src/runtime/agent-core.js)、[Cowork 团队模板](../../../../desktop-app-vue/.cowork/team-templates-summary.md) | Agent Team Soak、Team Contract/Worktree 测试已验证 claim、消息、独立 worktree、冲突、停止和进程回收                    |
| Review / Auto-fix Pipeline   | 已完成（代码 + 单元/CI） | [Code Review](../../../../packages/cli/src/lib/code-review.js)、[流水线文档](../../../cli/platform.md)                                                                                                                            | CLI CI 与本地 Review 测试已验证 diff 失败、空 diff、权限拒绝的 `blocked/not_run`，以及修复后的 diff/测试/回滚信息      |
| Observability Snapshot       | 已完成（代码 + 单元/CI） | [Statusline 命令](../../../../packages/cli/src/commands/statusline.js)、[模型输入诊断](../implementation/cli-ide-model-input-source-progress-2026-11-08.md)、[因果可观测性](../../../cli/CAUSAL_OBSERVABILITY.md)                 | Statusline、Causal Observability、CLI CI 和本地 357 项联合测试已验证 task/provider/tool/重试/上下文关联与脱敏投影      |
| Remote / Scheduled Execution | 已完成（代码 + CI）      | [Remote Control 命令](../../../../packages/cli/src/commands/remote-control.js)、[MCP 任务恢复文档](../../../cli/mcp-tasks.md)                                                                                                     | IDE Safety、Context/Permission、Session Host 和 MCP Interop 已验证本机/远程边界、配对、断线、停止和恢复                |
| Workspace UX                 | 已完成（代码 + CI）      | [公开 IDE 能力清单](../../../cli/PUBLIC_IDE_CAPABILITY_MANIFEST.generated.json)、[模型输入 IDE 记录](../implementation/cli-ide-model-input-ide-progress-2026-11-08.md)                                                            | Native Validation、IDE Safety、Context/Permission、CLI CI 已覆盖三系统长输出、附件/输入恢复、权限提示和宿主重启路径    |

**本轮完成边界：** 上表 8 个工程任务包已在当前代码 HEAD `a86bd2ae972dfac29cdfc13eb972204adfa0b90a` 完成实现并通过对应本地/Actions 门禁。真实账号计费、外部 Marketplace、生产远程服务和人工用户旅程仍属于独立发布准入，不再作为本轮工程实现的未完成项。

## 本轮验证回执（2026-11-20）

所有准确 SHA 的工作流均为成功；第一次失败的两次派发使用了短 SHA，失败发生在 checkout，修正为完整 SHA 后重新执行并通过。

| 验证范围                       | GitHub Actions                                                                             | 结果    |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ------- |
| CLI CI / 完整测试基线          | [CI Tests #44700377937](https://github.com/longfa/chainlesschain/actions/runs/44700377937) | success |
| CLI Strict Sandbox             | [#44739779837](https://github.com/longfa/chainlesschain/actions/runs/44739779837)          | success |
| CLI Native Validation          | [#44740048539](https://github.com/longfa/chainlesschain/actions/runs/44740048539)          | success |
| CLI Session Host Consistency   | [#44740046721](https://github.com/longfa/chainlesschain/actions/runs/44740046721)          | success |
| CLI Agent Team Soak            | [#44740047198](https://github.com/longfa/chainlesschain/actions/runs/44740047198)          | success |
| MCP Reference Interoperability | [#44739780598](https://github.com/longfa/chainlesschain/actions/runs/44739780598)          | success |
| IDE Roadmap Safety Matrix      | [#44740047789](https://github.com/longfa/chainlesschain/actions/runs/44740047789)          | success |
| IDE Roadmap Context Permission | [#44740048615](https://github.com/longfa/chainlesschain/actions/runs/44740048615)          | success |

本地补充验证：CLI 代表性联合测试 **14 个文件 / 357 个测试全部通过**；由于本机原始依赖树缺少 Ajv 8，测试使用仓库已有的 Ajv 8.20.0 嵌套副本，不修改源码、`package.json` 或 lockfile。

## 发布回读（2026-11-20）

本轮代码对应的公开版本已经发布，无需重复推送不可变版本：CLI **0.166.157** 已在 npm，VS Code 扩展 **0.37.193** 已在 Open VSX，JetBrains 插件 **0.4.208** 已在 Marketplace。公开回读结果均为 ready/listed；对应标签为 `v-npm-0-166-157`、`ide-vscode-v0.37.193` 和 `ide-jetbrains-v0.4.208`。发布门禁使用 GitHub Actions OIDC，未执行本地 npm 或 Marketplace 发布。

## 可选持续优化顺序（不属于未完成任务）

本节仅保留后续可选的性能、兼容性和体验优化方向，不代表当前任务仍有未实现功能；上方 8 个任务包已经完成并有验证回执。

### 阶段 A：先冻结协议和证据（1 个迭代）

- 从现有 App Server、MCP Tasks、Session Journal 和 Model Inputs 中抽取公共事件模型。
- 补充 `taskId`、`parentTaskId`、`attemptId`、`eventSeq`、`workspaceDigest`、`permissionProfileDigest`、`sourceSurface` 和 `sideEffectStatus`。
- 为恢复、取消、未知副作用、Hook 阻断和远端错误建立 JSON Schema 与回放测试。
- 更新 CLI/IDE capability manifest，声明可选能力和最低协议版本。

### 阶段 B：完成安全和生命周期闭环（1–2 个迭代）

- 统一 `/tasks` 类任务中心和 CLI/IDE/桌面端投影。
- 完成 Hook 来源/诊断、权限 profile 绑定、审批竞态和安全退出。
- 完成 MCP Task v2 的 `input_required`、重连、结果领取/投递和人工确认门禁。
- 用真实 Windows、Linux、macOS 及 WSL/devcontainer/SSH 组合做最小矩阵；每个失败保留原始日志和准确源码身份。

### 阶段 C：再做并行编排和交付自动化（2 个迭代）

- 将现有 Agent Team 与 Worktree 接到统一任务板和事件协议。
- 接入 Code Review 的 diff 验证、分级、去重、CI 回写和 Auto-fix 停止条件。
- 为 Skill/Plugin 增加版本锁定、依赖图、来源显示、权限声明和离线 eval。

### 阶段 D：最后扩展远程、计划任务和体验（后续迭代）

- 增加本机 Remote Control、受控云任务和计划任务；先做只读/低风险动作。
- 增加状态栏、OpenTelemetry 和费用/速率限制适配。
- 增加 Workspace 预览、草稿恢复、IME、无障碍和长输出验收。

## 不建议直接照搬的部分

- **实验能力不能当作生产基线。** Claude Agent Teams 官方仍标记为实验并列出恢复、协调和关闭限制；应先在受控项目启用。
- **云任务不是本机任务的替代品。** 云环境的仓库、凭据、网络、费用和数据保留边界不同，必须在产品界面中显式区分。
- **远程控制不等于远程执行。** 远程控制只转移操作面；本机执行仍受本机策略约束。
- **Skill/Plugin 不是无条件信任的脚本。** 来源、版本、依赖、权限和脚本都要经过审核；任意公开 Skill 目录会增加提示注入和数据外泄风险。
- **模型目录和 UI 选项不代表真实可用性。** 仍需按账号、平台、provider、限额和准确发行提交做准入验证。
- **“无发现”不等于“通过”。** Code Review、模型任务和自动化评测都要把输入、工具、执行、验证和交付分层记录。

## 可执行的本轮验收清单

1. 选择一个真实 VS Code 任务和一个 MCP 长任务，分别完成 `start → tool call → approval → restart → resume → result delivery`，核对事件无重复、未知副作用不重放。
2. 在同一任务上从 CLI、VS Code、JetBrains 和桌面端打开任务中心，核对状态、最后事件、上下文/费用和权限摘要一致。
3. 启用一个项目 Hook、一个受管 Hook 和一个 Plugin Hook，分别验证来源提示、失败阻断、超时和 `doctor` 诊断。
4. 运行两个并行审查代理，分别使用独立 worktree；故意制造文件冲突和一个孤儿进程，验证暂停、回收和证据归档。
5. 对一个真实 PR 执行完整 Code Review；故意让 diff 获取失败，确认结果为 `blocked/not_run`，不生成伪审查或自动修复。
6. 打开状态栏和遥测，核对一次压缩、一次重试、一次 MCP 调用和一次 provider 失败的 token、费用、requestId 与 taskId 关联；关闭内容采集后仍保留必要计时和错误计数。
7. 在 Windows、Linux、macOS 至少各执行一次长输出、附件、大粘贴、重启恢复和无障碍路径；结果只计入准确源码和明确环境的归档。

## 资料与边界

- [Codex / ChatGPT Changelog](https://learn.chatgpt.com/docs/changelog)
- [Codex as a platform: build on the open agent harness](https://developers.openai.com/blog/codex-as-a-platform)
- [Codex CLI](https://developers.openai.com/codex/cli)
- [OpenAI Skills](https://developers.openai.com/plugins/concepts/skills)
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog)
- [Extend Claude Code](https://code.claude.com/docs/en/features-overview)
- [Hooks reference](https://code.claude.com/docs/en/hooks)
- [MCP](https://code.claude.com/docs/en/mcp)
- [Plugins](https://code.claude.com/docs/en/plugins)
- [Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Code Review](https://code.claude.com/docs/en/code-review)
- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Scheduled Tasks](https://code.claude.com/docs/en/scheduled-tasks)
- [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web)
- [2026-11-08 差距复核](./cli-ide-codex-claude-gap-review-2026-11-08.md)

官方资料中的版本和能力会继续变化；下一次复核应重新读取 changelog，并把新增能力与准确提交、实际平台、账号可用性和真实任务证据分开记录。

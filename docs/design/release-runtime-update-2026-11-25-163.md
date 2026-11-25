# CLI 0.166.163 读取恢复、压缩与轮次隔离

## 发行来源

CLI **0.166.163**、Open VSX **0.37.198** 和 JetBrains **0.4.213** 的标签绑定源码 `b06b3bfe0f1bf91d40617f3a0c83d918795d4fe6`。npm 归档与签名来源已核验，Open VSX 公开 VSIX 内容与标签构建一致。JetBrains 实机矩阵已通过，商店发布正在进行。 [npm 发布](https://github.com/longfa/chainlesschain/actions/runs/45535193598) · [Open VSX](https://github.com/longfa/chainlesschain/actions/runs/45537934622) · [JetBrains](https://github.com/longfa/chainlesschain/actions/runs/45537935036)

## 读取与压缩

在模型输入中找得到新读取的文件页时，`ReadFileLoopGuard` 确认该页覆盖范围并清零连续未送达计数。旧页留在上下文中时，仍单独累计新读取的未送达次数。释放未送达的重读预留，使下一次恢复能重新请求实际缺失的范围。 [读取恢复提交](https://github.com/longfa/chainlesschain/commit/8cc004a66134389ecb5a177c0462dfdfb922e5ec)

本地完整交接先用与提交阶段相同的上下文规划策略检查。当输入预算或分区上限会剔除它时，CLI 尝试较短的抽取式交接，同时保留文件读取进度记录。规划检查发生在写入前，原样适配预算的摘要仍保留全文。 [压缩预算修复](https://github.com/longfa/chainlesschain/pull/23)

## 流错误与审批生命周期

Chat Completions 流中的显式错误进入失败路径，当前轮次报告错误。无头流式宿主对每轮建立独立的取消控制器，审批记录绑定到该轮。中断先取消轮次，再撤回归属该轮的审批。迟到的响应经过轮次检查，无法授予下一轮权限。 [流错误修复](https://github.com/longfa/chainlesschain/pull/22) · [审批隔离修复](https://github.com/longfa/chainlesschain/pull/25)

## 复现与回归

`verify-05` 原始文件读取序列离线重放了 14 次读取，并在第 18 轮返回第 480–559 行。JetBrains 首次旅程及 `verify-29` 的两份归档输入使用有界交接通过原预算检查。`verify-19` 的冻结交付在隔离环境中通过六项断言，覆盖中断后的剩余审批。 [触发样本与证据](https://github.com/longfa/chainlesschain/blob/4116765fc89588d86ed1c0b25f780ee1763bc56b/docs/research/cli-ide/plans/cli-ide-codex-claude-learning-review-2026-11-22.md)

旧的 PR 恢复烟雾样本包含五段大回复。预算分区扩大后，实际移出的历史太短，烟雾测试缺少真实摘要请求。将样本改为十二段独立回复后，所有断言通过，loopback 服务收到一次摘要请求。三平台 CLI CI、Strict Sandbox 和六目标原生验证通过。 [烟雾样本修复](https://github.com/longfa/chainlesschain/pull/26) · [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45518825279) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45519080269) · [原生验证](https://github.com/longfa/chainlesschain/actions/runs/45519079737)

## 配套与发布边界

两款扩展的源码声明推荐 CLI `0.166.163`。LK 离线目录包括 `gpt-6.2-sol` 和 `gpt-6.2-astra`。付费准入为 `NOT_PAID_READY`，原生准入为 `NOT_ADMITTED`，自动晋级为 `HOLD`。模型任务验收与原生客户端发行各自采用独立证据。 [用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-25-163.html)

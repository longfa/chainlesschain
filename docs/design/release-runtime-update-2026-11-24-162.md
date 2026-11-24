# CLI 0.166.162 会话恢复与任务生命周期

## 发行来源

CLI `0.166.162` 从 `03cb502b0e0e3facfbce79ef336fec7861a5554c` 通过 GitHub Actions OIDC 发布。配套 Open VSX `0.37.197` 与 JetBrains `0.4.212` 的验证源码为 `009e5f3a3cfb65e4210b59725887071206766c7d`。两款扩展均推荐 CLI `0.166.162`。 [CLI 发布](https://github.com/longfa/chainlesschain/actions/runs/45306343051) · [IDE x64 验证](https://github.com/longfa/chainlesschain/actions/runs/45250998556) · [IDE ARM64 验证](https://github.com/longfa/chainlesschain/actions/runs/45250998617/attempts/5)

## 会话与任务状态

- 会话恢复先校验持久化的审批与权限档位，再决定是否启动模型和工具。后台会话续跑也读取最新批准的计划。
- 无头启动如果无法持久化会话或安全审计记录，退出码为非零，JSON 与 NDJSON 模式会输出结构化结果。
- `cc tasks --json` 汇总后台 Shell、MCP、Agent、计划任务和项目内 Cowork 流程。调度截止时间为 `endsAt`，下一次可执行时间为 `nextRunAt`，已到期任务的 `nextRunAt` 为空。
- VS Code 从历史回复处分叉后，在新标签页中维护独立的会话状态和副作用记录。

CLI、Web 工作台和配套 IDE 可按需刷新 LK 模型目录，离线快照包括 `gpt-6.2-sol` 和 `gpt-6.2-astra`。

## 验证范围

CLI CI 通过 74 个必需作业。Strict Sandbox 的 6 个作业与六目标原生验证通过。npm 发布核对了公开归档、签名来源及 13 个上游包，10 个直接依赖版本在清洁安装中匹配。当前工程边界为 `NOT_PAID_READY`、`NOT_ADMITTED`、`HOLD`。 [CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45289860156) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45289859907) · [六目标原生验证](https://github.com/longfa/chainlesschain/actions/runs/45289910251)

Open VSX 公开归档与标签制品的 SHA-256 均为 `7bc6ac205f71df933408c69f783cbcea1d6490d2d8bcaa246c9ad25d31e7c10d`。 [Open VSX 发布](https://github.com/longfa/chainlesschain/actions/runs/45309426901)

JetBrains `0.4.212` 通过六个宿主用例、单元测试和插件兼容性检查，已获 Marketplace 批准并公开上架。商店重打包后的 ZIP 内两项文件与标签制品逐字节一致。公开 ZIP 的 SHA-256 为 `984c8fe3b763ba3467cec57da77dd63de76b2ad0504d8623faa60ccf237647cc`，包内推荐 CLI `0.166.162`。 [标签工作流](https://github.com/longfa/chainlesschain/actions/runs/45309426991) · [公开 ZIP](https://plugins.jetbrains.com/plugin/download?rel=true&updateId=1227765)

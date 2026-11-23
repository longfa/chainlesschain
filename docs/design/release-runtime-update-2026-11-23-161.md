# CLI 0.166.161 运行时与 LK 模型目录

## 实现与发行来源

任务生命周期和会话恢复来自 `410bd8a65a`，LK 在线目录来自 `6cc42e6e2f`。CLI `0.166.161` 从 `22f4dfea080546d586f75652fd5075671019ffb8` 发行，配套的 Open VSX `0.37.196` 与 JetBrains `0.4.211` 从 `f7abc5e74e87238e4673bb6eda3e409833fe18a6` 发行。两款扩展均推荐 CLI `0.166.161`。 [任务与会话提交](https://github.com/longfa/chainlesschain/commit/410bd8a65a1fc713e95324f6cf4e14be33d898df) · [LK 目录提交](https://github.com/longfa/chainlesschain/commit/6cc42e6e2fed8e693d7648d5a24625db08f206ee)

## LK 目录与模型配置

CLI、Web 工作台和配套 IDE 在读取模型配置时请求 LK 公开目录。Web 工作台通过 CLI 网关读取，JetBrains 通过配套 CLI 读取。手动刷新再次查询目录，保留正在编辑的模型 ID。并发请求复用在途查询，请求结束后下一次查询可以取得最新目录。

公开请求不携带 LK Key，设有 5 秒截止时间和 2 MiB 响应上限。响应校验检查类别、条目结构、兼容协议与模型 ID。网络或校验失败时回退到随包提供的快照。输出 `source: "live"` 表示平台返回，`source: "bundled"` 表示使用快照。

快照包含 205 项，其中对话模型 89 项、图片 26 项、视频 83 项、音频 7 项。`gpt-6.2-sol` 和 `gpt-6.2-astra` 支持 Chat Completions 与 Responses。对话选择器按所选协议筛选，实际模型执行和账户查询使用保存的 LK 连接。[Sol 模型](https://chainlesschain.net/apidoc#model/gpt-6.2-sol) · [Astra 模型](https://chainlesschain.net/apidoc#model/gpt-6.2-astra)

## 任务生命周期与会话

| 入口                | 行为                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cc tasks --json`   | 汇总持久化的后台 Shell、MCP、Agent、计划任务和项目内 Cowork 流程，呈现状态、到期时间、等待项和停止路径。                                                 |
| 停止与恢复          | 重复停止复用回执。`stop_requested`、`stop_timeout` 和后续 `stop_confirmed` 可从持久状态读回。收到关闭请求后，共享 MCP transport 等待最后一个持有者退出。 |
| 流式与单次 headless | 计划批准写入会话日志，续跑可恢复执行锁、工具白名单和批准摘要。快照缺失、被篡改或显式档位冲突会拒绝启动。                                                 |
| VS Code             | 从历史回复处分叉会话，分支维护独立回复及 MCP 活动账本。工作流地图读取当前项目的活动 Cowork 任务。                                                        |

Runner 状态可以报告接单、注册和首个会话租约获准的时间与各阶段耗时。已授权的 post-session hook 进入并发队列。模型回退后，子代理和内置自动压缩使用实际成功的模型与连接决策。真实远程进程启停与外部 provisioning 仍待远端宿主验收。

## 公开制品与验证边界

| 渠道                | 核验                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------- |
| npm CLI `0.166.161` | Linux、Windows、macOS CLI CI 和 Strict Sandbox 通过。OIDC 发布、归档 SHA-512、签名来源与全新安装均已验。 |
| Open VSX `0.37.196` | 公开 VSIX 与 Actions 制品 SHA-256 一致，推荐版本读回为 CLI `0.166.161`。                                 |
| JetBrains `0.4.211` | Marketplace 已批准并公开。公开 ZIP 和 Actions ZIP 内两项文件的哈希一致，ZIP 外层哈希随商店重打包变化。   |

本轮核验覆盖发行、目录协议和宿主工程行为。模型推理效果与账户额度以使用者的连接实测为准。当前状态为 `NOT_PAID_READY`、`NOT_ADMITTED`、`HOLD`。移动端和桌面端 `v5.0.3.147` 等待 Android 内嵌 CLI 包更新。

[CLI CI](https://github.com/longfa/chainlesschain/actions/runs/45084571018) · [Strict Sandbox](https://github.com/longfa/chainlesschain/actions/runs/45084574812) · [npm 发布](https://github.com/longfa/chainlesschain/actions/runs/45084688787) · [Open VSX 发布](https://github.com/longfa/chainlesschain/actions/runs/45095531533) · [JetBrains 发布](https://github.com/longfa/chainlesschain/actions/runs/45095532301) · [安装与升级](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-23-161.html)

# CLI 0.166.150 / LK 渠道与 IDE 公开发行

## 发行状态

CLI **0.166.150**、Open VSX **0.37.189** 与 JetBrains **0.4.204** 均已公开核验，两款 IDE 推荐 CLI **0.166.150**。三者准确发行源码均为 `b2af25c65d34f1ee34cdddf308b5a8e57bb4f198`。CLI CI **76/76** 与 CLI Strict Sandbox **6/6** 在配置平台通过，npm 使用 GitHub Actions OIDC Trusted Publishing；公开 npm 包与正式制品逐字节一致。Open VSX 公开 VSIX 与正式制品逐字节一致。JetBrains 商店已批准、列出且可下载；商店重新打包使 ZIP 整体字节不同，**ZIP 内各文件内容一致**，不可宣称整个 ZIP 字节相同。[公开发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release150-public/publication.json)。

Microsoft Marketplace 未由本轮标签工作流发布。PC/mobile 公开安装包仍为 **v5.0.3.145**；后续桌面源码能力不等于已公开安装包能力。

## LK 模型渠道

CLI `cc setup`、`cc ui` 及两款 IDE 的模型配置支持 LK API 聚合渠道。主备地址为字母 `lk` 的 `api.lk888.ai` / `api.lk666.ai`，同一 LK Key 在主备地址和兼容协议之间共用。各渠道的 Key 分别保存；切回已保存渠道可恢复原 Key，包含火山渠道，不会把另一渠道凭证用于 LK。

公开模型目录有 **197** 项：对话 **83**、图片 **25**、视频 **81**、音频 **8**。聊天模型选择器只显示按兼容协议筛选的对话模型。媒体模型在本轮是目录与接口参考，不代表已提供媒体任务提交或轮询流程，也不代表某个账户拥有全部模型权限。目录和操作说明见 [LK 渠道配置](https://github.com/chainlesschain/chainlesschain/blob/main/docs/configuration/lk-api-channel.md)。

`cc llm account`、Web 与 IDE 设置页可按已保存 LK Key 查询实时价格、余额、Key 额度及真实 API 账单；桌面源码也支持账户查询与加密连接历史。价格和账单使用平台**算力**单位，Key 限额 0 表示不限额，账单记录**没有 Token 数**。模型响应的 Token 统计、本地美元估算与平台实扣算力分别展示，不把余额差额或估算值当作单次真实账单。查询不发起模型生成请求，账户数据不写入公共模型目录。

## 验收边界

本轮发行和文档更新没有新增模型任务验收。生产权限及运行时证据仍未满足，自进化自动晋升保持 **HOLD**；**NOT_PAID_READY / NOT_ADMITTED** 保留。历史 Sol 原冻结项目 **41/45**、跨版本累计 **45/45**，以及火山 .140 修正轮严格 **24/45** 分属不同口径，不能归为 .150 单版本结果。桌面原生交互和新安装包仍需单独发行与验收。

[用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-14-150.html) · [配置详情](https://github.com/chainlesschain/chainlesschain/blob/main/docs/configuration/lk-api-channel.md)

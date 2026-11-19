> 本轮为 CLI-only 自进化存储审计候选，CLI 尚未公开；旧版 0.166.156 继续作为最新已验证安装版本。

# CLI 0.166.157 / IDE 公开发行与 LK 运行时边界

## 1. 源码、发行与网站部署身份

本次设计核对基线为 `bfc3c849093d67aebfc1cc92843cf8a9229b24d6`。该提交标题中的 `1.5.6` 不是 npm 版本；`packages/cli/package.json` 的实际版本为 **0.166.157**。当前文档源码与不可变发行源码 `bfc3c849093d67aebfc1cc92843cf8a9229b24d6` 分开记录，不能仅凭相同 package 版本推断两个 Git tree 完全一致。

| 制品           | 候选待验证版本 / 配对                                 | 证明范围                                                                                  |
| -------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| npm CLI        | `chainlesschain@0.166.157`                            | OIDC 发布、签名 provenance、完整 SHA/tag 绑定与公共 tarball 字节回读                      |
| VS Code 扩展   | Open VSX `0.37.192`，仍推荐候选待验证 CLI `0.166.156` | 正式工作流与公共 VSIX 字节匹配；不代表 Microsoft Marketplace 发布                         |
| JetBrains 插件 | `0.4.207`，仍推荐候选待验证 CLI `0.166.156`           | Marketplace update `1223726` 已批准、列出、未隐藏；公开 ZIP 全部非目录 payload 与候选匹配 |
| PC / mobile    | 最后已核验的历史客户端 `v5.0.3.145`                   | 当前下载源暂不可用；本次文档与站点更新不发行新客户端                                      |

CLI 候选尚未形成发行清单或公共回执；上述候选待验证 IDE 的发行源码仍为 `bfc3c849093d67aebfc1cc92843cf8a9229b24d6`。CLI 的 [发行清单](../research/cli/evidence/release157-public/chainlesschain-release.json)、[provenance](../research/cli/evidence/release157-public/chainlesschain-npm-provenance.json) 与 [npm 字节回读](../research/cli/evidence/release157-public/chainlesschain-npm-readback.json) 共同绑定该身份；IDE 状态见 [综合公开回执](../research/cli/evidence/release157-public/publication.json) 和 [JetBrains 公开归档核验](../research/cli/evidence/release157-public/jetbrains-public.json)。

网站构建另记录其实际文档提交、构建产物与服务器回读。将本说明部署到网站不会改变 npm/IDE 标签、安装包内容或生产权限，也不能把文档分支当作已发布二进制的来源。2026-11-19 复查时，`chainlesschain/chainlesschain` 与 `longfa/chainlesschain` 的 `v5.0.3.145` Release 查询均返回 404，现有官网目录也没有安装包备份；因此历史客户端核验不能写成当前可下载，原生下载入口须以实际源可用性为准。

## 2. LK 渠道与协议分离

LK 是渠道身份，OpenAI、Anthropic、Gemini 是请求协议。共享定义位于 [llm-channel-presets.js](../../packages/cli/src/lib/llm-channel-presets.js)。主地址为 `https://api.vv666.ai`，备用地址为 `https://api.lk666.ai`；主备切换由用户选择，不承诺自动故障转移。平台文档和价格页面使用 `chainlesschain.net/apidoc`、`chainlesschain.net/api/pricing`，不把网站域名当作模型请求 Base URL。

| LK 协议选择    | CLI / IDE provider | Base URL 路径 | 新连接默认模型    |
| -------------- | ------------------ | ------------- | ----------------- |
| OpenAI 兼容    | `custom`           | `/v1`         | `gpt-6.1-sol`     |
| Anthropic 兼容 | `anthropic`        | `/v1`         | `claude-opus-5-5` |
| Gemini 兼容    | `gemini`           | `/v1beta`     | `gemini-4-carbon` |

保存时校验协议与 Base URL 路径，已知模型必须为 `chat` 且支持所选协议。目录外的新 ID 允许显式输入，但不因此获得兼容性或账户可用性证明。Desktop Anthropic adapter 自行追加 `/v1/messages`，其连接解析使用 origin，不能直接照搬 CLI 的完整路径。媒体生成、编辑与任务状态端点是接口目录，不表示聊天选择器已实现媒体任务提交及轮询。

旧配置在 LK 连接保存、请求解析与账户价格查询中按精确别名迁移：

| 旧别名          | 规范模型 ID        |
| --------------- | ------------------ |
| `tt-6.1-sol`    | `gpt-6.1-sol`      |
| `tt-6-luna`     | `gpt-6-luna`       |
| `fb-5-2`        | `claude-fable-5-2` |
| `gem-3.8-flash` | `gemini-3.8-flash` |

映射通过 `Object.hasOwn` 限定为自身条目；未列出的名称不会按前缀猜测或升级到另一模型。新连接默认值与旧模型别名迁移是不同操作：`fb-5-2` 不迁移为新默认 Opus，Luna 也不迁移为 Sol。模型保存与运行时解析见 [连接配置](../../packages/cli/src/lib/llm-connection-config.js)、[连接解析](../../packages/cli/src/lib/llm-connection-resolution.js)；价格查询使用同一组规范 ID，见 [账户适配器](../../packages/cli/src/lib/lk-account-api.cjs)。

## 3. 目录来源与信任边界

当前 [LK 目录快照](../../packages/cli/src/lib/lk-model-catalog.json) 含 **202** 项：对话 **86**、图片 **26**、视频 **82**、音频 **8**。这是所核对源码中的快照数量，不是永久固定的服务端模型总量。聊天选择器仅使用按兼容协议筛选的 86 项对话集合，不把 202 项全部列为可聊天模型。

[目录同步脚本](../../packages/cli/scripts/sync-lk-model-catalog.mjs) 从 `/v1/skills/models` 读取模型身份；在线同步要求显式 `LK_API_KEY`，也可通过 `--input` 使用已有响应。脚本验证模型名称唯一性、类型和协议，投影为 `id / label / type / protocol / compatibleProtocols`，保留来源 URL 与原响应 SHA-256。生成目录不持久化原始账户响应、Key、额度、白名单或余额。来源摘要用于追踪输入，不是账户授权或平台签名证明。

目录显式保留 `runtimeVerified: false` 与 `accountVerified: false`。模型被列出、协议字段匹配、配置保存或目录同步成功，都不能替代该账户的实际权限检查与真实请求验证。[跨端同步脚本](../../packages/cli/scripts/sync-lk-ide-presets.mjs) 将 CLI 渠道/目录投影到 Web、VS Code 和 JetBrains，并同步 Desktop 账户适配器；这些生成副本复用定义，不获得独立授权权威。

入口排序也不等于模型质量排序。Web 新连接默认 LK / OpenAI，JetBrains 将 LK 放在 provider 列表首项；共享手动 provider 目录先列本地 OpenAI 兼容平台，再列 Ollama，见 [onboarding 目录](../../packages/cli/src/lib/llm-onboarding-catalog.json)。CLI `cc setup` 的实现仍在 provider 列表后追加 LK 入口，不能将“所有入口均 LK 第一”作为当前行为。已有连接应按保存状态恢复，而不是因新默认值自动改换模型。

## 4. 凭证与账户查询

LK 主备地址及兼容协议共享 `channel:lk` 连接身份，同一个 LK Key 可随该渠道恢复。其它渠道使用 `provider + 规范 Base URL` 隔离保存；切回火山等已保存渠道时恢复其自身凭证。新目的地缺少所需 Key 时拒绝保存，不将刚才渠道的 Key 借给新目的地。[saveLlmConnection](../../packages/cli/src/lib/llm-connection-config.js) 在同一个锁和原子写入中更新端点与凭证引用；UI 只接收连接字段及 `hasKey`，不通过配置投影取得密钥明文。

这项隔离描述的是保存配置与恢复路径。显式命令参数、环境变量和 key helper 仍按 [运行时连接解析](../../packages/cli/src/lib/llm-connection-resolution.js) 的优先级处理，不能据此宣称所有请求都忽略环境变量。只读账户入口则显式使用已保存 LK 连接、以 `env: {}` 解析，避免借用通用 provider 环境 Key，见 [queryLkAccount](../../packages/cli/src/lib/lk-account.js)。

账户查询使用当前保存的 LK Key 请求 `/v1/skills/balance`、`/v1/skills/usage`、带 `detail=1` 的用量明细，以及 `/v1/skills/models/{model}/pricing`。仅允许官方主备 HTTPS origin 与 `/v1` 或 `/v1beta` 基路径；每次请求限时 12 秒、拒绝重定向、解码响应最多 2 MiB。接口响应经显式字段白名单投影，不落账户磁盘缓存。四部分独立查询，部分失败显示 `partial` 及对应错误，不能把未知余额或失败价格显示成零。

金额口径必须分开：

- 余额、Key 额度、用量与账单使用平台 **算力**。Key 限额 `0` 表示不限额，不是无可用额度。
- 动态价格按路由分组展示。按 Token 计费时单位是 **算力 / 百万 Token**，其它计费方式使用基础价；当前折扣、分组启用状态、Key 白名单及排除状态影响可用性。
- 真实 API 账单含任务、模型、分组、状态、实扣及退款信息，**没有 Token 数**。运行中记录可能仍是预扣；当前可用分组或价格不是某次调用最终路由的证明。
- 模型响应 Token 用量、本地美元估算与平台账单算力是不同数据源。不能由余额差额、估算值或时间相近自动认领单次请求账单，也不自动将算力折算为充值现金成本。小额显示为 `0` 不代表免费。

## 5. 重复输出恢复与治理边界

当前 [ReadFileLoopGuard](../../packages/cli/src/lib/read-file-loop-guard.js) 对 `run_code / run_shell / check_shell` 的 `output / stdout / stderr` 统一识别大输出重复。宿主拥有的原始输出身份可携带完整长度与摘要，短预览不能冒充完整内容。JSON 克隆后的短预览失去宿主身份：当可见输出小于 8000 字符且没有对应的大输出宿主身份时，将本批标为有进展，清除继承的重复批次计数；这不授予原始输出 fingerprint，也不证明完整文件已被阅读。

真正重复的大输出仍计入守卫，合成的 `CC_TOOL_RECOVERY_PAUSED` 不反过来累加自己的重复次数，恢复控制帧与真实工具观察分离。本次逐文件对比确认该守卫及 LK 连接配置、请求解析在 `8c937cbe9` 与发行 `a8cae8928` 中相同；不能仅依据当前分支提交顺序将其称作发行后的新功能或新模型任务成绩。

上述运行时恢复与 IDE 操作授权分开。JetBrains Workbench 操作仍需 [freshPreview](../../packages/jetbrains-plugin/src/main/java/com/chainlesschain/ide/intellij/SessionsWorkbenchToolWindowFactory.java) 重新获取并校验当前动作预览；旧 UI 状态、旧 receipt、重复输出恢复或新渠道配置均不赋予 resume、审批、执行或 promotion 权限。

## 6. 验证与保留项

发行门绑定 `bfc3c849093d67aebfc1cc92843cf8a9229b24d6`：CLI CI run `44222103058`、Strict Sandbox run `44222103031`，npm OIDC run `44222103142`；公共 tarball 的 SHA-256 为 `18be9e5baea37169585985c3d56ac9c051d18b43040007b247a969dfc615ea16`。后续文档审计或新分支 CI 不替代这组发行门，也不改变已签来源。

JetBrains macOS 首轮两个宿主的 needs-input visibility P95 分别为 **2000 ms / 2015 ms**，违反严格 **P95 < 2000 ms** 的门禁。保留 [首轮失败样本](../research/cli/evidence/release157-public/jetbrains-macos-attempt1.json) 后，同一不可变 SHA 的失败 job 只重跑一次，未修改代码、阈值或测量链；[第二轮独立样本](../research/cli/evidence/release157-public/jetbrains-macos-attempt2.json) 的 P95 分别为 **1258 ms / 1980 ms**。两轮样本不合并，canonical 恢复成功也不补造不存在的延迟序列。

Marketplace 审核完成后，公开 ZIP 的 SHA-256 为 `1a4d04397b2dfa80205b8272bd95d81daf1e856ed707b71bcd600fba42e1cddf`，候选 ZIP 为 `5daa5ddc63b374908aa2a7ac6f90f5f5f96dc50ba7d3ee8912dcba548cff1a9a`。重新打包使整体 ZIP 不同；全部非目录 payload 恰为两个 JAR，名称集合及文件字节严格一致，无额外 payload。另解析 `plugin.xml` 的版本和 `CliVersionCheck.class` 的推荐 CLI 常量，才认定 [公开核验通过](../research/cli/evidence/release157-public/jetbrains-public.json)。

本说明与网站部署没有新增付费模型任务验收，也不将目录条数、测试数量、源码组合、历史任务或发行成功转换成产品效果成绩。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。Module 112 的 candidate、独立 Eval、review、promotion、release authority、部署签名与 RRSI 局部证明范围不变，见 [受治理 Skill 演进设计](modules/112-governed-skill-evolution-design.md)。Desktop 源码有 LK 配置和账户能力不等于历史 `v5.0.3.145` 安装包已包含本轮代码，该版本当前下载源也暂不可用；原生功能、新安装包与目标生产部署仍需各自独立证据。

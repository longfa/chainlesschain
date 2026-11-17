# LK API 聚合渠道

根据 [开发文档](https://chainlesschain.net/apidoc)及其公开模型目录接入。
主地址为 `https://api.vv666.ai`，备用为 `https://api.lk666.ai`，域名使用字母 `lk`。
两者为同一服务，可手动切换；不会在失败后自动重发生成请求。

桌面端：设置 → LLM 服务设置 → LK API，选择协议、模型和主备地址，点击「使用此渠道」，填写渠道 API Key 后保存或测试连接。
各渠道分别保存凭证，切回已保存渠道时留空自动恢复，无需重填；LK 的主备地址和三个协议共用同一份渠道 Key。新接口不会使用其他服务的凭证。

CLI：运行 `cc setup`，选择 `LK API`，再选择协议、主备地址及模型。
Web：运行 `cc ui`，进入「LLM 配置 → LLM 参数设置」，服务渠道选择 `LK API 聚合平台`，再选择协议、主备地址及模型，首次填写渠道 API Key 并保存。也可在模型输入框填写已有别名，或从「已保存渠道」恢复火山等服务。保存后回读确认，测试连接仅对已保存配置生效；新聊天或 Agent 会话使用新连接。Web 页面随 CLI 包发布。

VS Code 与 JetBrains：打开「配置大模型 / Configure LLM」，服务类型选择 `LK API 聚合平台`，再选择兼容协议、主备地址和模型目录中的模型。已有自定义别名回读时保留；「已保存渠道」可恢复之前的连接和凭证，LK 主备切换无需重填 Key。
保存的 provider 是现有协议身份（`custom`、`anthropic`、`gemini`），不新增虚假的协议类型。
已有凭证在首次保存/切换时自动纳入各自连接档案，CLI、Web 与 IDE 共用同一配置。桌面端保留原有独立的加密配置存储，也支持保存和恢复各渠道。不会自动读取账户或执行生成请求。

## 模型目录

本次公开目录共 197 个模型：83 个对话、25 个图片、81 个视频、8 个音频。
完整模型 ID、展示名称、类型和兼容协议保存在
[lk-model-catalog.json](../../packages/cli/src/lib/lk-model-catalog.json)。
这是平台公开目录，不代表某个账户已获得模型权限或已完成实测。

| 示例模型        | 协议                                          | CLI Base URL（主）                           | 桌面 Base URL（主）           |
| --------------- | --------------------------------------------- | -------------------------------------------- | ----------------------------- |
| `tt-6-luna`     | OpenAI Chat Completions；文档另支持 Responses | `https://api.vv666.ai/v1`，provider `custom` | `https://api.vv666.ai/v1`     |
| `fb-5-2`        | Anthropic Messages                            | `https://api.vv666.ai/v1`                    | `https://api.vv666.ai`        |
| `gem-3.8-flash` | Gemini                                        | `https://api.vv666.ai/v1beta`                | `https://api.vv666.ai/v1beta` |

对话模型按声明的兼容协议筛选。桌面 Anthropic 客户端自行添加 `/v1/messages`，因此 Base URL 不带 `/v1`。
OpenAI 渠道预设使用 Chat Completions；目录中的 Responses 支持记录不表示本预设启用了 Responses。
图片、视频、音频模型在桌面接口参考中可查看文档，不会作为对话模型发送到聊天接口。
本次包含媒体模型目录和接口参考，未增加媒体任务提交、轮询界面或自动读取 Skills 的任务流程。

## 五类接口

以下路径拼接主或备用域名，鉴权按所选协议及模型文档配置。

| 类型                          | 路径                                                                                                                                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                        | `/v1/chat/completions`、`/v1/responses`、`/v1/models`                                                                                                                                                    |
| OpenAI 图片（仅部分图片模型） | `/v1/images/generations`、`/v1/images/edits`                                                                                                                                                             |
| Anthropic                     | `/v1/messages`                                                                                                                                                                                           |
| Gemini                        | `/v1beta/models/{model}:generateContent`；流式为 `streamGenerateContent?alt=sse`                                                                                                                         |
| 媒体生成                      | `POST /v1/media/generate`、`GET /v1/media/status?task_id={task_id}`、`GET /v1/media/models`                                                                                                              |
| Skills                        | `/v1/skills`；模型 `/v1/skills/models`、定价 `/v1/skills/models/{model_name}/pricing`、余额 `/v1/skills/balance`、用量 `/v1/skills/usage`、任务状态 `/v1/skills/task-status`、反馈 `/v1/skills/feedback` |

## 定价与刷新

[平台定价页](https://chainlesschain.net/api/pricing)提供当前价格入口。匿名查询公开模型广场虽返回 200，但本次返回的价格字段全部为空；因此不能用匿名目录作为实际计费依据。运行时使用已保存 LK 连接的 API Key，通过 Skills 接口实时查询账户价格、余额和账单，不缓存到账户文件，也不把账户数据写入公共模型目录。

```sh
cc llm account
cc llm account --days 7 --scope user --model tt-6-luna --json
cc llm account --days 30 --limit 20 --offset 20
```

`--scope key`（默认）查询当前 Key 的 API 消费；`--scope user` 查询账户全部 API Key。时间窗口为 1–30 天，账单分页最多 200 条。查询不会发起模型生成请求。CLI 必须先保存 LK 连接及其自己的 Key，不会使用其他服务的环境变量密钥。

Web 的「LLM 配置 → LK 动态价格与实际账单」可选择时间范围、Key 范围并翻页。VS Code 和 JetBrains 的模型配置页也有「刷新价格与余额」按钮，显示最近一天当前 Key 的账单；更多范围使用上述 CLI 命令。修改连接后先保存再查询。

- 余额、Key 额度和价格的单位为平台「算力」。余额为账户总额；Key 的限额为 0 表示不限额，不等于剩余 0。未返回的数值显示未知。
- Token 价格为算力 / 百万 Token；当前分组价格已含时段折扣，不重复折扣。多个分组、停用状态、Key 权限分别展示；平台动态路由，不能用最低单价代替实际账单。
- 账单金额直接读取平台 `cost`，退款已计入净额，不再减一次。运行中任务可能仍显示预扣，稍后刷新查看结算；金额保留四位，小额显示 0 不代表免费。
- 模型返回的实际 Token 数可在 Token 统计中查看。Skills 账单没有 Token 数，暂不将本地单次请求和平台任务强行对应；本地美元估算与平台实扣算力分别展示。
- API 用量不包含网页聊天等全部消费，不能用账户余额差额当作某次请求费用。算力不自动折算含赠送等因素的实际充值现金成本。
- 所有数据带查询时间；局部查询失败有明确提示，刷新失败不会继续把旧余额展示为当前数据。

刷新公开目录（不读取密钥、不发送模型生成请求）：

```sh
node packages/cli/scripts/sync-lk-model-catalog.mjs
node packages/cli/scripts/sync-lk-ide-presets.mjs
```

也可传入公开接口响应文件进行离线更新：

```sh
node packages/cli/scripts/sync-lk-model-catalog.mjs --input path/to/models.json
```

更新脚本校验模型 ID、类型、协议和重复项后写入目录，保留来源 URL 和源响应 SHA-256。
刷新后运行 `node --test packages/cli/test-node/lk-channel.node-test.mjs`。

## 本次验证

- Web 全部 130 个单元测试文件、2490 项测试及生产构建通过；配置、凭证保留、动态账单和认证路由相关 CLI 回归 142 项通过，桌面投影及授权回归 16 项通过。
- 8 项 Node 回归检查通过：覆盖 IDE 目录同步、全部 83 个对话模型的主备路径、协议错配拒绝、媒体模型隔离、桌面预设切换及凭证归属。
- VS Code 全部 392 项回归通过；JetBrains 修改使用 JDK 21 编译并通过原生 Swing 表单 smoke 检查，完整宿主矩阵以官方 CI 为准。
- 桌面设置组件的 Vue script/template 编译通过；没有执行整仓构建或完整 E2E。
- 主地址真实最小生成请求：`tt-6-luna`（Chat Completions）、`fb-5-2`（Messages）、`gem-3.8-flash`（Gemini）均 HTTP 200 且有文本输出；三者价格查询也均 HTTP 200。
- 该 Key 的 Skills 对话目录返回 83 项，其中 3 项标记 `available_for_this_key=false`；公共模型目录不等同于账户权限。未逐个执行全部模型，也未提交媒体生成任务。
- 密钥仅读取自用户指定文件，不进入源码、公共目录或验证记录。
- 新增账户适配器的余额、用量汇总、账单明细和动态定价真实只读查询全部成功；验证记录只输出成功状态，不输出账户金额或密钥。

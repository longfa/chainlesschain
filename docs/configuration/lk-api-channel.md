# LK API 聚合渠道

根据 [开发文档](https://quexuan.net/apidoc)及其公开模型目录接入。
主地址为 `https://api.lk888.ai`，备用为 `https://api.lk666.ai`，域名使用字母 `lk`。
两者为同一服务，可手动切换；不会在失败后自动重发生成请求。

桌面端：设置 → LLM 服务设置 → LK API，选择协议、模型和主备地址，点击「使用此渠道」，填写渠道 API Key 后保存或测试连接。
首次切入渠道会清除目标协议原有的其他服务密钥；在本渠道主备地址间切换可保留已填写的渠道密钥。

CLI：运行 `cc setup`，选择 `LK API`，再选择协议、主备地址及模型。
VS Code 与 JetBrains：打开「配置大模型 / Configure LLM」，服务类型选择 `LK API 聚合平台`，再选择兼容协议、主备地址和模型目录中的模型。已有自定义别名回读时保留；主备切换后的新地址需要重新填写该渠道密钥。
保存的 provider 是现有协议身份（`custom`、`anthropic`、`gemini`），不新增虚假的协议类型。
已有配置不会自动迁移，也不会自动读取账户或执行生成请求。

## 模型目录

本次公开目录共 197 个模型：83 个对话、25 个图片、81 个视频、8 个音频。
完整模型 ID、展示名称、类型和兼容协议保存在
[lk-model-catalog.json](../../packages/cli/src/lib/lk-model-catalog.json)。
这是平台公开目录，不代表某个账户已获得模型权限或已完成实测。

| 示例模型        | 协议                                          | CLI Base URL（主）                           | 桌面 Base URL（主）           |
| --------------- | --------------------------------------------- | -------------------------------------------- | ----------------------------- |
| `tt-6-luna`     | OpenAI Chat Completions；文档另支持 Responses | `https://api.lk888.ai/v1`，provider `custom` | `https://api.lk888.ai/v1`     |
| `fb-5-2`        | Anthropic Messages                            | `https://api.lk888.ai/v1`                    | `https://api.lk888.ai`        |
| `gem-3.8-flash` | Gemini                                        | `https://api.lk888.ai/v1beta`                | `https://api.lk888.ai/v1beta` |

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

[平台定价页](https://quexuan.net/api/pricing)提供当前价格入口。直接查询该页价格接口返回 401（需要登录）；随后使用用户授权的 API Key 查询三个示例模型的 Skills pricing 接口均返回 200。价格响应包含多条渠道分组、启用状态、白名单状态和时段折扣，没有将这些账户相关数据写入公共目录或费用估算。
需要账户定价时，使用渠道自己的 API Key 查询文档中的 Skills pricing 接口；可用性也应以该 Key 的返回结果为准。

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

- 8 项 Node 回归检查通过：覆盖 IDE 目录同步、全部 83 个对话模型的主备路径、协议错配拒绝、媒体模型隔离、桌面预设切换及凭证归属。
- VS Code 相关回归 36 项通过；JetBrains 修改使用 JDK 21 编译并通过原生 Swing 表单 smoke 检查，完整宿主矩阵以官方 CI 为准。
- 桌面设置组件的 Vue script/template 编译通过；没有执行整仓构建或完整 E2E。
- 主地址真实最小生成请求：`tt-6-luna`（Chat Completions）、`fb-5-2`（Messages）、`gem-3.8-flash`（Gemini）均 HTTP 200 且有文本输出；三者价格查询也均 HTTP 200。
- 该 Key 的 Skills 对话目录返回 83 项，其中 3 项标记 `available_for_this_key=false`；公共模型目录不等同于账户权限。未逐个执行全部模型，也未提交媒体生成任务。
- 密钥仅读取自用户指定文件，不进入源码、公共目录或验证记录。

# LK API 聚合渠道

平台文档已列出 [GPT-6.2 Sol](https://chainlesschain.net/apidoc#model/gpt-6.2-sol) 和 [GPT-6.2 Astra](https://chainlesschain.net/apidoc#model/gpt-6.2-astra)，两者支持 OpenAI Chat Completions 和 Responses。
主地址 `https://api.vv666.ai`，备用 `https://api.lk666.ai`，手动切换地址；不会自动重发生成请求。

CLI **0.166.156**、Open VSX **0.37.192** 与 JetBrains **0.4.207** 均已公开验证；两款 IDE 推荐 CLI .156。完整发布顺序与限制见 [更新说明](../../docs-site/docs/chainlesschain/cli-ide-update-2026-11-18-156.md)。

## 模型配置

CLI 执行 `cc setup`；Web 执行 `cc ui` 后进入 LLM 配置；IDE 打开 Configure LLM。选择 LK、协议、模型和主备地址，填写 LK 自己的 Key，保存后测试连接。每个平台的 Key 独立保存，LK 主备地址及协议共用 LK 凭据。修改连接后先保存再查询账户。

当前源码中的 CLI、Web、VS Code、JetBrains 和桌面设置会在打开模型配置时请求平台公开目录。设置界面的「刷新模型」可以重新查询，并保留正在编辑的模型 ID。请求失败时使用安装包内置目录。JetBrains 的在线查询由配套 CLI 提供。

用 `cc llm models --provider lk --json` 查看目录，`source` 为 `live` 表示刚从平台取得，为 `bundled` 表示使用内置目录。2026-11-23 的内置快照包含 205 项，其中 89 个对话、26 个图片、83 个视频和 7 个音频模型。下拉框按协议筛选对话模型。账户可用性和推理结果需用自己的 LK Key 验证。

| 协议                    | 当前模型示例                   | CLI / IDE Base URL                           | 桌面 Base URL                 |
| ----------------------- | ------------------------------ | -------------------------------------------- | ----------------------------- |
| OpenAI Chat Completions | `gpt-6.2-sol`、`gpt-6.2-astra` | `https://api.vv666.ai/v1`，provider `custom` | `https://api.vv666.ai/v1`     |
| Anthropic Messages      | `claude-opus-5-5`              | `https://api.vv666.ai/v1`                    | `https://api.vv666.ai`        |
| Gemini                  | `gemini-4-carbon`              | `https://api.vv666.ai/v1beta`                | `https://api.vv666.ai/v1beta` |

保存的旧别名按相同模型系列迁移：`tt-6.1-sol` → `gpt-6.1-sol`，`tt-6-luna` → `gpt-6-luna`，`fb-5-2` → `claude-fable-5-2`，`gem-3.8-flash` → `gemini-3.8-flash`。未知自定义别名保留，不切换到其他系列。

## 动态价格与账单

```sh
cc llm account
cc llm account --days 7 --scope user --model gpt-6.1-sol --json
cc llm account --days 30 --limit 20 --offset 20
```

查询使用已保存 LK 连接自己的 Key，通过四个只读请求获取余额、用量汇总、分页账单和模型分组价格。`--scope key` 为当前 Key，`--scope user` 为全部 Key；天数 1–30、分页最多 200 条。Key 不进入命令参数或查询结果，不使用其他服务环境变量凭据。

余额和价格单位为算力；Key 限额 0 表示不限额。Token 价格为算力/百万 Token，包含当前时段折扣；实际路由及费用以账单为准。账单 `cost` 已计入退款，不重复扣减。运行中的任务可能仍显示预扣，刷新后查看结算。账单不含 Token 数，不能与本地单次请求自动对应，也不把算力折算为充值现金成本。局部查询失败会明确提示，旧余额不会继续显示为当前数据。

## 目录维护

安装包的离线快照可以从开发文档使用的公开目录重新生成。

```sh
node packages/cli/scripts/sync-lk-model-catalog.mjs --public
node packages/cli/scripts/sync-lk-ide-presets.mjs
node --test packages/cli/test-node/lk-channel.node-test.mjs
```

省略 `--public` 可继续用 Skills API 生成快照，通过进程环境提供 `LK_API_KEY`，或用 `--input path/to/skills-models.json` 读取已有响应。公开目录和生成快照仅使用模型标识、显示名称、类型与协议。

## 本轮验证

- 获授权的最小 `gpt-6.1-sol` Chat Completions 请求返回 HTTP 200 和文本。
- 使用真实接口运行账户适配器，余额、用量、价格、账单均成功；验证记录不保留 Key 或账户金额。
- CLI、Web、VS Code、JetBrains 共享生成目录；具体发布以当前提交的 Actions 门禁和公开渠道回读为准。
- 不声称逐个实测全部模型，不发布新的 PC/mobile 安装器，聊天设置不执行媒体任务提交或轮询。

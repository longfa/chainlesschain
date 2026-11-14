# CLI 0.166.150 与 IDE LK 渠道接入

本次候选配套版本为 CLI **0.166.150**、VS Code/Open VSX **0.37.189**、JetBrains **0.4.204**。发布状态以官方 Actions 和公开下载核验为准；本页准备时尚未宣称这些版本已公开。

## 配置 LK 聚合平台

运行 `cc setup` 并选择 LK API，或在 IDE「配置大模型」的服务类型中选择 **LK API 聚合平台**。选择协议、主备地址和模型，再输入渠道 API Key 并保存。主地址为 `https://api.lk888.ai`，备用为 `https://api.lk666.ai`，域名使用字母 `lk`。更换地址需要填写对应渠道密钥。

共享目录包含 83 个对话、25 个图片、81 个视频和 8 个音频模型。对话选择器按平台声明的协议筛选；媒体目录和接口文档不等同于已实现媒体任务提交或轮询。

| 示例模型        | 协议                    | CLI / IDE Base URL            |
| --------------- | ----------------------- | ----------------------------- |
| `tt-6-luna`     | OpenAI Chat Completions | `https://api.lk888.ai/v1`     |
| `fb-5-2`        | Anthropic Messages      | `https://api.lk888.ai/v1`     |
| `gem-3.8-flash` | Gemini                  | `https://api.lk888.ai/v1beta` |

已有模型别名在加载配置时保留。平台目录不代表当前 Key 拥有所有模型权限；以 Skills 接口的 `available_for_this_key` 和实际请求结果为准。
价格按渠道分组、启用状态、白名单和时段折扣变化，不将账户价格写入公共目录。

[平台开发文档](https://quexuan.net/apidoc) · [平台定价](https://quexuan.net/api/pricing)

## 验证与发布次序

三个示例模型均完成主地址最小请求并返回文本，其账户定价查询均返回 HTTP 200。这些请求没有验证全部模型或媒体任务。

发布前要求同一提交的 Linux、Windows、macOS CLI CI 和 CLI Strict Sandbox 全部成功。通过 GitHub Actions OIDC 发布 CLI，核验公开 npm 包和上游依赖后，才发布 IDE 插件。子 npm 包版本不变；移动端和 PC 客户端不在本次发布范围内。

发布核验完成后安装：

```sh
npm i -g chainlesschain@0.166.150 --registry https://registry.npmjs.org
cc --version
cc doctor
```

IDE 升级后重启宿主；JetBrains Marketplace 审核状态与插件上传成功分开记录，Microsoft Marketplace 不由 Open VSX 标签发布自动覆盖。

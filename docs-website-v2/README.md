# ChainlessChain 官方网站

## 2026-11-19 文档与网站同步

按最新源码 `8c937cbe9bc4b82f87479c124375401fa2fb3a72` 与 Git 记录核对。CLI **0.166.156**、Open VSX **0.37.192**、JetBrains **0.4.207** 均已公开验证，两款 IDE 推荐 CLI .156；发行来源为 `a8cae89288d3a6119b152e04b750e10d726a5c5f`，与网站部署提交分别记录。LK 主备为 `api.vv666.ai` / `api.lk666.ai`，默认 OpenAI 兼容模型 `gpt-6.1-sol`，目录为 **202 项 / 86 项对话模型**，支持动态算力价格与实际 API 账单。

安装 `npm i -g chainlesschain@0.166.156 --registry https://registry.npmjs.org`，重启宿主并核对 `cc --version`。历史客户端最后核验为 **v5.0.3.145**，当前旧下载源返回 404，本轮不发新 PC/mobile 安装包。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 与历史模型任务成绩范围保留。[用户指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-19-156.html) · [设计说明](https://design.chainlesschain.com/release-runtime-update-2026-11-19-156.html)。下列带日期记录保留历史范围。

## 2026-11-15 官网发布状态

官网当前公开版本为 CLI **0.166.150**、Open VSX **0.37.189**、JetBrains **0.4.204**，两款 IDE 推荐 CLI .150；准确发行源码 `b2af25c65d34f1ee34cdddf308b5a8e57bb4f198`。LK 渠道公开 197 项模型目录，其中 83 项对话模型可按协议筛选用于聊天；主备字母域名共用 Key，各渠道（含火山）保存后可切回恢复。动态价格、余额、Key 额度和真实 API 账单以平台算力计，账单没有 Token 数。桌面源码支持账户查询，公开客户端仍为 **v5.0.3.145**。[发行证据](https://github.com/longfa/chainlesschain/blob/main/docs/research/cli/evidence/release150-public/publication.json) · [本轮设计](https://design.chainlesschain.com/release-runtime-update-2026-11-15-150.html)。

## 2026-11-13 官网发布状态

Website release status now tracks CLI `0.166.148`, Open VSX `0.37.187`, and JetBrains `0.4.202` upload status. The website distinguishes public channels from the Marketplace pending-review build and exposes the self-evolution governance boundary.

## 2026-11-09 当前发行与主线核对

公开组合 **CLI 0.166.145 / Session Core 0.3.27 / Open VSX 0.37.181 / JetBrains 0.4.198**，两款 IDE 推荐 CLI .145。Open VSX 下载突破 **7 万+**（项目方确认）。PC/mobile 仍为 **v5.0.3.145**；源码产品 .146 与 VS Code .182 不作为已发布下载推荐。

主线 `c34a664f42` 完善模型实际输入诊断、REPL 恢复、MCP Tasks、Memory、宿主故障定位和持久计费窗口。它们按各自源码及证据范围判断，不全部归入公开 .145。CLI .145 已含 `goal transfer-to-project`；原生导入需匹配新桌面并显式确认。发行源 CLI CI **75 成功、1 跳过** / Strict Sandbox **6 成功**；文档更新不新增模型任务验收。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留，历史 **2/4** 等成绩不合并为当前版本成绩。

[本轮用户指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-09-145.html) · [运行时设计](https://design.chainlesschain.com/release-runtime-update-2026-11-09.html)

以下带日期段落保留历史范围；构建和部署方式仍适用。

`www.chainlesschain.com` 的 Astro 源码。2026-11-06 核对：CLI **0.166.143**、Session Core **0.3.26**、Open VSX **0.37.179** 和 JetBrains **0.4.196** 已公开核验，两个 IDE 推荐 CLI .143；不可变发行源码为 `3fa3a4b258bbcb60b23b4298cec375661ad6f410`。本轮说明本地算力配置、端点凭据隔离、待审创建请求和逐次授权模型草稿的边界。客户端 **v5.0.3.145** 已独立公开，但较早产品源码不包含本批新增原生 v6 创建/模型起草。真实特性 GUI、力数推理、业务效果与灰度迁移回退仍待独立验收；本次文档部署不发起模型请求。

## 内容来源

- `src/data/release-status.json`：经过发行门禁及公共回读的版本、源码与验收边界。
- `src/data/release-sizes.json`：原生产品下载文件大小缓存。
- `src/components/SourceUpdate.astro`：中英文版本、源码交付、任务保留与复验边界。
- `src/pages/`：官网中英文页面。
- `../docs/design/`：设计文档权威源；两个 VitePress 站点通过同步脚本复制。

更新公开版本前，核对 `../docs/research/cli/evidence/release143-public/README.md` 等对应发行回执。保留 CLI、IDE、原生产品的独立源码与版本，历史真实模型验收统计继续注明所属轮次。

## 本地构建

需要 Node.js **22.12.0+** 和 npm **10+**：

```bash
npm ci --workspaces=false --ignore-scripts --no-audit --no-fund
npm run build
```

默认构建先更新下载大小缓存，再输出 `dist/`。开发使用 `npm run dev`。

## 三站部署

三个站点的部署源分别为 `docs-site`、`docs-site-design`、`docs-website-v2`。最终部署先更新并提交缓存和文档，再从该提交重新构建三个站点，确保 `deployment-source.json` 记录的源码与产物一致。

在官网目录先运行 `npm run fetch:sizes`，提交相关源码后使用 `npm exec --offline -- astro build` 完成固定快照构建；两个文档站分别运行 `npm run build`。从仓库根运行：

```powershell
powershell -NoProfile -File scripts/deploy-docs-snapshot.ps1
```

现有脚本通过已信任的 SSH 主机向 `/www/wwwroot/` 下三个站点上传压缩包，校验 SHA-256、页面数量及本轮版本，再使用互斥锁、独立 staging、备份和失败回滚切换目录。完成后核对公网新页面、首页和 `deployment-source.json`。保留脚本打印的备份目录与部署编号。

## 当前文档与验收范围

- [CLI / IDE 升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-06-143.html)
- [自进化开关配置](https://docs.chainlesschain.com/chainlesschain/self-evolution-configuration.html)
- [图片预算与会话恢复](https://docs.chainlesschain.com/chainlesschain/agent-input-and-recovery.html)
- [最新运行时设计](https://design.chainlesschain.com/release-runtime-update-2026-11-06-143.html)

本轮没有新增真实模型任务验收。Sol 原冻结项目 **41/45**、含修正项目的跨版本累计 **45/45**、独立修正四项 **2/4** 分别保留；**NOT_PAID_READY / NOT_ADMITTED / HOLD** 不变。文档部署不会重新发布 npm、IDE 或原生产品制品。

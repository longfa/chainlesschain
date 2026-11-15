# 时钟与进程故障的诊断回归

本次补充 [#573](https://github.com/chainlesschain/chainlesschain/issues/573) 与 [#579](https://github.com/chainlesschain/chainlesschain/issues/579) 的受控诊断回归。产品代码、授权窗口、清理信号与原十秒存活断言均未改变。

## 历史读取的混合时钟窗口

`packages/cli/__tests__/unit/evolution-artifact-history-read.test.js` 构造两个历史条目：第一次授权已过期，同时最终时钟低于另一条目的检查时钟。完整读取仍抛出原 `history-clock-window` 错误，不释放部分结果；故障收据同时保留 `expiredCount=1` 与 `backwardCount=1`，以及窗口数量、剩余时间、读取年龄和耗时。回归也固定原检查次数，防止收集诊断时多读时钟而改变授权判断。

这验证了同次故障可以具有两种条件，不能把整个拒绝事件强行归为单一原因。原始 Windows 失败没有这些数值，受控注入不能重建其历史时钟状态。

## POSIX 进程状态的证据边界

`scripts/__tests__/verify01-diagnostic-process.test.mjs` 覆盖活进程、僵尸、进程组变化及进程启动秒数变化的收据。正 PID 的 signal-zero 查询成功不保证进程仍可运行；进程组查询失败不保证正 PID 已消失。收据保留这些不同观察结果，不自动改写清理成功与否。

`ps lstart` 的秒级精度不能排除同一秒内的 PID 复用，因此相同启动字符串不构成唯一身份。受控快照只验证诊断字段和隐私约束，不代表在 Windows 本机复现了 Darwin 原始 survivor。

## 本地验证

- 完整历史读取测试文件：18 项通过。
- `node --test --test-name-pattern 'POSIX survivor' scripts/__tests__/verify01-diagnostic-process.test.mjs`：5 项通过。
- 两个文件语法检查及 `git diff --check` 通过。

上述是本地受控回归结果。原生宿主 CI 和原始事故分类分别记录，不能将单元测试通过当作原始事故已经修复或生产准入证据。

## 后续分类条件

#573 需要真实同类故障的 clock-window 收据，区分过期、时钟倒退或两者共存。#579 需要实际 survivor 的前后 PID、启动信息、进程组、状态和探测 errno；若这些信息仍无法证明唯一身份，应继续标记不确定。

在取得这些证据前保留两个 Issue 的开放状态及原始失败记录。

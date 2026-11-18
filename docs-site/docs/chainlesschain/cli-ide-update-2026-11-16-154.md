# CLI 0.166.154 and IDE pairing candidate

## 概述

Historical candidate .154 was stopped and was not published. See [public CLI .156](./cli-ide-update-2026-11-18-156) for the current installation and LK fixes. Pairings below describe the original candidate.

This candidate fixes a recovery-loop gap in the CLI. Large repeated output from `run_code`, `run_shell` and background `check_shell` polling now uses one bounded fingerprint path across `output`, `stdout` and `stderr`. Repeating the same background evidence can no longer bypass the six-batch no-progress backstop.

The release candidates are:

- CLI `0.166.154`
- VS Code / Open VSX `0.37.191`
- JetBrains `0.4.206`

The IDE candidates recommend CLI `0.166.154`. Release order is CLI first, followed by public npm and provenance readback, then the VS Code and JetBrains tag workflows. The CLI tag must pass the exact-source CLI CI and CLI Strict Sandbox Linux, Windows and macOS matrices before OIDC publication. IDE tags must pass their exact-source host, packaging and marketplace gates and verify the public CLI prerequisite.

Until those workflows and public artifact checks complete, the verified public pairing remains CLI `0.166.150`, VS Code `0.37.189` and JetBrains `0.4.204`.

## 核心特性

Repeated tool output is fingerprinted across output, stdout and stderr; background polling follows the same six-batch no-progress backstop.

## 系统架构

The CLI recovery loop owns progress detection. IDE bridges recommend the paired CLI rather than implementing an independent recovery policy.

## 配置参考

There is no new configuration switch. The bounded recovery policy applies to run_code, run_shell and check_shell output.

## 性能指标

The no-progress bound is six repeated batches. No throughput or model-task performance improvement is claimed.

## 测试覆盖

Release eligibility requires the exact-source Linux, Windows and macOS CLI CI and Strict Sandbox matrices. This historical candidate did not complete publication; its partial checks are not release approval.

## 安全考虑

Recovery bounds remain enforced. Publication uses Actions OIDC and immutable source tags; child packages must be verified before the CLI, and the public CLI before IDE publication.

## 故障排查

If repeated background output makes no progress, inspect the original tool output and recovery reason. Do not reset the counter merely by moving repeated content between stdout and stderr.

## 关键文件

The implementation is in `packages/cli/src/lib/agent-core.js`; the release gate is `.github/workflows/npm-publish.yml`.

## 使用示例

For the current public fix, install `npm i -g chainlesschain@0.166.156 --registry https://registry.npmjs.org`, restart IDE hosts and check `cc --version`.

## 相关文档

[Current public CLI and LK release](./cli-ide-update-2026-11-18-156). No new PC/mobile installer was included in this candidate.

# CLI 0.166.154 and IDE pairing candidate

This candidate fixes a recovery-loop gap in the CLI. Large repeated output from `run_code`, `run_shell` and background `check_shell` polling now uses one bounded fingerprint path across `output`, `stdout` and `stderr`. Repeating the same background evidence can no longer bypass the six-batch no-progress backstop.

The release candidates are:

- CLI `0.166.154`
- VS Code / Open VSX `0.37.191`
- JetBrains `0.4.206`

The IDE candidates recommend CLI `0.166.154`. Release order is CLI first, followed by public npm and provenance readback, then the VS Code and JetBrains tag workflows. The CLI tag must pass the exact-source CLI CI and CLI Strict Sandbox Linux, Windows and macOS matrices before OIDC publication. IDE tags must pass their exact-source host, packaging and marketplace gates and verify the public CLI prerequisite.

Until those workflows and public artifact checks complete, the verified public pairing remains CLI `0.166.150`, VS Code `0.37.189` and JetBrains `0.4.204`.

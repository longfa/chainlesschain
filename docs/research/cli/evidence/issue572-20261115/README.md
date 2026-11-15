# Codex 冷扫描修复版本对照

Windows x64 上以官方 npm 二进制验证稳定版 0.169.0 和候选版 0.171.0-alpha.5。所有记录均为生成的 legacy rollout，使用隔离 HOME / CODEX_HOME，无 thread/start、turn/start 或模型调用，不读取真实用户历史。

| 空索引场景                  | 稳定版冷升序 | 候选版冷升序 | 稳定版冷降序 | 候选版冷降序 |
| --------------------------- | ------------ | ------------ | ------------ | ------------ |
| 2 条 / limit 1 / 不同 mtime | 1/2          | 2/2          | 2/2          | 2/2          |
| 5 条 / limit 2 / 不同 mtime | 2/5          | 5/5          | 5/5          | 5/5          |
| 5 条 / limit 1 / 相同 mtime | 1/5          | 3/5          | 2/5          | 2/5          |

候选版的部分索引场景也在相同 mtime 时提前结束：升序 3/5、降序 2/5。缺失身份的结果均提前返回终止游标；之后全量修复恢复完整，不能替代首次扫描结果。

`issue572-validation-summary.json` 包含二进制版本及 SHA256、脚本哈希、每次扫描逐页结果、页限制、初始索引状态与完整性判定。四个原始 stdout 文件保留 PowerShell 输出的 UTF-16LE 编码，`.gitattributes` 保持脚本及原始输出字节以匹配收据中的哈希。

可使用 Python 标准库执行两个探针，参数为隔离安装的官方原生 Codex binary 路径：

```text
python issue572-upstream-repro.py /path/to/codex
python issue572-partial.py /path/to/codex
```

原探针退出 0 表示执行完毕，不代表扫描完整；必须检查逐页身份、预期数量及终止游标。这里的合成 Windows 观察不替代原有三平台真实 rollout 严格矩阵，不改变准入或支持配置。[Issue #572](https://github.com/chainlesschain/chainlesschain/issues/572) 继续开放。

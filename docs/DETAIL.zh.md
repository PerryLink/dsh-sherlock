# dsh-sherlock

面向 DeepSeek Harness 的时序证据工作台。把公开 URL 变成一份本地可复核的时间线：冻结快照、
分离时间角色、日期冲突、缺口、覆盖范围，以及自包含 HTML 报告 + Markdown/CSV + manifest。它不建站、不查人、不裁决真假。

## 安装

```bash
dsh plugin --profile <profile> add dsh-sherlock
```

## 工作流

1. `chrono_case`：建立本地案卷。
   可选：`chrono_search` 通过 DSH 配置的搜索 provider 发现候选 URL。
2. `chrono_ingest`：抓取 1–10 个公开 URL，保存文本快照和 SHA-256。
3. `chrono_assert`：记录事件和原始日期断言，必须选角色。
4. `chrono_analyze`：查看冲突、T-S-C-E 证据、时间线、缺口、覆盖。
5. `chrono_report`：生成 `report.html`、`report.md`、`timeline.csv`、`sources.csv`、`report.manifest.json`，
   用 DSH `present` 展示。

其他工具：`chrono_feed`/`chrono_gdelt`/`chrono_archive` 发现源，`chrono_collect` 50 URL job，
`chrono_diff` 与上一份报告比较，`chrono_verify` 来源漂移复查，`chrono_claim` 记录陈述，
`chrono_review` 人工处理冲突。`chrono-investigation` skill 承载方法论。早期
`sherlock_check` / `sherlock_sites` 用户名工具保留为 legacy 兼容。

## 五轴时间

事件、发布、首次可见、抓取、修改时间分开存。一天是一个带精度和时区的区间，不是伪精确的瞬时点。
缺时区会明确报告，不会静默替换成 UTC。

## 诚实的输出

- 查询/覆盖台账（`queries.jsonl`）与每个时间值的 TEG（T1–T4）。
- T-S-C-E 向量和 band，而不是一个“可信度百分比”。
- `hard_time` / `role_mismatch` / `precision_mismatch` / `timezone_ambiguity` / `dependence`。
- `未检查`、`已检查未发现`、`无法访问`、`证据不足`是不同状态。
- 不做真/假裁决，不做身份结论，不返回原始 HTML，不复制全文。

## 边界

只读公开来源；不登录、不绕过付费墙/验证码/WAF。不建站、不做爬虫网络、不做批量收集、不查人、
不做人肉或高风险决策。报告哈希是完整性校验，不是可信时间戳或法律意见。

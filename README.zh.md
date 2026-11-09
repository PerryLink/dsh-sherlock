# dsh-sherlock

[![CI](https://github.com/PerryLink/dsh-sherlock/actions/workflows/ci.yml/badge.svg)](https://github.com/PerryLink/dsh-sherlock/actions/workflows/ci.yml)

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的**时序证据工作台**；早期用户名检查工具保留为 legacy。

它**不建站、不托管服务、不查人**。输入公开 URL（可选 DSH 搜索结果），在本地冻结快照，分离同一条日期上的不同时间角色，重建可复核的时间线，输出冲突、缺口和覆盖范围。它不会给出“真/假”裁决。

> 名称保留用于连续性；产品方向是时序证据，而不是用户名枚举。

## 工作流

`chrono_case` → `chrono_ingest` / `chrono_feed` / `chrono_gdelt` / `chrono_archive` → `chrono_assert` → `chrono_analyze` → `chrono_report`

- **chrono_case**：建立/打开本地案卷。
- **chrono_ingest**：抓取 1–10 个公开 URL，保存文本快照和 SHA-256，抽取发布者声明的日期。
- **chrono_feed**：RSS/Atom；**chrono_gdelt**：GDELT 新闻窗口；**chrono_archive**：Wayback CDX（可达时）。这些是发现源，本身不是证据。
- **chrono_collect**：最多 50 URL，优先 DSH job，失败回退前台；**chrono_watch**：通过 DSH schedule 建立持久观察。
- **chrono_assert**：记录事件和原始日期断言，必须选角色（`event`/`announcement`/`effective`/`publication`/`update`/`correction`/`retraction`/`access`/`deadline`/`period`）。
- **chrono_analyze**：确定性的冲突/证据/时间线/缺口/覆盖分析。
- **chrono_report**：生成 `report.md`、`timeline.csv`、`sources.csv`、`report.manifest.json`。
- **chrono-investigation** skill：五轴时间、T-S-C-E、冲突处理、不确定性语言。

### 五轴时间（绝不压成一个日期）

| 轴 | 含义 |
|---|---|
| **E** Event | 事件发生/生效时间 |
| **P** Publication | 该说法首次公开发布时间 |
| **F** First seen | 最早可证明有人看见过它（存档） |
| **O** Observed | 本次抓取时间 |
| **M** Modified | 来源声称的编辑/撤回时间 |

检查 `E ≤ P ≤ F ≤ O`、`P ≤ M`、`E ≤ M`；违反是 `temporal_anomaly`，不是结论。

### T-S-C-E 证据向量

每个事件带 **T**（时间精度/时区/角色）、**S**（来源可追溯性）、**C**（独立佐证）、**E**（快照/span/哈希可复现）。报告显示向量和 band（low/medium/high），不显示单一“可信度百分比”。单一来源或转载不能 high。

### 日期冲突分类

`hard_time`（同角色、精度可比、区间不相交）、`role_mismatch`、`precision_mismatch`、`timezone_ambiguity`、`sequence`、`version`、`dependence`。报告说明“需要什么才能解决”，不替用户选“正确日期”。

### 覆盖声明

负向结论必须带覆盖声明：查了什么、在哪、时间窗/语言/域名范围、什么时候查、命中多少、哪些不可达。`未检查`、`已检查未发现`、`无法访问`、`证据不足`是四种不同状态。

## 快速开始

```bash
dsh plugin --profile <profile> add dsh-sherlock
```

对 DSH 说：

```text
为这个问题建立时序案卷：“Acme 何时宣布关厂？两个来源为什么对不上？”
我手上有这些 URL：...
请用 chrono_case、chrono_ingest、chrono_assert、chrono_analyze、chrono_report。
不要判断哪个来源是真的；展示日期角色、冲突、缺口，以及什么能解决它们。
```

也可以直接 PTC 调用：

```js
const c = await tools.chrono_case({
  action: 'create',
  title: 'Acme 关厂时间线',
  question: 'Acme 何时宣布关厂？',
  purpose: 'internal',
  subject_type: 'organization',
  subject_name: 'Acme'
})
await tools.chrono_ingest({ case_id: c.caseId, urls: ['https://example.com/notice'] })
// 读取返回的 source id，然后照抄原始日期文本；不要自己算日期。
await tools.chrono_assert({
  case_id: c.caseId,
  source_id: '<source-id>',
  event_label: 'Acme 宣布关厂',
  event_category: 'corporate',
  dates: [{ raw_text: '2024年3月15日', role: 'announcement' }]
})
await tools.chrono_analyze({ case_id: c.caseId, action: 'check' })
await tools.chrono_report({ case_id: c.caseId, audience: 'internal' })
```

报告工具只写本地文件，包含自包含的 `report.html` 时间线/冲突板。模型应调用 DSH `present` 展示 `presentFiles` 四个文件；`sources.csv` 留在案卷。插件不上传。人类可用 `/chrono list`、`/chrono status <caseId>`、`/chrono report <caseId>`。

## 工具

| 工具 | 用途 |
|---|---|
| `chrono_case` | 建立/打开/列出本地案卷 |
| `chrono_search` | 可选：通过 DSH 搜索发现 URL；结果不是证据 |
| `chrono_ingest` | 冻结公开 URL 快照与元数据 |
| `chrono_feed` | RSS/Atom 条目 + 可选入库 |
| `chrono_gdelt` | GDELT DOC 2.0 新闻发现 + 可选入库 |
| `chrono_archive` | Wayback CDX 捕获；可选/可降级 |
| `chrono_collect` | 最多 50 URL；DSH job 或前台回退 |
| `chrono_watch` | 通过 DSH schedule 的持久观察 |
| `chrono_diff` | 与上一份报告的确定性 diff |
| `chrono_verify` | 重抓来源并记录哈希/状态漂移 |
| `chrono_claim` | 在案卷中记录 claim/陈述 |
| `chrono_review` | 人工复核/解释冲突 |
| `chrono_assert` | 记录事件和原始日期断言 |
| `chrono_analyze` | 冲突、证据向量、时间线、缺口、覆盖 |
| `chrono_report` | 可视化 `report.html` + Markdown/CSV + manifest 哈希 |
| `sherlock_check` | **legacy** 用户名检查，保留兼容 |
| `sherlock_sites` | **legacy** 站点列表 |

`sherlock-osint` skill 保留用于说明 legacy；主工作流是 `chrono-investigation`。

## 本地案卷

默认根目录：宿主工作目录下的 `.dsh-sherlock/chrono`。结构见英文 README。没有网站、服务器、账号或外部数据库；case ID 由插件生成，模型不能传文件路径。

## 配置

```yaml
- insert:
    - id: dsh-sherlock
      name: dsh-sherlock
      config:
        chronoRoot: .dsh-sherlock/chrono
        chronoMaxSources: 50
        chronoMaxBytes: 2097152
        chronoTimeoutMs: 15000
        chronoPerHostDelayMs: 250
        chronoHonorRobots: true
        # legacy
        defaultScope: core
        maxSites: 120
        concurrency: 10
        perHostDelayMs: 350
        timeoutMs: 10000
        toolTimeoutMs: 180000
        maxResponseBytes: 524288
        maxVerify: 30
        cacheTtlMs: 600000
        includeNsfw: false
        honorExclusions: true
        allowPrivateHosts: false
```

时序工具拒绝私有/回环地址；`allowPrivateHosts` 只属于 legacy 测试路径，不要在 profile 里开启。

## 安全边界

- 只读公开来源；不登录、不绕过付费墙/验证码/WAF、不使用凭据。
- 不建站、不做 SaaS、不做爬虫网络、不做批量收集。
- 不做身份/归属结论；不做人肉、骚扰或高风险决策。
- 报告不返回原始 HTML/完整正文；只放短引文、链接和哈希。
- 哈希是完整性校验，不是可信时间戳或法律意见。
- 不裁决真假；只报告已收集证据支持什么、冲突什么、未知什么。

## Legacy 用户名工具

`sherlock_check`/`sherlock_sites` 仍对 `data/sites.json` 的 Sherlock 格式快照工作，保留六态、随机负控制和 120 站上限；作为产品方向已弃用。旧行为和数据声明见 [docs/LEGACY-USERNAME.md](docs/LEGACY-USERNAME.md)。

上游数据 MIT；插件代码 Apache-2.0。见 `LICENSE`、`NOTICE`、`data/SHERLOCK-LICENSE`。

## 开发

需要 Node 24.9+。

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run check
npm run gate
```

真实 DSH schema 校验：

```bash
DSH_TOOLS_PATH=/path/to/dsh-tools/lib/index.js npm test
```

## 文档

- [时间证据模型](docs/TIME-EVIDENCE-MODEL.md)
- [Legacy 用户名行为](docs/LEGACY-USERNAME.md)
- [数据同步](docs/DATA.md)
- [发布](docs/RELEASING.md)
- [Benchmark](docs/BENCHMARK.md)
- [插件详情](docs/DETAIL.md)
- [安全策略](SECURITY.md)
- [贡献](CONTRIBUTING.md)

## 许可证

插件代码 Apache-2.0；legacy Sherlock 派生数据 MIT。见 `LICENSE`、`NOTICE`、`data/SHERLOCK-LICENSE`。

# dsh-sherlock

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的 Sherlock 兼容用户名检查插件。

它把 [Sherlock](https://github.com/sherlock-project/sherlock) 的站点清单变成一个 DSH 原生 bundle：两个工具 + 一个按需加载的 skill。它不是 Python CLI 的 1:1 移植——**被拦截、未知、不可信**会和已占用、可用明确分开。

> 与 Sherlock 项目无隶属或背书关系；名字只表示兼容其站点清单格式。

## 能做什么

- `sherlock_check`：用固定快照检查一个公开 handle，覆盖 481 个站点。
- `sherlock_sites`：列出站点名、检测器类型和可靠性，供模型选择目标。
- `sherlock-osint` skill：解释六态、复核、报告模板和边界。

默认范围是 curated **core 41 个有效站点**（45 个名字扣除 4 个排除项）。`scope: "all"` 扩大范围，但单次最多 **120** 个站点；NSFW 默认关闭。

## 安装

```bash
# npm
dsh plugin --profile <profile> add dsh-sherlock

# GitHub（无构建步骤，不需要 allowBuilds）
dsh plugin --profile <profile> add github:PerryLink/dsh-sherlock#<40-hex-sha>

# 本地
dsh plugin --profile <profile> add ./dsh-sherlock
```

验证：

```bash
dsh --profile <profile> --dump-config | grep -A2 dsh-sherlock
```

然后对 DSH 说：

```text
检查 handle "alice" 在 core 站点上是否存在，并总结线索。
```

PTC 里也可以直接调用：

```js
await tools.sherlock_check({ username: 'alice', scope: 'core' })
```

## 六态

| 状态 | 含义 | 应该怎么用 |
|---|---|---|
| `claimed` | 检测到 profile 形状 | 是线索，不是身份证明 |
| `available` | 命中站点的 not-found 信号 | 不代表全网不存在 |
| `unknown` | 超时/DNS/TLS/5xx/检测器不匹配 | 没查成，不能推断不存在 |
| `blocked` | 401/403/429/999 或 WAF | 被拦截，不能推断不存在 |
| `illegal` | 不匹配站点 `regexCheck` | 该站点不允许这个格式 |
| `unreliable` | 随机对照 handle 也被 claimed | 站点规则失效，这个 lead 不可信 |

`confidence` 为 `high`/`medium`/`low`；`evidence` 记录 HTTP 状态、检测器、重定向和对照结果，不返回页面 HTML。

## 配置

在 profile patch 的插件行上配置：

```yaml
- insert:
    - id: dsh-sherlock
      name: dsh-sherlock
      config:
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
```

| 配置 | 默认 | 说明 |
|---|---|---|
| `defaultScope` | `core` | `core` 或 `all` |
| `maxSites` | `120` | 硬上限 |
| `concurrency` | `10` | 1–50 |
| `perHostDelayMs` | `350` | 同一 host 串行 + 间隔 |
| `timeoutMs` | `10000` | 单请求 |
| `toolTimeoutMs` | `180000` | 工具截止时间 |
| `maxResponseBytes` | `524288` | 响应体上限；匹配到上限为止 |
| `maxVerify` | `30` | claimed 的随机负样本上限 |
| `cacheTtlMs` | `600000` | claimed/available；blocked/unknown 最多 60s |
| `includeNsfw` | `false` | 部署级默认 |
| `honorExclusions` | `true` | 上游 false-positive 排除项 |
| `userAgent` | 包默认 UA | 默认透明 |
| `manifestPath` | 包内数据 | 高级/测试用；不接受模型给 URL |

网络代理由 DSH 处理：启动 `dsh` 前 export `HTTPS_PROXY` / `HTTP_PROXY`，插件用 plain `fetch` 自动继承进程级 dispatcher；不要让模型传 proxy。

## 安全边界

- 只查公开页面；不登录、不绕付费墙/验证码、不使用凭据。
- 工具不返回原始 HTML；需要看 profile 页面时单独用 `web_fetch`。
- URL 模板来自包内数据并校验；重定向逐跳检查；默认拒绝私有/回环地址（测试开关除外）。
- Header allowlist：丢弃 `Cookie`、`Authorization`、`Host`。
- 默认 per-host 限速、512 KB body cap、并发上限。
- 不做批量扫号、WAF 绕过或高风险决策。

请遵守目标站点条款和适用法律。

## 数据

`data/sites.json` 是 Sherlock manifest 的归一化快照；`data/SOURCE.json` 记录 upstream commit、raw SHA-256 和计数。数据为 MIT；见 `data/SHERLOCK-LICENSE` 与 `NOTICE`。

数据固定随包发布，保证可复现；维护者用 `scripts/sync-sherlock.mjs` 更新、review 后发 patch 版本。不要在模型调用时拉取 manifest。

## 开发

需要 Node 24.9+。

```bash
npm test                 # node --test，只用本地 fixture
npm run check            # 数据校验
npm run pack:check       # npm pack --dry-run
```

测试覆盖状态码、message、response_url、WAF、重定向、POST payload、自定义 header、超时、body cap、排除项、负样本、缓存、工具 schema 和数据完整性。真实 DSH schema 校验：

```bash
DSH_TOOLS_PATH=/path/to/dsh-tools/lib/index.js npm test
```

## 许可

插件代码 Apache-2.0；Sherlock 派生数据 MIT。见 `LICENSE`、`NOTICE`、`data/SHERLOCK-LICENSE`。

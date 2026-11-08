# dsh-sherlock

基于固定 Sherlock 站点清单检查公开用户名，面向 DeepSeek Harness 返回结构化、可复核的结果。

## 安装

```bash
dsh plugin --profile <profile> add dsh-sherlock
```

## 工具

- `sherlock_check`：检查一个 handle；默认 core 41 个有效站点，`all` 单次最多 120 个。
- `sherlock_sites`：列出站点名、检测器类型和可靠性。

## 正确理解结果

| 状态 | 含义 |
|---|---|
| `claimed` | 检测到 profile 形状；是线索，不是身份证明 |
| `available` | 命中站点 not-found 信号；不代表全网不存在 |
| `unknown` | 超时/DNS/TLS/5xx/检测器不匹配；没查成 |
| `blocked` | 401/403/429/999 或 WAF；不是不存在 |
| `illegal` | 不匹配站点格式 |
| `unreliable` | 随机对照 handle 也被 claimed；该站点规则本次失效 |

工具不返回页面 HTML。需要核实公开 profile 页面时，单独用 `web_fetch`。NSFW 默认关闭。请遵守适用法律和站点条款；不要用于骚扰、人肉、绕过认证或对个人做高风险决策。

## 数据

数据快照固定随包发布，`data/SOURCE.json` 记录 upstream commit 和 SHA-256。数据为 MIT；见 `NOTICE`。

# 恢复部署验收单(2026-10-28 · noindex 壳事故)

部署:vercel-deploy(配额 14:35 UTC 重置后) □ Ready □ 生产域名指向新部署
验收方法:对原异常 URL 清单重复请求,**验证页面真实内容而非仅 200**(错误壳同为 200)。

## 原 URL 清单(程序化生成自 01:42 审计 JSON,共 12 条独立 URL)
权威来源:`recovery-url-list-2026-10-28.json`(由 `seo-audit-2026-10-28-01-42-.json`
的 unexpected-noindex 条目 set 去重生成,不手抄——初版手抄漏 1 条且日期有误,评审已抓)。
构成:仓库档案页 6(en×4 + es×1 + zh×1)+ 历史总榜日期页 3 + 历史周榜日期页 3。

## 每条 URL 记录(验收时填写)
| URL | 轮次 | 状态码 | robots meta | x-vercel-cache | age | x-vercel-id | H1 | JSON-LD@type | 判定 |

## 验收判据(按页面类型分流——同类型页面的正常态输出,而非统一 JSON-LD 规则)
| 页面类型 | 内容级验收 |
|---|---|
| 仓库档案页(en/es/zh ×6) | 200 + robots 非 noindex + H1(仓库名)+ SoftwareSourceCode JSON-LD + 主体数据(星数/名次)在位 |
| 历史总榜日期页(×3) | 200 + robots 非 noindex + 日期标题 + 榜单行内容 + ItemList JSON-LD(往日榜设计内) |
| 历史周榜日期页(×3) | 同上 |
| 有意 noindex 工具页(watch/discover/status) | 维持原设计 noindex,不因恢复而意外放行 |

- 每条 URL ≥3 轮全部满足其类型判据 → 通过
- 任何一轮 noindex 壳 → 未愈:停止重复部署,按分层路径排查(CDN / ISR 持久缓存 / 生成逻辑)
- 全部通过后:事故关闭记录引用本单 + 持久化采样,归档不覆盖

## 证据持久化
- 18 条原始采样(脱敏:URL/状态/双 noindex 信号/vid/缓存态/age/时间/字节数)→ `noindex-shell-evidence-2026-10-28.json`
- 不再引用 /tmp 本地路径作为团队复查依据

## 与 GSC 基线的关系(口径声明)
10-29 GSC 快照 = 基线 A(SEO 分支发布前),不等于事故前数据;事故恢复用本单的直接 HTTP 验证闭环
(基线 B)。GSC URL Inspection 的"已收录版本"与"实时检查"是两回事;重新抓取需数天到数周,
10-29 快照是观测点不是判决。

# 恢复部署验收单(2026-10-28 · noindex 壳事故)

部署:vercel-deploy(配额 14:35 UTC 重置后) □ Ready □ 生产域名指向新部署
验收方法:对原异常 URL 清单重复请求,**验证页面真实内容而非仅 200**(错误壳同为 200)。

## 原 URL 清单(取自 01:42 审计的 unexpected-noindex 12 条)
/en/repo/morluto/rea, /zh/repo/vercel/next.js, /es/repo/google/guava,
/en/history/overall/{10-24,25,26}, /en/history/weekly/{10-24,25,26}, /en/repo/peach-mitao/peach, /en/repo/freeCodeCamp/freeCodeCamp

## 每条 URL 记录(验收时填写)
| URL | 轮次 | 状态码 | robots meta | x-vercel-cache | age | x-vercel-id | H1 | JSON-LD@type | 判定 |

## 验收判据
- 多轮(≥3)全部:状态 200 + robots 非 noindex + H1 在位 + SoftwareSourceCode JSON-LD 在位 → 该 URL 通过
- 任何一轮 noindex 壳 → 未愈,停止重复部署,按分层路径排查(CDN / ISR 持久缓存 / 生成逻辑)
- 反向核对:有意 noindex 的工具页(/zh/watch /zh/discover /zh/status)仍保持原设计
- 全部通过后:事故关闭记录引用本单 + 原始采样,归档不覆盖

## 与 GSC 基线的关系(口径声明)
10-29 GSC 快照 = 基线 A(SEO 分支发布前),不等于事故前数据;事故恢复用本单的直接 HTTP 验证闭环
(基线 B)。GSC URL Inspection 的"已收录版本"与"实时检查"是两回事;重新抓取需数天到数周,
10-29 快照是观测点不是判决。

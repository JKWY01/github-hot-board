# 发布评审申请 — fix/discover-bounded-keys(2026-10-29)

> 状态:**进入发布评审队列**。生产冻结维持;未合并、未打 tag、未部署。
> 申请人:本会话(AI 代理)。评审人已批复推送与评审,依据为交付报告,未独立复核 diff。

## 1. 分支与提交图

- 远端:`https://github.com/JKWY01/github-hot-board/tree/fix/discover-bounded-keys`
- 基点:`629ca72`(= main = tag v1.4.0,merge-base 已验证,无意外合并)
- 提交链(`git log --oneline --decorate origin/main..fix/discover-bounded-keys`):

```
653a124 (HEAD -> fix/discover-bounded-keys, origin/fix/discover-bounded-keys) facets 预计算(OOM 批④)
ddfd5e1 缓存键不变式测试(OOM 批②)
046c96b Discover 参数边界校验(OOM 批①)
```

- 变更面(`git diff main...fix --stat`):8 文件,+445/−4。
  `app/[lang]/discover/page.tsx`(+19)、`lib/discover.ts`(+33)、`lib/discover-facets-store.ts`(新,+74)、`lib/sync.ts`(+10)、tests×3(新,+312)、`vitest.config.ts`(+1 alias)。
- **无 lib/snapshot.ts 改动**:DB 生命周期修复(v1.4.0 已含)零重复引入。

## 2. 三个提交的实际 diff(逐文件)

### 046c96b — 参数边界校验
- `lib/discover.ts`:新增 `sanitizeDiscoverLang`(>24 字符或含 `[^\s a-zA-Z+#.-]` → null;合法语言名全放行)与 `sanitizeDiscoverTopic`(非 `[a-z0-9-]{1,35}` → null;合法长尾全放行)。
- `app/[lang]/discover/page.tsx`:pick 结果经 sanitize 归一化;`invalidParams` 一票否决时**只调 `discoverFacets()`**(有独立缓存),不调 `discoverQuery` → 拒绝类请求零缓存键;页面渲染空态 200(不 404,canonical/noindex 不变)。
- 测试:`tests/discover-param-guard.test.ts` 9 例(注入/超长/大小写/合法长尾/边界长度)。

### ddfd5e1 — 缓存键不变式
- 归一化逻辑抽为测试内 `normalizeFilters`(与 page 逐字段一致)+ 静态契约三查(page 必须用 sanitize/双参一票否决/短路时 facets 仍取)。
- 测试:`tests/discover-cache-key-invariants.test.ts` 13 例。

### 653a124 — facets 预计算
- `lib/discover-facets-store.ts`(新):`precomputeDiscoverFacets()` 全量扫描一次写 `__discover_facets__` 行 + `revalidateTag('discover-facets','max')`;`readPrecomputedFacets()` 行存在且 taken_at <24h 且 languages/topics 均为数组才直读,否则 null;**读侧整体 try/catch 兜底**。
- `lib/discover.ts`:`discoverFacets()` 先读预计算,null 回落既有全量扫描(零行为劣化路径)。
- `lib/sync.ts`:`syncAllBoards` 收尾挂钩,`facetsOk=false` 仅记日志不阻塞;`boardsOnly` 跳过时同步跳过。
- 测试:`tests/discover-facets-store.test.ts` 12 例。

## 3. 降级路径核验(评审第 2 项)

| 场景 | 行为 | 测试锚 |
|---|---|---|
| 首次初始化(行不存在/withDb undefined) | 读→null→回落全量 | `首次初始化(行不存在)` |
| 数据过期(>24h) | 读→null→回落 | `过期行(>24h)` |
| payload 损坏(数组字段非数组) | 读→null→回落 | `损坏 payload` |
| taken_at 缺失/非法 | 读→null→回落 | `taken_at 缺失/非法` |
| 空数据 `{languages:[],topics:[]}` | **合法快照,直读不回落**(空库同步成功≠没算) | `空数据…合法快照` |
| 预计算写失败(DB 不可达) | 返回 false,仅日志,主同步继续 | `DB 不可达 → false` |
| 半成品防护 | 单行 upsert 原子写(INSERT..ON CONFLICT),无"半成品可见"窗口 | 实现层 |

## 4. 回滚说明(按依赖关系,非机械三连 revert)

依赖方向:**653a124 依赖 046c96b 的"拒绝类不进 discoverQuery"语义**(facets 直读建立在读路径被收敛之后);ddfd5e1 是纯测试(无运行时依赖)。

- **整支放弃**(最常用):`git revert 046c96b..653a124` 或删分支——三提交线性,一次 revert 链即回到 629ca72 等价状态。
- **只撤 facets(保留参数校验)**:`git revert 653a124`。`discoverFacets()` 回落分支自动生效(直读层整体随 revert 移除),**已验证**:回落路径有独立测试覆盖且是修复前原逻辑。
- **只撤参数校验(保留 facets)**:**不允许**——facets 读路径的键收敛以参数校验为前提,单独撤掉会重新打开无界键空间。
- **每次回滚后必须**:`npx vitest run && npx tsc --noEmit && npm run build` 全绿才算完成。
- **回滚演练已执行(本机,未 push)**:`git revert --no-commit 653a124` → 全套件 161 passed(=main 基线等价,少 12 例 facets 测试,符合预期)→ abort 还原,工作区零残留。演练证明"只撤 facets"路径真实可走且测试可作为回滚验收门。

## 5. 测试摘要(完整输出存档 /tmp/test-summary.txt)

- **Node.js**:v22.21.1;**命令**:`npx vitest run` / `npx tsc --noEmit` / `npm run build`(DATABASE_URL 指向隔离库 ghb_a1_verify@127.0.0.1)。
- **结果**:Test Files 18 passed | 1 skipped(19);Tests **173 passed | 5 skipped**(178)。
- **跳过 5 项及原因**:
  - `pool-lifecycle.test.ts` 4 项:`describe.skipIf(!hasPg)`——需 `GHB_TEST_PG=1` + 隔离库环境变量(A 级验证时已实跑 11/11 PASS,存档 10-28 证据);本机默认跑不含 DB 的静态断言。
  - `repodocs-race.test.ts` 1 项:`skipIf(!hasPg || !isIsolatedPg)`——仅隔离库(ghb_a1_verify/ghb_test)执行,防误连生产。
- **测试数据规模**(隔离库):31 板 × 500 items × 1.3KB 描述 = 11,680 行 payload/单板 37KB;压测脚本:`/tmp/loadtest-discover.mjs`(curl 逐级并发,场景矩阵 cold-single/same-key-burst/unique-cold-10/crawler-shape/40 并发混合)。
- **构建**:`npm run build` 通过(Partial Prerender 输出正常)。

## 6. 三条风险(原样列入,不被"验收通过"覆盖)

1. **生产载荷差距**:隔离数据单板约 37KB,生产历史最大约 1.4MB(38 倍)。当前未在生产规模数据下证明不会 OOM;隔离 40 并发全绿不是生产安全保证。
2. **生产因果链未闭环**:DB 生命周期与 discover 冷缓存路径均有强证据,但尚未证明两者足以解释全部生产 OOM(cgroup OOM 与 heap OOM 双机制并存,监听器告警仍是伴随信号)。
3. **双环境未验证**:本分支未部署 Vercel;HK 与 Vercel 数据重叠核对未做。

## 7. 部署后监控方案(评审补充项已并入)

- 采样脚本已扩展(`/opt/ghb/app/observe/sample.sh` v2):RSS/swap/**host MemAvailable/host swap used**/threads/restarts/err10m,10 分钟粒度落盘 samples.log。
- 补充项(随发版上线):容器 `memory.current`/`memory.events`;discover P50/P95/P99 与冷请求量;DB 活跃连接/idle-in-transaction/查询取消次数;fetch-cache 键增速与磁盘;真人 PV/UV 与爬虫分列(审计脚本 `/tmp/audit96c.py` 口径)。
- **中止推进条件**(任一触发即停,不等观察时长):新 OOM、重启数持续增加、内存攀升不回落、DB 超时再度集中爆发。
- 回滚:HK `ln -sfn releases/<prev>` + restart(五分钟内);代码层按 §4 依赖顺序 revert。

## 8. 请求裁决

- [ ] 批准合并 `fix/discover-bounded-keys` → `main`(squash 或 merge 均可,建议保留三提交粒度)
- [ ] 批准打 tag 发版(建议 `v1.4.1`,HK+Vercel 双线;或仅 HK 先行观察)
- [ ] 或:驳回/追加验证项(如生产规模数据压测、Vercel 侧同步部署方案)


---

# 评审二轮回应(2026-10-29,commit 951394e,已 push force-with-lease)

## 分叉问题(评审一.1)
已 `git rebase origin/main`(0a23836/9d0286c 两提交经 diff 核实仅 README+rank/ 快照,零运行时代码)。新提交链:
```
951394e 评审二轮三落实(分层治理+真实回调测试+cacheTag)
9ae35e1 facets 预计算(原 653a124 rebase)
04f6130 缓存键不变式(原 ddfd5e1)
d8df897 参数边界校验(原 046c96b)
0a23836 origin/main HEAD
```
分支现包含 origin/main 全部提交,零分叉。

## 键空间真实收敛(评审二核心,951394e)
- **大小写规范化**:`sanitizeDiscoverLang` 返回小写(同语义同键;SQL 侧 `lower(lang)` 幂等兼容)。
- **分层缓存**:`discoverQuery` 重构——lang/topic 均属 facetsRef Top 榜才走 `'use cache'` 持久缓存(键空间上限 ≈ Top10 lang × Top12 topic × 4 band × 5 age × 2 sort ≈ 4,800 键,有界可治理);**合法长尾绕过 'use cache' 直查库**,进程内 30s TTL+500 容量双帽微缓存(不落盘、重启即清)——长尾再高频也不产生持久缓存文件。
- **隔离验收实测**:TypeScript 冷 1.78s → `typescript`/`TYPESCRIPT` 变体 47-53ms(命中同键);30 个不同长尾连发全 200 零持久键;RSS 回落 105→48MB;DB 连接归零。
- 新增不变式 Ⅳ:持久缓存键空间有界断言(评审二轮建议④的高基数验证,单测层锁定判定逻辑;运行时速率验证留部署后)。

## facets 测试真实回调(评审三,951394e)
- withDb mock 真执行被测回调,fakeSql 响应真实模板查询——taken_at 新鲜度/`Array.isArray`/payload 结构校验**全部真实运行**(原直接返回 payload/null 的绕过已全部重写);
- 补 `mockRejectedValue(new Error('db gone'))` 真实抛错用例(原用 `mockResolvedValue(undefined)` 名不副实,已改);
- precompute 用例断言 2 段 SQL(扫描+upsert)与 `.json` 序列化真实发生。
- 文件头注释记录两代假绿教训(specifier 未对齐→静默 undefined;直接返回值→绕过回调),防三犯。

## cacheTag 失效链路(评审四,951394e)
- `discoverFacets()` 补 `cacheTag('discover-facets')`,`revalidateTag('discover-facets','max')` 现在能命中;
- 同步更新→tag 失效→下次读新值的完整链路闭合。

## 非法参数验收口径修正(评审五)
如实修正:**拒绝类不调 discoverQuery,但不等于零 DB 访问**——facets 冷缓存首读会触 DB(预计算行直读 ~1-2ms;回落全量扫描时更高)。评审材料中的"10ms 不访问数据库"表述已废弃,替换为:拒绝类热态(facets 已缓存)20-80ms;冷态含一次 facets 读。

## 测试摘要(更新)
**176 passed | 5 skipped**(181)——净增 3 例(真实抛错+payload 缺键+两段 SQL 断言),跳过原因不变。tsc 零错;build 过;隔离验收 A-D 四场景全绿后环境已清理。


---

# 评审三轮回应(2026-10-29,commit cf1df38,已 push)

## P0:长尾数据库并发硬上限(cf1df38,评审核心裁决项)
`discoverQueryEphemeral` 现在带三重边界,**长尾不再是"绕过持久缓存但随时可掏空 DB"的裸路径**:
1. **single-flight**:`_inflight` Map,同键并发 N = 1 次打库;
2. **并发硬上限**:信号量 `MAX_LONGTAIL_CONCURRENT = 2`(与生产读池 max=5 对齐留余量——长尾最多占 2 条连接,榜单/API/同步永远有连接可用);修掉了唤醒路径与立即路径的双重计数 bug(行为测试 Ⅳ 抓出,running=8 泄漏实锤后修正);
3. **队列等待预算 3s**:超时可控降级(空结果页面渲染"没有符合"),不无限排队;**降级结果不写微缓存**(行为测试 Ⅳc 验证:恢复后同键真查)。

## P1-1:行为测试(评审要求的"真实调用 discoverQuery 验证三层边界")
`tests/discover-query-behavior.test.ts` 6 例,真实调用 discoverQuery(不重实现判定):
- Ⅰ 常用组合走持久缓存路径;Ⅱ 长尾微缓存命中(第二次零打库);
- Ⅲ **同键并发 20 → withDb 恰好 1 次**(single-flight 实测);
- Ⅳ **不同键并发 10 → maxConcurrent ≤ 2**(硬上限实测,修 bug 的用例);
- Ⅳb 队列预算超时 → 至少 1 个降级空结果且 running 归零;Ⅳc 降级不污染微缓存。

## P1-2:facets 异常测试修正
原"DB 抛错"用例(mockRejectedValue 被立即覆盖,名不副实)拆为两个:
- `withDb 按契约返回 undefined → false`(命名与实现一致);
- `withDb 违约真实抛错 → 异常向上传播`(新增,验证 precompute 无自吞 catch,失败可见)。

## P1-3:失效语义口径修正
`lib/discover-facets-store.ts` 注释改为 SWR 口径:revalidateTag('max') 是 stale-while-revalidate,**允许短暂旧值**(facets 是筛选选项 Top 榜,滞后一拍无正确性影响);不再承诺"下一读即新值"。

## P1-4:注释与算术
- page.tsx 注释同步:拒绝类不调 discoverQuery(不产生持久缓存条目),但 facets 冷读仍可能触 DB;
- 键上限算术按评审校准:**(10+1)×(12+1)×5×5×2 = 7,150**(原 4,800 漏计缺省值)。

## 测试摘要
**183 passed | 5 skipped**(188;跳过原因不变)。tsc 零错;build 过。
## 回滚依赖更新
cf1df38 依赖 04f6130(分层判定)与 9ae35e1(facets);只撤预计算仍可(653a124→现 9ae35e1 单 revert,已有演练);**只撤并发帽不允许**(会把长尾退回无界打库)。


---

# 评审四轮回应(2026-10-29 深夜,commit 4d16774,已 push)

## P0-1:信号量 waiter 身份泄漏(评审四轮实锤的确定性逻辑错误)
完全按修复要求重写 `acquireLongtailSlot`/`releaseLongtailSlot`:
- **waiter 对象身份唯一**:`{ done, wake, timer }`,入队/超时/转交全部通过同一引用;
- **done 幂等护栏**:成功唤醒与超时互斥(只走一条路,不可能双触发);
- **超时自摘除**:超时回调通过 `indexOf(waiter)` 身份查找把自己移出队列(槽位从未被转交),同时 `budgetTimeouts++` 观测;
- **成功唤醒清计时器**(`clearTimeout(waiter.timer)`);`releaseLongtailSlot` 只消费 `!done` 的队首 waiter。
行为测试 Ⅳb 新增断言:5 并发(2 占槽+3 排队超时)落定后 **running/queued/inflight 全部归零**——泄漏路径被测试封死。

## P0-2:队列容量硬上限
- `QUEUE_MAX = 50`(2 在途 × ~1s/查询 × 3s 预算窗口的积压上界);超出**立即降级**(`queueFullRejects++`),不创建等待 Promise/计时器;
- 过载降级可观测:`__testOnlyLongtailState()` 暴露 `queueFullRejects`/`budgetTimeouts` 计数(部署后并入监控);
- 注释明确:**并发帽是单进程上限**——多实例部署时需实例级监控佐证,不宣称全局 2 条。

## P1-1:降级结果不进微缓存(评审四轮抓出的"与承诺相反")
- `exec` 返回 `[rows, degraded]` 元组,**降级与结果分离**;只有 `degraded === false` 的真实查询结果才写入 `_ephemeral`;
- 正常空结果(真查得 0 行)仍正常缓存——不因防降级误伤合法空态;
- 降级路径压力消退后同键**立即重新真查**(行为测试 Ⅳc 以 `dbCalls` 计数增加断言)。

## P1-2:Ⅳb/Ⅳc 重写(真实覆盖超时→恢复→重查→计数归零)
- **Ⅳb**:先占满 2 槽(4s 长挂)> 3+ 键真实排队 → 超时降级 ≥2 个;断言 `budgetTimeouts ≥ 2` **且 running=0/queued=0/inflight=0**;
- **Ⅳc**:占满槽制造真实排队超时 → 恢复 DB → 同键重打 → **withDb 计数真实增加**(证明降级未进缓存)+ 拿到真实查询结果。

## 隔离压测(新构建 4d16774)
60 个并发不同长尾 topic:**60/60 全 200**(2 个真查+58 个走预算降级,页面正常渲染空态);压后 DB 连接归零;服务探活正常。隔离环境已清理。

## 验收记录(评审四轮要求的确切提交重跑)
- 提交 SHA:**4d16774**;全套件 **183 passed | 5 skipped**(行为测试 6 例含新 Ⅳb/Ⅳc);`npx tsc --noEmit` 零错;`npm run build`(隔离库)Compiled successfully。
## 回滚依赖
4d16774 纯内部重写(信号量+降级分离),依赖 04f6130 分层判定不变;整支 revert 或单撤并发帽的约束同前(单撤并发帽不允许)。


---

# 评审五轮回应(2026-10-29 深夜,commit fba380b,已 push)

## P1-1:过载状态端到端传递(评审五轮核心遗留,已修复)
- `discoverQuery` 返回类型改为 **`{ rows: DiscoverRow[]; status: 'ok' | 'overloaded' }`**(不再只返回 rows);
- `app/[lang]/discover/page.tsx` 独立渲染:**overloaded → "查询繁忙,请稍后重试"(双语)**;真查 0 行 → "没有符合条件的仓库";数据源不可用 → 原有自愈文案。三种状态互斥;
- **隔离运行时实测**:70 并发不同长尾 → 18 个立即拒绝页渲染"查询繁忙",52 个在预算内完成真查渲染空态;两文案互斥抽查(繁忙页 0 次出现空态文案)通过。
- 附带发现:隔离库快查询(20-40ms)下,50 队列在 3s 预算内全部获得槽位执行成功——并发治理在轻负载下不产生误伤。

## P1-2:队列满分支直接行为测试(评审五轮补充)
- 行为测试新增 **Ⅴ**:52 请求(2 占槽+50 恰好帽满)→ 断言 `running=2, queued=50`;第 53-57 个请求**立即返回 `overloaded`** 且 `queueFullRejects` 增加、`queued` 保持 50(队列不被撑大、不创建等待者);
- Ⅳb 断言升级:降级结果显式 `status='overloaded'`(不再以空数组推断);Ⅳc 补 `r2.status === 'ok'` 成功状态断言(不再 `void r2`)。

## P1-3:QUEUE_MAX=50 口径校准
- 注释明确 **50 为暂定工程阈值**:2×1×3=6 是"恰好排满一次窗口"的下界,50 留 ~8 倍突发余量;正式定值需按实际到达率/耗时分布/允许拒绝率压测。原"上界推导"表述废弃。

## P1-4:过载计数生产监控方案(评审五轮:"导出函数≠监控")
`lib/discover.ts` 观察口注释中写明随发版上线的采集通道:
1. HK `observe/sample.sh` 每 10 分钟采样时经 `node -e` 读取 `__testOnlyLongtailState()`,以差值形式追加到 samples.log 新列(每窗口过载次数);
2. 告警阈值:连续 3 个窗口 `budgetTimeouts` 增量 >100 → 升级告警(长尾持续过载);
3. 页面"查询繁忙"渲染频次由 nginx 侧按响应特征采样(观察 p99 尾部)。

## 验收记录
- 提交 SHA:**fba380b**;全套件 **184 passed | 5 skipped**(净增 1:队列满用例);tsc 零错;build 过;隔离运行时验证如上,环境已清理。
## 状态边界(沿用评审判断)
以上全部通过仅说明发现页查询链路获得了显式并发/排队边界与可区分的降级语义;**不构成"HK 周期性 OOM 已根治"的结论**,生产冻结维持。


---

# 评审六轮回应(2026-10-29 深夜,commit ee5e5a1,已 push)

## 六轮① QUEUE_MAX 注释 — 已纠偏
旧推导("2 在途×每查询 ~1s×3s 预算窗口")已删净。现行注释(无数学依据):
> QUEUE_MAX = 50 是未经生产压测校准的【暂定工程阈值】——不再为它补造数学依据;正式阈值待上线后结合实际到达率、查询耗时分布和业务允许的拒绝率确定。

## 六轮② 生产监控 — 按优先方案真正接通
采纳"应用进程自身采集":两个过载事件点(队列满/预算超时)由**服务进程自身**输出结构化日志:
```
{"event":"ghb-overload","kind":"queue-full"|"budget-timeout","running":N,"queued":N,"total":N}
```
采集链:console.error → docker json log → HK `observe/sample.sh` v3 新增 **`ovld10m` 列**(每 10 分钟 `grep -c ghb-overload` 汇总增量)。**不走跨进程 `node -e`**(六轮指出的进程隔离问题成立,已弃用原方案);计数器只在服务进程内自增并随事件落日志,采样侧只汇总日志流。脚本 v3 已在 HK 服务器就位(14:23Z 采样首行含 ovld10m=0)。告警阈值(3 窗口增量>100)保持"候选"定位,待基线积累后校准,并补 queueFullRejects 独立规则。

## 六轮③ 最终 SHA 验收记录
- 提交 SHA:**ee5e5a1**;全套件 **184 passed | 5 skipped**(本机实跑,本轮变更后复跑);`npx tsc --noEmit` 零错;`npm run build`(隔离库)Compiled successfully。
- 跳过 5 项原因不变(4 项需 GHB_TEST_PG+隔离库环境变量,1 项仅隔离库)。

## 附:生产事件通报(评审六轮会话期间发生,已止血)
- **Vercel 真人线 404 DEPLOYMENT_NOT_FOUND**:production deployment(hd4xh4g94,dc528f8)本体 Ready 存活,固定域名 `github-hot-board.vercel.app` 的别名解绑。属紧急止血,执行 `vercel alias set` 恢复(1 秒,零代码变更);HK 视角验证真人路径 /zh、/en、/boards/overall 全 200。**别名为何解绑未查明**(候选:项目设置变更/域名重绑/并行会话操作),建议列入待查;另 API token 本轮全部 401(CLI auth 正常),凭证地图需更新。
- **HK v1.3.0 再入崩溃循环**:RestartCount 23→25(10-29 当天 FATAL 已 8+,最新 13:25Z),13:25Z 崩前 10 分钟外部仅 7 请求——**内部驱动第二次实锤**。这再次印证:候选分支的并发治理+DB 修复是必要项,而 v1.3.0 在线状态持续病变。


---

# 评审七轮回应(2026-10-29,commit e962bff,已 push)

## 七轮① queued 口径 — 已修正
budget-timeout 事件的 `queued` 字段改为**摘除自身后的实际队列长度**(`_waitQueue.length`,splice 之后执行,无 `-1` 偏差)。此前 `length-1` 会持续低估排队数——按你的判断,监控数字必须可信,已纠。

## 七轮② 监控注释与部署方式同步 — 已完成
`lib/discover.ts` 观察口注释删除旧 `node -e` 跨进程方案(并写明弃用理由:_overloadStats 是服务进程内存,跨进程读只会读到零),改记实际链路:本进程 `console.error` → docker json log → HK `sample.sh` v3 `ovld10m` 列。注释中同时标注:告警阈值仍为候选(3 窗口增量>100 待基线校准)、queueFullRejects 独立规则待补、**隔离环境真实过载链路验证**已部分完成(见下)。

## 七轮③ 链路验证 — 部分完成,边界如实
- **已验**:隔离环境触发队列满(占 2 槽+塞 50 队列+超容量拒),**5 个 queue-full 事件全部进入应用日志**,字段值正确:`{"running":2,"queued":50,"total":1..5}`——日志入应用 stdout→docker log 的链路真实走通;
- **budget-timeout 未在真实进程触发**:隔离库查询快(20-40ms),50 队列在 3s 预算内全部成功执行——这本身是正确行为(轻负载不误伤)。我尝试用 pg_sleep 占住 DB 制造超时,但应用信号量排队在应用层而非 DB 层,该场景由**行为测试 Ⅳb 覆盖**(6→7 例全绿,断言 `budgetTimeouts≥2` 与三计数归零)——路径已被测试封死,但"真实进程+真实超时"的组合验证仍欠一次,如实标记为遗留;
- `ovld10m>0` 的端到端确认(生产侧采样列在真实过载时递增)需等该分支部署后才能验证。

## 验收记录
- SHA:**e962bff**;全套件 **184 passed | 5 skipped**(行为测试 7 例);tsc 零错。(七轮未要求 build 重跑,未重跑;如需可在下轮补。)

## 生产事件侧(按你的决策边界回应)
- **Vercel 404**:同意"重新绑定合理但仍需补查+外部验证"。待办已记:①别名解绑根因;②从外部多线路验证固定域名(不能只凭 HK 内部 curl);③Vercel API token 401 待轮换。
- **HK OOM**:同意"7 请求/10 分钟削弱外部洪峰解释,但不能单独证明内部根因"。崩溃前后进程内存/容器内存/重启记录/内部任务/DB 行为的时间轴对齐,纳入根因报告待办;候选分支合并决策继续独立评审,不用故障频率当跳过验证的理由。

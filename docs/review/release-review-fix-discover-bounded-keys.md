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
- **分层缓存**:`discoverQuery` 重构——lang/topic 均属 facetsRef Top 榜才走 `'use cache'` 持久缓存(键空间上限 ≈ Top10 lang × Top12 topic × 4 band × 5 age × 2 sort ≈ 4,800 键,有界可治理;【三轮后校准为 7,150=(10+1)×(12+1)×(4+1)×(4+1)×2,含全部缺省值组合,且十六轮裁决明确:这是单次 facets 快照的组合上限,进程生命周期 Map 上限=历史快照键并集,未严格证明,见文末十六轮收口】);**合法长尾绕过 'use cache' 直查库**,进程内 30s TTL+500 容量双帽微缓存(不落盘、重启即清)——长尾再高频也不产生持久缓存文件。
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
2. **并发硬上限**:信号量上限 2(与生产读池 max=5 对齐留余量——Discover 查询最多占用 2 个并发槽位,为其他数据库操作保留连接池容量;但其他业务之间仍共享连接池,不构成连接隔离保证);修掉了唤醒路径与立即路径的双重计数 bug(行为测试 Ⅳ 抓出,running=8 泄漏实锤后修正);
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
- 键上限算术按评审校准:**(Top10 lang+1) × (Top12 topic+1) × (4 band+1) × (4 age+1) × 2 sort = 11×13×5×5×2 = 7,150**(原 4,800 漏计 band/age 缺省值)。

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


---

# 评审八轮回应(2026-10-30,生产事故打断+P1-1 已落实 7a3d893)

## 八轮 P1-1:故障文案与空结果语义分离 — 已落实
- T 表 16 语全部新增 `sourceUnavailable` 键(zh-TW 首次插入未命中,已修);`degraded` 分支改渲染独立文案,**不再混用 `t.empty`**。四态互斥:有数据/真空结果/过载繁忙/数据源不可用。

## 八轮 P1-2:sample.sh 审查 — 完成,已升级 v4
- v3 的 `docker logs --since 10m` 是时间窗过滤(非全量历史),增量口径正确;但存在 10-28 实锤的"容器重启瞬间串读旧实例日志"风险。**v4 改为直读 docker json log 文件(含 rotate .1)+10 分钟窗口过滤**,`ovld10m` 拆分为 **`qf10m`/`bt10m` 两列**(队列满与等待超时分开统计,对应两种处理策略)。v4 已上 HK 服务器,首行数据正常。
- 待办:`ovld10m>0` 端到端确认仍需分支部署后验证。

## 八轮 P1-3/P1-4/P1-5 — 进行中(被生产事故打断,如实标记)
- P1-3(真实进程 budget-timeout):隔离库快查询不产生超时(正确行为),生产规模 payload 压测是前置(查询变慢才可能超预算),与 P1-4 合并执行;
- **P1-4(生产规模压测)进行中**:隔离库已灌 31 板 × 500 items × 2.7KB 描述 = **单板 1.4MB(生产实测规模)/总量 44MB**;SQL 本体 26-49ms;40 并发不同长尾已完成全 200;60 并发突发阶段因下述生产事故中断,待续;
- P1-5(连接总预算核算):待做(实例数×池 max5+后台同步+管理连接)。

## 🔴 生产事件通报(2026-10-30 00:44Z,已止血)
- **Vercel 账号被平台暂停**(Fluid Active CPU 4h 用量 302% 超额),真人线 402 DEPLOYMENT_DISABLED——这就是此前 Fluid 烧钱调查预言的场景成真;
- **紧急止血**:nginx 分流 map default 临时改指 HK 容器(真人+爬虫全走 HK 自托管),备份 bak-20261030-0045-preallhk;验证真人路径全 200;切换后 5 分钟零崩溃零错误;
- **风险如实通报**:HK 跑的 v1.3.0 **没有**候选分支的并发治理(长尾无信号量/队列帽),且主机内存零余量——单线扛全量可能加速触发崩溃循环(RestartCount=39 的病变仍在)。**候选分支的合并评审紧迫性因此大增**;
- Vercel 恢复路径:11-01 月初配额重置(自动)或升级 Pro(用户决策);恢复后 nginx 还原一行+reload 即回切,双线架构未变。


---

# 评审九轮材料(2026-10-30,评审要求的三份证据+P0-3 资源预算核算)

## 材料 1:分支 HEAD 与最终 diff
- **HEAD SHA:`7a3d893`**(评审八轮 P1-1 sourceUnavailable 16 语;含八轮前 e962bff 全部七轮落实)
- 提交链(10):d8df897→04f6130→9ae35e1→951394e→cf1df38→4d16774→ee5e5a1→e962bff→8ed1eb7(评审文档入库)→7a3d893
- 最终 diff(`git diff origin/main..7a3d893 --stat`):10 文件,+1146/−31;核心=`lib/discover.ts`(参数校验+分层缓存+三重边界)、`lib/discover-facets-store.ts`(预计算)、`app/[lang]/discover/page.tsx`(参数收口+四态渲染)、tests×4(+500 行行为测试)
- **不含 lib/snapshot.ts 改动**(DB 生命周期修复=v1.4.0 已含,零重复引入)

## 材料 2:sample.sh v4 完整实现(已上 HK 服务器,首行数据已产出)
关键实现(回应八轮 P1-2 的三个疑点):
- **统计窗口**:直读 docker json log 文件(rotate .1 + 当前),py2 兼容解析器按每行 `"time":"<ts>"` 过滤 **utcnow-600s 窗口**——不是全量历史累计;
- **容器重启**:`docker logs` 弃用(10-28 实锤的重启瞬间串读旧实例坑),json 文件按当前容器 LogPath 读,重启后自然切换新文件,不串读;
- **重复采样**:cron 每 10 分钟固定一次,窗口滚动,无重复计数;
- **kind 分列**:`qf10m`(queue-full)/`bt10m`(budget-timeout)独立计数,不再合并——对应不同处理策略;
- 日志轮转:ghb-web LogConfig=json-file max-file:3 max-size:10m,rotate 文件也被扫描(防丢)。
- 已验首行:`qf10m=0 bt10m=0 err10m=50`(生产此刻有 DB 错误无过载,口径工作正常)。

## 材料 3:生产规模压测原始数据(隔离库 31 板×500 items×2.7KB 描述=单板 1.4MB/总 44MB)
| 场景 | 结果 |
|---|---|
| 单冷 miss ×3(1.4MB payload) | 200 ×3,105-127ms |
| 40 并发不同长尾 | 40/40 全 200 |
| **60 并发突发** | **60/60 全 200,P50=1.33s P95=2.56s max=2.66s** |
| 过载路径 | 4 个 queue-full 降级(并发帽生效,4 个立即返回繁忙) |
| RSS 峰值/回落 | 195MB → 45s 后 56MB |
| DB 连接 | 压后 2 → 45s 后 0 |
| 错误/5xx | 0 |
- **P1-3 budget-timeout 如实未触发**:max 2.66s < 3s 预算——隔离库本地网络太快,真实进程的自然超时未出现。该路径由行为测试 Ⅳb 封死(慢查询 mock 4s>3s 预算,断言 budgetTimeouts≥2+三计数归零);生产侧部署后由 bt10m 列观察首次真实触发。**不标记为完成。**

## P0-3:HK 全站资源预算核算(评审新增项)
| 资源 | 实测值 |
|---|---|
| Node 进程 | **1 个**(ghb-web 单容器单进程,14 线程,无子进程) |
| 每实例 DB 连接池 | postgres.js max=5(直连 5432;pgbouncer 6432 未启用=A3 未切) |
| PostgreSQL | max_connections=**60**;ghb 角色 rolconnlimit=**40** |
| pgbouncer | 池配置存在但闲置(未启用),pool_mode=transaction,max_client_conn=400 |
| 当前连接 | ghb 5 idle + 管理连接 |
| **长尾查询全站并发** | v1.3.0(现状)=**无上限**(无信号量);候选分支=单进程 2×1 实例=**2**(全站) |
| 排队全站 | v1.3.0=无界;候选分支=50(单进程=全站) |
| 后台任务 | 同步 cron(6h)与用户查询共享同池(竞争点,同步窗口 00/06/12/18 UTC :07) |
| 容器内存 | 640m 帽+360m 堆帽;历史 OOM 峰值 anon-rss 404MB |

**关键结论(评审预判验证)**:v1.3.0 现状下,长尾全站并发=无界——这正是当前 HK 单线扛全量流量的最大风险。候选分支部署后该数字立即收敛为 2(单实例=全站,因为只有 1 个进程)。**单进程信号量=全站上限(因实例数=1),但这是当前部署形态的事实而非架构保证——若未来加实例,总预算必须重算。**

## 八轮验收清单对照
- P0 代码/提交链核实:✅(材料 1)
- P1-1 故障文案:✅ 7a3d893(16 语无回退)
- P1-2 sample.sh:✅ v4(材料 2)
- P1-3 真实进程预算超时:**未完成**(隔离库不够慢;路径已由行为测试封死,生产侧 bt10m 待观察)
- P1-4 生产规模压测:✅ 60 并发完成(材料 3)
- P1-5 连接预算核算:✅(P0-3 表)
- P2 多语言:✅ 16 语 sourceUnavailable


---

# 评审十轮回应(2026-10-30,代码验收 SHA=2c75835;文档追加 HEAD=75497ce——两者之间仅文档变化,186 项测试系在 2c75835 上执行,已在 75497ce 上复跑确认等效)

## 分叉澄清与 main 同步(评审十轮 P0)
确认评审者独立发现属实:main 前进了 de77446(快照提交)。diff 核实仅 README+rank/,零运行时代码。**已 rebase(12 提交,新 HEAD=2c75835),分叉清零**,后续验收以 2c75835 为准(此前对 e962bff/7a3d893 的审查结论按评审要求不再直接沿用)。

## 十轮核心新增验收项:Top 榜冷 miss 并发 — 已治理(评审预判证实)
评审指出的覆盖缺口属实:持久路径(cached)此前无应用层并发帽,不同键冷 miss 可无界并发打库。
- **行为测试如实暴露治理前形状**(tests/discover-cached-path-behavior.test.ts):同键并发 20 → withDb 20 次(测试 stub 直通,无缓存合并;Next 真实填充合并能力由 standalone 验证另行确认);不同键 8 并发 → maxConcurrent>2(无帽)。
- **治理**:discoverQueryCached 套同一信号量——**discover 全部昂贵 DB 查询(持久+长尾)共享帽 2**。键空间单快照组合上限 7,150(跨快照历史并集未严格封顶,十六轮登记 P1)× 并发 2 有帽 = 持久路径 DB 预算闭环。
- **治理后测试**:不同键 8 并发 maxConcurrent ≤ 2 ✅。预算口径统一为"单一全局 discover DB 并发上限=2/进程"。

## 两处过时注释 — 已修正
- lib/discover.ts 监控说明:v3/ovld10m → v4/qf10m+bt10m(与服务器实际部署一致);链路验证状态更新(queue-full 已实测入日志;budget-timeout 待部署后 bt10m 观察)。
- page.tsx:"不触发 DB" → "不调 discoverQuery,但 facets 冷读仍可能触 DB"。

## sample.sh v4 源码 + 压测原始数据 — 已补进入库评审文档
v4 全文(含 py2 兼容解析器 observe_parse.py)+ 60 并发压测原始数据(P50=1.33s/P95=2.56s/max 2.66s/4 降级/RSS 195→56MB/连接 2→0)已写入 docs/review/ 入库版,供独立审查:时区处理(utcnow=UTC 与日志 time 一致)、轮转文件(.1+当前都扫)、损坏行(try/except 跳过)、cron 重叠(10 分钟窗口+固定 cron 不重叠)、err10m 口径(db-query-timeout/unavailable/CONNECT_TIMEOUT 三类)。

## 验收记录(新 HEAD 2c75835)
全套件 **186 passed | 5 skipped**(净增 2:cached 路径行为 2 例);tsc 零错;build(隔离库)通过。

## 待评审裁决事项
1. 持久路径共享帽的治理方案是否认可(或要求独立帽/独立预算);
2. 合并审批(评审十轮已给"有条件批准合并 main",四项前置:main 同步 ✅、Top 冷 miss 验证 ✅(含治理)、注释修正 ✅、最终 SHA 全套重跑 ✅);
3. HK 部署审批(生产冻结中;HK RestartCount 持续恶化中,合并≠部署,等独立审批)。


---

# 评审十一轮回应(2026-10-30,最新 HEAD 见文末,已 push)

## 十轮文档不一致 — 已修正
- 十轮回应标题补注:代码验收 SHA=2c75835,文档追加 HEAD=75497ce,两者之间仅文档变化;186 项测试在 2c75835 上执行并已在后续提交复跑确认等效。

## P0:持久路径信号量契约破坏 — 已修复(评审实锤的确定性缺陷)
你指出的完全属实:`discoverQueryCached` 未检查 `acquireLongtailSlot()` 返回值——budget-exceeded/queue-full 时仍执行 SQL **且无条件 release**(错误递减 `_running`+把槽位转交给无人认领的等待者)。过载路径直接击穿并发帽。

**修复(按你的契约表逐项对齐)**:

| 获取结果 | 执行 SQL | release | 返回状态 |
|---|---|---|---|
| acquired | 是 | 是 | ok |
| budget-exceeded | 否 | 否 | overloaded |
| queue-full | 否 | 否 | overloaded |

**持久缓存防污染**(你预警的第二个坑):过载通过专用 `DiscoverOverloadedError` **throw**——`'use cache'` 对 throw 的处理=该次结果**不写入持久缓存**(瞬时过载不会被缓存成长期"繁忙");`discoverQuery` 捕获该错误转为 `status:'overloaded'`,页面渲染"查询繁忙"。缓存函数只缓存成功查询结果。

**六断言行为测试**(tests/discover-cached-path-behavior.test.ts 重写,3 例):
1. 两个请求占满槽 → 第三请求(排队 3s 超时)**不执行 SQL**(`sqlCalls=2`)+ 状态 overloaded;
2. `running` 全部落定后**恰好归零**(不被错误递减成负数/提前转交);
3. 队列满(52 请求)→ 5 个超容量请求**零 SQL**(`sqlCalls` 不变)+ 立即 overloaded + `queueFullRejects` 递增;
4. 正常路径:acquired→SQL→release→三计数归零。

## 次要三项 — 已同步
1. "榜单/API/同步永远有连接可用"删净,改为:"Discover 查询最多占用 2 个并发槽位,为其他数据库操作保留连接池容量;但其他业务之间仍共享连接池,不构成连接隔离保证";
2. 测试文件头明确:"Next 真实填充合并由 standalone 验证(另一层证据,不在本测试声称范围)";
3. `MAX_LONGTAIL_CONCURRENT` → **`MAX_DISCOVER_DB_CONCURRENT`**;`acquireLongtailSlot/releaseLongtailSlot` → `acquireDiscoverSlot/releaseDiscoverSlot`;注释同步"帽的作用域=全部 Discover 昂贵查询,不只长尾"。

## 验收记录(最新 HEAD,评审十一轮要求的六项)
- 全套件 **187 passed | 5 skipped**(净增 1:队列满契约用例;持久路径 3 例契约测试覆盖你列的六断言);
- 持久路径队列满测试 ✅;持久路径预算超时测试 ✅;长尾与持久混合并发 ✅(原有 Ⅳ + 新契约用例);tsc 零错;隔离库 build ✅。

# 评审十二轮回应(2026-10-30,commit 4f97432,已 push)

你的三条全部属实,逐条修:

## 1. 队列满测试确实走的长尾路径(claim 属实,测试已重写)
你的核查正确:原 `full-${stamp}-${i}` 不在 `TOP_FACETS.topics=['ai','web']` → `inTopTopic=false` → 52 个请求全部走 `discoverQueryEphemeral`,持久路径队列满没有被覆盖。
**修复方案**(tests/discover-cached-path-behavior.test.ts 用例④重写):lang/topic 均取自 Top 榜(保证 `inTopLang && inTopTopic` → 命中 `discoverQueryCached`),用 lang(2)×topic(2)×band(4)×age(4)×sort(2) 维度组合出 52 个互异键制造排队。断言:running=2 / queued=50 / **inflight=0**(长尾 single-flight 才会有 inflight>0,持久路径恒为 0——这是"确实走持久路径"的结构性旁证)、后续 5 个请求零 SQL + queueFullRejects 递增。
一处如实说明:队列满后追加的 5 个请求与首批同键,可能命中同键填充 Promise,断言放宽为 `status ∈ {ok, overloaded}`(同键合并不是契约违规;队列满的 5 个**独立键**请求零 SQL 才是契约本体)。

## 2. 旧注释属实残留,已删净
全仓 grep `永远有连接可用|MAX_CONCURRENT|长尾最多占`:代码侧 lib/discover.ts:214-215 确实残留,已改为评审十一轮给定措辞(含"不构成连接隔离保证");评审文档三轮章节的两处旧表述同步修正。现仅剩本轮回应里的引用性文字。

## 3. standalone 真实验证已完成(Next 16.4.2 真框架,非 mock)
用最小 Next 16.4.2 应用(`cacheComponents: true`,'use cache' 真实生效)验证过载 throw 与持久缓存的边界,**dev 与 `next start` 生产模式各跑一遍,结果一致**:

| 步骤 | 操作 | 结果 | 结论 |
|---|---|---|---|
| ① | 冷键首次填充(正常) | ok,calls=1 | 成功结果进缓存 |
| ② | 同键第二次 | ok,calls 仍=1(同一 at 时间戳) | **'use cache' 同键填充合并真实存在** |
| ③ | 已缓存键切 overload 后再请求 | ok,仍返回旧缓存 | 缓存新鲜期内不触发重算(符合 cacheLife stale 语义) |
| ④ | **冷键在 overload 下请求** | 503 throw(OverloadedError) | throw 正常传播给调用方 |
| ⑤ | 冷键再试(仍 overload) | 503 throw,calls 再+1 | **throw 的结果没有被缓存**(否则第二次会直接命中) |
| ⑥ | 恢复正常,同键请求 | ok,calls+1 | **恢复后同键真实重查成功**——瞬时过载未固化 |

生产模式补充观察:dev 下 throw 保留自定义 Error name(`OverloadedError`),`next start` 下序列化为通用 `Error`——不影响我们契约(调用方按 instanceof/状态判定,不依赖 name;且页面侧由 discoverQuery 捕获转 overloaded,异常不跨边界裸抛)。
验证产物:`/tmp/uc-verify`(最小应用 + `/app/api/probe/route.ts` 复现脚本),六步 curl 序列可直接复跑。

## 验收记录(评审十二轮 HEAD)
- 全套件 **187 passed | 5 skipped**;tsc 零错;隔离库 build ✅(next build 786 页);
- 队列满测试已真命中持久路径 ✅;旧注释删净 ✅;standalone 六步验证(dev+prod 双模式)✅。

---

# 评审十三轮回应(2026-10-30,commit 6d726cb,已 push)

## P0:生产模式过载识别——你说得完全对,已用真框架实测复现并修复

### 复现(Next 16.4.2 真框架,`next start` 生产模式,非 mock)
最小 'use cache' 应用,生产模式冷键过载 throw,外层捕获到的异常:
```
name: "Error"
message: "An error occurred in the Server Components render. The specific message is
omitted in production builds to avoid leaking sensitive details. A digest property is
included on this error instance..."
instanceofCheck(自定义类): false
```
**name、message、自定义字段、原型——四样全被生产脱敏替换**(dev 模式保留)。因此
`instanceof DiscoverOverloadedError` 在生产恒 false → 过载被外层归入 degraded
("数据源不可用")而非"查询繁忙"。你的推断逐字成立。

### 方案选型(做了四组对照实验)
| 方案 | 实测结果 | 裁决 |
|---|---|---|
| A. message 特征码 | 生产 message 整个被脱敏替换,includes 匹配不到 | ❌ 死路(也如你要求不采用这种脆弱方式) |
| C. 不 throw,返回 sentinel 联合 | **sentinel 返回值被持久缓存**(恢复后同键仍返回过载标记,直到 expire) | ❌ 违反"瞬时过载不得固化"铁律 |
| G. 信号量搬到 'use cache' 外 | 破坏"同键冷 miss 才占槽"的语义(缓存命中也会先过信号量) | ❌ 形状不对 |
| **H''. 缓存函数内打进程内标记 + rethrow 普通 Error** | 全场景通过 | ✅ 采用 |

### 采用方案 H''(lib/discover.ts)
- `discoverQueryCached` 在 **同栈内**(instanceof 100% 可靠,Next 边界还没碰它)catch 到
  `DiscoverOverloadedError` 后,先打进程内标记 `_overloadSignal`(计数器+时间戳),
  再 rethrow——rethrow 的是普通 Error,身份被生产模式抹掉也无所谓;
- `discoverQuery` 的 catch 改读标记:`本请求期间计数器有增量 && 时间窗(1s)内` →
  `status:'overloaded'`;否则继续上抛 → 页面 degraded。
- throw 语义不变:'use cache' 对 throw 不写持久缓存——防污染机制原样保留。

### 生产模式六步终验(同 H'' 改造后复跑)
| 场景 | 结果 |
|---|---|
| 冷键过载 | status:'overloaded'(标记识别,非 instanceof) |
| 恢复后同键 | ok,真实重查(throw 未污染缓存,calls+1) |
| DB 真错(无过载标记) | degraded,不误判 |
| 过载标记过期(2s)后 DB 错 | degraded,时间窗防陈旧标记 |
| 冷键持续过载重试 | 仍 throw(calls 每次+1),未缓存 |
| 5 个高并发过载 | 5/5 各自识别 overloaded |

### 已知边界(诚实记账)
真并发下"过载 throw"与"DB 真错"在 1s 时间窗内重叠时,DB 错会被误标为 overloaded——
两者渲染同一张降级卡,差异仅文案("查询繁忙"vs"数据源不可用"),**无正确性风险**;
顺序请求(含高并发同型请求)零歧义(10 连发实测 5 过载 5 DB错全判对)。窗口收敛到
亚秒级可再降误判率,但会开始漏判慢路径里的真过载,1s 是折中初值,待生产基线校准。

## 队列满测试独立键断言(你的"小缺口",已补)
5 个拒绝请求改为互不相同且均命中 Top 榜的组合(lang=python, topic=web, band×age×sort 5 组互异键):
每个断言 `status === 'overloaded'`(不再允许同键合并的 ok)+ `queueFullRejects ≥ before+5`
+ `sqlCalls` 不变(独立键零 SQL)。

## 验收记录(评审十三轮 HEAD)
- 全套件 **187 passed | 5 skipped**;tsc 零错;next build 786 页 ✅;
- 生产模式复现证据+四方案对照+H'' 六步终验:全部真实 Next 16.4.2 框架实测(非 mock)。

---


---

# 评审十四轮回应(2026-10-30,commit 22dd356,已 push)

## 1. 全局计数器的并发误判窗——裁决成立,标记已改【键级】+【缓存作用域内 catch】

你的交错表逐行成立:全局计数器只能证明"进程里有人发生过载",不能证明"当前请求"。已重做:

**新机制(lib/discover.ts)**:
- 标记载体:`Map<稳定缓存键, 打标时刻>`(`_overloadMarks`),键 = `buildDiscoverCacheKey(f)`
  (与长尾微缓存键同构,JSON.stringify 过滤五维——cacheable 恰为纯 DiscoverFilters,序列化稳定);
- 打标位置:**'use cache' 函数内部**(discoverQueryCached 里 acquireDiscoverSlot 返回非
  acquired 时,先打自己键的标记再 throw)。这里有个被真框架实测锁死的关键事实:
  **外层 wrapper 的 catch 拿到的已被 Next 重序列化(生产模式下 instanceof 恒 false),
  但缓存函数作用域内部的 try/catch 在 Next 碰它之前执行,instanceof 可靠**——
  十三轮的 standalone 里 wrapper 版实验实测 name="Error"/isOverloaded=false,
  内部 catch 版实测 instanceof 命中,这是打标点必须放在缓存函数内的实证依据;
- 消费位置:discoverQuery 外层 catch 用【同一个 buildDiscoverCacheKey 结果】查自己的键;
  惰性过期(1s TTL,过期标记当场删除);
- 容量帽:OVERLOAD_MARK_MAX=1000,满时先清过期项再 FIFO 逐出(键空间有界,纯防御兜底);
- 隔离性质:标记挂键不挂进程——A 键的过载标记只影响 A 键,B(DB 真错)查 B 键查不到 →
  degraded,**并发误判窗从"1s 全进程"收敛为"同键时间窗"**;而同键的"过载+DB 错"不存在
  (同键同查询同结果,'use cache' 同键填充合并保证同键请求要么共享成功要么共享 throw);
- DB 真错路径显式不打标记(discoverQueryCached 的 try/catch 对 discoverFilteredUncached
  的 throw 原样上抛,只 release 不打标)——故障分类不再被过载信号污染;
- throw 语义不变:'use cache' 对 throw 不写持久缓存(防污染机制原样保留)。

**真框架终验(Next 16.4.2 `next start` 生产模式)**:
| 场景 | 结果 |
|---|---|
| A 冷键过载 | overloaded(键级标记识别) |
| B 冷键 DB 真错(紧随其后同窗) | degraded,不误判 |
| A 过载与 B DB 错【真同时】(后台并行 5 轮) | **5/5 A=overloaded / B=degraded** |
| 同键并发 3 个(全过载) | 3/3 overloaded,结果一致 |
| 持续过载重试 | 仍 throw(calls 每次+1),不缓存 |
| 恢复后同键 | ok,真实重查 |

十三轮披露的"1s 窗口 DB 错可能被误标"边界**已消除**,不再是折中项。

## 2. 5 独立键测试——你的重复指控核实成立,已重做

用独立脚本展开首批 52 键集合核验:旧第 2 组 `python/web/s2/90/stars`(=首批第 44 个)、
第 4 组 `python/web/s0/7/stars`(=首批第 4 个)确实重复,我的"与首批也不重叠"注释是错的。

**重做(tests/discover-cached-path-behavior.test.ts)**:
- 首批 52 键生成时显式建 `firstKeys` 集合 + 防御性断言 `firstKeys.size === 52`
  (生成器若退化立即暴露);
- 5 个拒绝键改为显式表列(从 python/web 固定下 32 组合中剔除已被首批占用的 13 组、
  取剩余 19 组中 5 组:s1/year/stars、s2/year/stars、s3/year/stars、s0/7/gain、s0/30/gain),
  **逐键断言 `firstKeys.has(k) === false`** + `rejectKeys.size === 5`;
- 如实声明两层边界(如你裁决所写):Vitest 层(next/cache 为直通 stub)验证的是
  业务/信号量行为(拒绝计数+5、零 SQL);**Next 真实持久缓存层的同键填充合并行为
  由 standalone 生产模式另行验证,不在此测试声称范围**。真 Next 生产模式下 5 个独立
  冷键逐键过载的行为已在上表覆盖(每键各自 throw 不缓存、恢复后各自重查)。

## 验收记录(评审十四轮 HEAD)
- 全套件 **187 passed | 5 skipped**;tsc 零错;next build 786 页 ✅;
- 键级标记生产矩阵(6 场景+5 轮真并发压测)全部 Next 16.4.2 真框架实测,非 mock。

---

# 评审十五轮回应(2026-10-30,commit da38f08,已 push)

## P0:同键历史标记污染——裁决成立,已改键级 generation 代数

你的复现链(标记有效时直接 return 不删 → 同键 TTL 内先过载后 DB 真错 → 后者被误判)
核实成立;且你指出的"简单删除会破坏同键并发等待者识别"也成立——两个方向都堵死了
时间戳标记的出路。已按你建议改 **generation**:

**新机制(lib/discover.ts)**:
- `Map<缓存键, generation>` 单调递增,**永不删除、永不重置、无 TTL**;
- 请求进入 discoverQuery 时快照 `genBefore = _overloadGen.get(key) ?? 0`;
- 缓存作用域内未获槽位 → `generation+1` → throw(slot 判定权威,不依赖 instanceof);
- 外层 catch:`generation > genBefore` 才认定本次过载,否则继续上抛 → degraded;
- **容量治理即评审提醒的"清理不重置在途引用"的根本解:不清理**。此 Map 只被
  持久路径写入,键空间=评审二轮键不变式的有界集合(≈7,150)【十六轮裁决修正:此为单次快照组合上限,生命周期上限=历史快照键并集未严格封顶,已登记 P1】,
  没有任何需要删除的条目,也就不存在删除重进导致 generation 归零误判的路径。

**迭代史入档**(每轮都被真框架实测纠错):十三轮全局计数器+时间窗=跨请求误判窗;
十四轮键级时间戳=同键历史污染(你抓的)+删除时序两难;十五轮 generation 消除
"删除时序"这个概念本身。

**真框架三场景终验(Next 16.4.2 `next start` 生产模式,逐场景)**:
| 场景 | 结果 |
|---|---|
| ① 同键过载,3 个并发等待者 | 3/3 overloaded(同键填充合并,共享同一次 throw,判定一致) |
| ② 同键紧接 DB 真错(旧方案必污染的时序) | **degraded**,历史 generation 不影响新请求 |
| ③ 恢复后同键正常查询 | ok,成功结果进缓存,不受历史 generation 影响 |
| ④(加测)另一键 DB 错 | degraded(跨键隔离沿用十四轮矩阵) |

## 验收记录(评审十五轮 HEAD)
- 全套件 **187 passed | 5 skipped**;tsc 零错;next build 786 页 ✅;
- 三场景+加测共 4 项真框架生产模式实测,非 mock。

---

# 评审十六轮回应(2026-10-30,commit 5193a2d,已 push)

## 你推导的竞态窗口:已用真框架验证,结论=真实代码形状下窗口结构性为零 + 已加防回归警示

### 验证过程(全部 Next 16.4.2 `next start` 真框架)
**① 人为窗口实验(实锤你的推导路径存在)**:在 bump 与 throw 之间人为插入 500ms await,
B 在 +200ms 进入(快照=1),join 同一次已 bump 的填充 → 收同一 reject →
`1 > 1` 不成立 → **B=degraded,你的推导逐字复现**。这个窗口确实存在——
但仅存在于"bump 与 throw 之间有 await"的代码形状。

**② 真实代码形状验证(窗口=0 的结构性依据)**:项目代码里 bump 与 throw 是
同步相邻语句(`_overloadGen.set(...)` 后立即 `throw`,lib/discover.ts,无任何 await)。
JS 单线程模型下,同步段内不可能有其它请求读取快照——"后来者快照已含 bump"的事件
序列在真实代码中无法发生。实测:
- B 依次晚到 5 次:5/5 **重新执行**(calls 每次+1,证明 'use cache' 对 throw 不重放
  rejected promise,而是当缓存 miss 重新进函数)→ 重新 acquire → 再次 bump →
  `genAfter = genBefore+1` → 5/5 overloaded;
- 同一 tick 并发 5 个:5/5 同样全识别;
- 评审要求的四步时序矩阵:A 过载(gen 0→1)→ B 同键(gen 1→2,重新执行识别)→
  同键 DB 真错(gen 2→2,**degraded**,不继承旧过载)→ 恢复后 ok。**全部符合预期。**

### 你两个要求的"必须同时成立",逐条对应
- "同一次填充的所有等待者都能识别过载":同一次填充的等待者共享同一次 bump 与同一次
  reject,凡快照在 bump 前取得者 100% 识别(十五轮 3 并发 + 本轮同 tick 5 并发);
  快照在 bump 后取得者在真实形状下不可能发生(同步段无 await),一旦发生(未来改动
  引入 await)会退化为 degraded——已用警示注释把"bump 与 throw 之间禁止插入 await"
  钉死在代码里,防回归。
- "新一轮 DB 查询不能继承旧过载状态":generation 只在本请求期间有增量才判过载;
  DB 真错场景实测 gen 不增(2→2)→ degraded;恢复后 ok。历史 generation 对新请求
  零影响(十五轮已证,本轮矩阵③复证)。

### 如实记录
- "键空间上限仍需以键不变式测试为依据":接受,键不变式(评审二轮 04f6130 的
  缓存键不变式测试)已存在且覆盖 52 键互异断言(十四轮 firstKeys.size===52),
  generation Map 尺寸上限=持久键空间上限这一点依赖同一不变式,两处同源;
- 全套件/tsc/build 在本轮最终 SHA 复跑:**187 passed | 5 skipped,tsc 零错,
  next build 786 页**——供你独立复核。

## 验收记录(评审十六轮 HEAD)
- 竞态窗口:人为间隙实验(实锤窗口存在条件)+ 真实形状 5/5 + 同 tick 5/5 +
  四步时序矩阵,全部真框架生产模式实测;
- 代码侧唯一变更=lib/discover.ts 警示注释(bump-throw 同步相邻不变式),零逻辑改动。

---

# 评审十六轮收口回应(2026-10-30,commit ddeaa49,已 push)

## 1. 合并批准 — 收到,等待你方正式裁决指令后执行
十六轮两项实验被认可(失效条件反向实验+真实形状恢复验证)。合并到 main 的执行
等待评审方最终"批准合并"的明确指令(此前裁决均为"暂缓",本轮为"建议允许合并"——
按流程以你的正式批准为准,我们不自行合并)。

## 2. generation Map 跨 facets 轮换容量 — 裁决成立,已修正表述并登记 P1
你区分的"单次快照组合上限"vs"进程生命周期 Map 上限"核实成立:
- 7,150 = 单次 facets 快照下的组合上限:
  (Top10 lang+1) × (Top12 topic+1) × (4 band+1) ×
  (4 age+1) × 2 sort = 11×13×5×5×2;
  前四项包含缺省值,sort 为两个取值。
- facets 随 6h 同步动态预计算,Top 榜轮换后旧组合不再进入持久路径,但其 generation
  留存在永不清理的 Map 里——进程生命周期上限=历史所有快照键集合并集,"严格封顶"不成立;
- **已改口径**:lib/discover.ts 注释与评审文档不再写"天然封顶",改为如实描述
  (增长速率≈每次 Top 榜轮换新增至多数千条、每条约百字节,不构成实际内存风险,
  但未证明严格上限);
- **登记 P1**:generation 信号改为带生命周期的结构(如分代快照归档/低频清扫仍在途
  保护的条目),保留并发等待者识别能力——与保护资产批合并排期,不阻塞合并;
- 现有键不变式测试补一条缺口记账:未枚举跨 facets 快照轮换的历史键集合并集上限,
  随 P1 一并补。

---

# 评审十六轮退回修正(2026-10-30,commit 296f054,已 push)

你指出的三处内部矛盾全部核实成立,已统一口径:

1. **lib/discover.ts 旧注释残留**:`DiscoverOverloadedError` 上方文档块仍写"容量天然有界
   (≈7,150)"——已改为十六轮裁决口径(7,150=单次快照组合上限;生命周期上限=历史快照
   键并集,未严格证明,已登记 P1);
2. **测试注释 4,800**:tests/discover-cache-key-invariants.test.ts 第Ⅳ项已改为 7,150
   (含缺省值,评审三轮校准),并明确标注:该测试验证【单次快照内的路径归属】
   (归一化+Top 榜归属),**不证明进程生命周期 Map 上限**——跨快照轮换的历史键集合
   未覆盖,随 P1 补;
3. **评审文档口径统一**:三轮历史算术(108 行,4,800)补"三轮后校准 7,150+十六轮
   单快照/生命周期区分"注记(保留历史原貌不改写);六轮治理章节(364 行)与十五轮
   章节(587 行)的"7,150 有界/天然封顶"均加十六轮裁决修正注;收口章节(666 行)
   "不再写天然封顶"的说法现在与全文一致。

验收(本轮 HEAD):全套件 **187 passed | 5 skipped**;tsc 零错。本轮零逻辑改动,
仅注释与文档口径统一。

---

# 评审十六轮算术修正(2026-10-30,commit a11bc2a,已 push;文档 SHA 修正为独立提交 599c0d9 链,以远端 HEAD 为准)

band 缺省值漏写核实成立:正确公式 = **(Top10 lang+1) × (Top12 topic+1) × (4 band+1) × (4 age+1) × 2 sort = 11×13×5×5×2 = 7,150**(已脚本验算)。原写法"4 band × 5 age"自相矛盾——age 计了缺省 band 没计,数字对、公式错。

修正三处:
1. tests/discover-cache-key-invariants.test.ts 第Ⅳ项:公式补全各项缺省值+显式验算 11×13×5×5×2;
2. lib/discover.ts:153(概数行)精确化,并带上"单快照组合上限+跨快照 P1"口径;
3. 评审文档 156/662/108 行公式全部统一为同一显式形式。

零逻辑改动。验收(本轮 HEAD):全套件 187 passed | 5 skipped;tsc 零错;build 786 页。

# CampusPilot 地点推荐调查报告

- 调查分支：`feature/location-recommendation`
- 调查日期：2026-10-19
- 范围：只调查和记录；未修改 `src/scheduler.ts`、`src/main.tsx` 或地点分配行为。

## 结论

页面目前没有调用或渲染 `recommendLocations()` 的结果。页面出现的 Thompson Library 来自样例请求中唯一的地点，而不是推荐函数筛选后只剩一个地点。另一个独立问题是共享调度器固定选取 `request.locations[0]`，并将其 ID 写入每个成功安排的学习块。即使请求传入五个地点，当前调度器仍会把所有学习块分配到第一个地点。

## 1. 实际日期、时间和筛选条件下的推荐结果

- 页面入口在 [`src/main.tsx:3-9`](../src/main.tsx)，将 `sampleRequest` 交给 `Dashboard`。[`src/sample.ts:4-5`](../src/sample.ts) 固定了 2026-10-19 09:00–17:00（`-04:00`，校园当地时间），不是随当前日期变化的请求。
- 点击 **Build my day** 后，样例请求产生三个学习块。下表将调度器返回的 UTC 时间按 `America/New_York` 转为周一的当地时间，再以 `preferences = {}` 和默认地点、默认模拟可用时段调用 `recommendLocations()`。当前页面没有偏好设置，也没有实际发起这一调用，因此表中是对实际学习块的独立复现，不是当前 UI 发出的请求。

| 学习块 | 2026-10-19 当地时间 | 推荐地点数 | 返回顺序 |
| --- | --- | ---: | --- |
| `math-review` | 11:00–12:00 | 5 | 18th Avenue Library；FAES Library & Student Success Center；Health Sciences Library；Thompson Library；Ohio Union |
| `writing` | 13:00–14:00 | 5 | 同上 |
| `cse-practice` | 15:00–16:30 | 5 | 同上 |

前四个地点各为 70 分，Ohio Union 为 50 分；因为没有传入 `origin`，步行时间是 `null`，同分地点按名称排序。`reading` 没有被安排，因此没有对应学习块可供推荐。[`src/features/campus-locations/recommendLocations.ts:74-116`](../src/features/campus-locations/recommendLocations.ts) 使用默认的五个静态地点和模拟可用时段，只在单个模拟开放窗口完整覆盖学习块时纳入地点；`requireReservable`、`categoryFilter`、`origin` 和 `maxWalkMinutes` 都是可选条件，当前 UI 均未设置。开放时段是手工模拟值，不代表 2026-10-19 的实时营业或空位情况，见 [`src/features/campus-locations/simulatedAvailability.ts:1-8`](../src/features/campus-locations/simulatedAvailability.ts)。

模块已有的周一 10:00–12:00 测试也返回全部五个地点，见 [`tests/campus-locations.test.ts:144-145`](../tests/campus-locations.test.ts)。这个测试时段与当前样例实际安排的 11:00–12:00、13:00–14:00、15:00–16:30 不完全相同，因此本次另行复现了三个实际时段。

## 2. 从推荐函数到页面的调用链

**推荐路径在模块导出处结束：**

`campusLocations.ts` + `simulatedAvailability.ts` → [`recommendLocations.ts:74-116`](../src/features/campus-locations/recommendLocations.ts) → [`features/campus-locations/index.ts:21-28`](../src/features/campus-locations/index.ts) 对外导出。生产代码中没有组件、`Dashboard` 或入口文件导入或调用 `recommendLocations()`；调用只存在于地点模块的测试及 README 示例。因而没有“推荐结果返回后被前端过滤到一个”的步骤，也没有推荐列表渲染组件。

**实际页面路径：**

[`main.tsx:4-9`](../src/main.tsx) 的 `sampleRequest` → [`Dashboard.tsx:27-29`](../src/ui/Dashboard.tsx) 保存请求 → [`Dashboard.tsx:35-37`](../src/ui/Dashboard.tsx) 调用 `generateMockSchedule(request)` → [`Dashboard.tsx:76-98`](../src/ui/Dashboard.tsx) 将结果、选中块和请求传给各组件。页头直接把 `request.locations` 的名称拼接显示，见 [`AppHeader.tsx:25-27`](../src/ui/components/AppHeader.tsx)。时间轴和 Study plan 列表只展示学习块及选中按钮，点击后设置 `selectedId`，见 [`WeeklySchedule.tsx:169-191`](../src/ui/components/WeeklySchedule.tsx) 和 [`ScheduleResults.tsx:82-101`](../src/ui/components/ScheduleResults.tsx)。`Dashboard` 根据 `selectedId` 找到一个块，`LocationCard` 再按该块的 `locationId` 到 `request.locations` 查找并显示一个分配地点，见 [`LocationCard.tsx:17-29`](../src/ui/components/LocationCard.tsx) 和 [`LocationCard.tsx:37-49`](../src/ui/components/LocationCard.tsx)。未选中学习块时，卡片显示 “No block selected”。它的设计是所选学习块的地点详情卡片，不是推荐地点列表。

## 3. 地点输入和 `locationId` 分配

- [`src/sample.ts:22`](../src/sample.ts) 仅传入 `{ id: 'thompson', name: 'Thompson Library' }`。地点模块的五个正式 ID 在 [`campusLocations.ts:25-90`](../src/features/campus-locations/campusLocations.ts)：`thompson-library`、`18th-avenue-library`、`health-sciences-library`、`faes-library`、`ohio-union`。样例的 `thompson` 与地点模块的 `thompson-library` 不一致；若按 ID 将当前样例分配结果与地点模块直接关联，将无法匹配 Thompson。适配函数 `toScheduleLocations()` 会输出五个 `{ id, name }`，见 [`campusLocations.ts:92-100`](../src/features/campus-locations/campusLocations.ts)，但目前入口未使用它。
- [`src/scheduler.ts:31-35`](../src/scheduler.ts) 在任务循环前执行 `const location = request.locations[0]`；[`src/scheduler.ts:52-56`](../src/scheduler.ts) 对每个成功安排的任务都写入同一个 `location.id`。此处没有调用推荐函数，也没有按学习块时间判断地点开放情况。
- 运行样例请求时，三个块的 `locationId` 都是 `thompson`。把请求地点换成 `toScheduleLocations()` 的五个地点后，三个块都变成 `thompson-library`；把该列表倒序后，三个块都变成 `ohio-union`。这证明地点分配只随请求数组的首项变化，不随推荐排序或可用时段变化。

## 4. 两个独立问题和建议修复

| 问题 | 已确认原因 | 建议 |
| --- | --- | --- |
| 推荐界面只看到 Thompson Library | 当前并不存在消费 `recommendLocations()` 的推荐界面；页头和选中块的 `Where` 卡片读取样例请求，而样例请求只有 Thompson 一个地点。 | 在 UI 层给选中学习块按 `America/New_York` 转换星期与当日分钟，调用 `recommendLocations()` 并单独渲染完整候选列表、评分理由与模拟数据说明。保留“已分配地点”与“可选推荐”两种语义。这个展示改动可以不改变共享调度器。 |
| 日程学习块都分配到第一个地点 | 调度器在循环前固定读取 `request.locations[0]`，每个成功块都使用该 ID。 | 请 A 先决定地点分配策略：地点由学生显式选择，还是按推荐结果自动选择；若自动选择，还需明确可用性、偏好、冲突和无匹配地点的处理规则。策略审核后再改变共享调度器或其边界上的分配流程，并增加跨多个地点的行为测试。仅增加 `sampleRequest.locations` 的项目数不能解决此问题。 |

接入前还应统一样例 ID 与地点模块 ID，并确保同一规范 ID 被推荐结果、`request.locations` 和 `StudyBlock.locationId` 使用；不要只按相同名称关联。此项可在不改变共享调度器算法的前提下处理，但应与 UI 接入一起核对回归结果。

## 核验

- 在 `feature/location-recommendation` 分支执行 Node 脚本，直接调用 `generateMockSchedule(sampleRequest)`，再对三个实际时段调用 `recommendLocations(window)`；结果如上表。
- 用样例单地点、`toScheduleLocations()` 五地点及其倒序列表分别调用调度器，确认每次所有成功块均指向请求列表首项。
- `node --test tests/campus-locations.test.ts tests/scheduler.test.ts`：41 项通过，0 失败。

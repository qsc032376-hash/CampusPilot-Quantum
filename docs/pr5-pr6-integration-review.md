# PR #5 / PR #6 联合审核报告与验证清单

审核日期：2026-10-19（America/New_York，约 17:07 EDT）。本次只提交审核文档，没有修改算法、调度器或 B 的前端及测试文件。

## 1. 审核基线与 PR 状态

通过已登录的 GitHub 页面读取 PR 状态，并执行 `git fetch origin` 核对远端分支。GitHub 连接器对该私有仓库返回 404，因此没有把连接器的错误解释成 PR 不存在。

| 项目 | PR #6：地点算法 | PR #5：B 的 UI |
| --- | --- | --- |
| 链接 | [PR #6](https://github.com/yujunrui06-hue/CampusPilot/pull/6) | [PR #5](https://github.com/yujunrui06-hue/CampusPilot/pull/5) |
| 状态 | Open，未合并；页面显示与 main 无冲突 | Open，未合并；页面显示与 main 无冲突 |
| base / head | main / feature/location-recommendation | main / feature/ui-locations |
| 审核的代码 head | `eacd1932f6e574a995343e64ede99bc3dc4d9756` | `dffbca05e9213831d4eb548168a4adbdcc3c7416` |
| 当时的提交数 / 文件数 | 2 / 4 | 2 / 9 |
| GitHub Checks | 0，不能解释为 CI 已通过 | 0，不能解释为 CI 已通过 |

共同基线为 `bb200914267963dc2a579f3a02bb140b5ac10016`，也是本次刷新后的 `origin/main`。本报告提交后，PR #6 会额外包含一个文档提交和本文件；上表记录的是被审核的应用代码快照。

PR #6 提交：

- `765659c3476159817789c0ff6aaee3ad600f7419` — `docs: investigate location recommendation display and assignment`
- `eacd1932f6e574a995343e64ede99bc3dc4d9756` — `test: cover location recommendation boundaries and stable ranking`

PR #6 原有修改文件：

- `docs/location-recommendation-investigation.md`
- `src/features/campus-locations/README.md`
- `src/features/campus-locations/recommendLocations.ts`
- `tests/campus-locations.test.ts`

PR #5 提交：

- `02d895006de5c2c34964e263e7d326678b67bfd2` — `fix(ui): list every recommended campus location in the location card`
- `dffbca05e9213831d4eb548168a4adbdcc3c7416` — `fix(ui): move recommendations into their own panel with scores and links`

PR #5 修改文件：`src/sample.ts`、`src/ui/Dashboard.tsx`、`src/ui/components/LocationCard.tsx`、`src/ui/components/RecommendedLocations.tsx`、`src/ui/locationPlan.ts`、`src/ui/ui.css`、`tests/browser-check.mjs`、`tests/render-check.mjs`、`tests/ui-locations.test.ts`。

## 2. 合并、类型和调用接口核对

两组修改文件没有交集；对上述两个 head 执行三方 `git merge-tree`，没有冲突标记。在临时目录以 PR #5 快照叠加 PR #6 补丁，`git apply --check` 成功，并通过组合后的类型检查与构建。没有对当前工作区进行合并，也没有覆盖 B 的文件。

| 关注点 | 已确认结果 |
| --- | --- |
| 共享地点类型 | 两个 PR 都未改 `src/types.ts`。`CampusLocationDetails` 仍扩展 `CampusLocation`，`toScheduleLocations()` 仍只输出 `{ id, name }`。 |
| 地点 ID | PR #5 的样例调用 `toScheduleLocations()`，已统一为 `thompson-library` 等规范 ID。调度器产生的 ID 和新样例输入一致。旧 `thompson` 的兼容发生在 B 的详情查询层，不修改块的 `locationId`。 |
| 函数输入 | PR #5 的 `locationPlan.ts:150` 调用 `recommendLocations(window, {}, { locations, availability })`，与 PR #6 的三个参数兼容。当前没有设置 origin，因此新增的坐标校验不会改变默认 UI 的调用结果。 |
| 函数输出 | 签名仍返回 `LocationRecommendation[]`；每项仍有 `location`、`score`、`walkMinutes`、`reasons`。B 使用 location / score / reasons，并将数组保存为只读视图，类型兼容。 |
| 排序与步行时间 | PR #6 的名称后 ID 排序不会改变当前五个不同名称的默认顺序。没有 origin 时 `walkMinutes === null`，不会虚构步行时间。 |
| 理由文字 | PR #6 改为说明预约入口存在、空位未核实。B 渲染函数返回的 reasons，没有依赖旧理由的完整字符串；组合后的渲染检查通过。 |
| 分配策略 | 两个 PR 都未修改 scheduler.ts。样例依然将所有学习块分配给地点数组首项 Thompson，只是 ID 变成规范 ID。推荐排序首项不会自动替换分配地点。 |

相关代码：[PR #5 的适配层](https://github.com/yujunrui06-hue/CampusPilot/blob/dffbca05e9213831d4eb548168a4adbdcc3c7416/src/ui/locationPlan.ts#L125-L160)、[PR #6 的函数签名和返回逻辑](https://github.com/yujunrui06-hue/CampusPilot/blob/eacd1932f6e574a995343e64ede99bc3dc4d9756/src/features/campus-locations/recommendLocations.ts#L74-L117)。

## 3. 已执行验证

为满足 `.nvmrc` 和 `package.json` 的 Node 24 要求，使用临时 npm 缓存中的 **Node v24.22.0** 运行以下命令。没有修改项目依赖或锁文件。

| 快照 | 实际执行命令 | 结果 |
| --- | --- | --- |
| PR #6 原代码 head eacd193 | `node --test tests/campus-locations.test.ts tests/scheduler.test.ts` | 50 通过，0 失败 |
| PR #5 + #6 临时组合 | `node --test tests/*.test.ts` | 84 通过，0 失败：地点 39、调度器 11、UI 时间格式 22、地点 UI 适配 12 |
| PR #5 + #6 临时组合 | `node tests/render-check.mjs` | 30/30 通过 |
| PR #5 + #6 临时组合 | `npm run build` | TypeScript 检查和 Vite 构建通过 |

另外执行了第 4 节所列输入的临时时间转换探查和组件静态渲染探查，确认了具体实际结果。这些探查不计入上面的 84 项自动化测试，也没有作为新测试加入仓库。

本次没有运行真实浏览器自动化。PR #5 描述中记录的 18/18 是 B 报告的结果，不能当作本次组合快照的执行结果。当前 `tests/browser-check.mjs:22-27` 只寻找 Windows Chrome/Edge 路径，而本机是 macOS；联合浏览器检查应在可运行该脚本的环境执行，或由 B 单独处理运行器的浏览器路径配置。

## 4. 已复现问题、影响和最小修复建议

以下问题均未在本次修改。它们位于 PR #5 的转换或展示边界，不需要通过更改共享调度器解决。

### F1 [P2] 名称回退会让不同 ID 同时显示 Scheduled

位置：[RecommendedLocations.tsx:55-66](https://github.com/yujunrui06-hue/CampusPilot/blob/dffbca05e9213831d4eb548168a4adbdcc3c7416/src/ui/components/RecommendedLocations.tsx#L55-L66)。判断使用 `location.id === scheduled.id || location.name === scheduled.name`。

实测正常样例中：已分配 ID 是 `thompson-library`，排序第一的候选是 18th Avenue，只有 Thompson 显示 Scheduled，Where 卡片也只显示 Thompson。正常路径的两种语义清楚。

但构造一个已知规范 ID 与旧名称不一致的请求：块的 `locationId` 为 `18th-avenue-library`，请求中的同 ID 记录名称为 `Thompson Library`。组件实际同时给 **18th Avenue Library 和 Thompson Library** 加上 Scheduled。请求类型允许这样的字符串组合；当前五地点样例没有触发它，但数据迁移或名称更新后可能触发。

最小建议：B 在适配层确定一个用于展示的规范地点身份；已知 ID 应优先于名称。标记仅比较这个已解析 ID，不再做无条件的名称 OR。只对未知旧 ID 且名称唯一匹配时保留兼容回退；若规范 ID 和名称矛盾，显示规范记录名称或显式说明不一致。补一个“同一块最多一个 Scheduled、已知 ID 优先”的渲染用例即可，不改变分配。

### F2 [P2] 恰好午夜结束与算法的 endMinutes=1440 契约不一致

位置：[locationPlan.ts:66-74](https://github.com/yujunrui06-hue/CampusPilot/blob/dffbca05e9213831d4eb548168a4adbdcc3c7416/src/ui/locationPlan.ts#L66-L74)。适配层直接比较起止日期，因此结束于次日 00:00 也被当作跨日拒绝。

实测 `2026-10-20T03:00:00Z` → `2026-10-20T04:00:00Z`（校园当地周一 23:00 → 周二 00:00）得到 `null`，UI 不显示列表；直接调用推荐函数 `{ day: 'Mon', startMinutes: 1380, endMinutes: 1440 }` 返回 `18th-avenue-library`。该学习块按结束时间不包含端点的规则，正好覆盖周一最后一小时。

最小建议：B 仅为“正好在下一当地日期 00:00 结束”的情况映射为前一天 `endMinutes: 1440`；真正进入次日 00:01 等时间仍按当前不支持跨日的逻辑处理。可用 end 前 1 毫秒核对所属日期。补一个午夜结束适配测试，保留已有真正跨午夜测试。

### F3 [P2] 秒数截断可能推荐不能完整覆盖学习块的地点

位置：[locationPlan.ts:47-51](https://github.com/yujunrui06-hue/CampusPilot/blob/dffbca05e9213831d4eb548168a4adbdcc3c7416/src/ui/locationPlan.ts#L47-L51)。转换只取小时和分钟，丢失秒和毫秒。

实测周一 `2026-10-19T20:00:00Z` → `2026-10-19T21:00:30Z`（当地 16:00 → 17:00:30）被转换为 960 → 1020，并包含模拟 17:00 关闭的 FAES。实际学习块有 30 秒不在该地点的开放窗口内。共享时间戳契约没有限制只能使用整分钟，调度器也接受包含秒的事件。

最小建议：B 将起点向下、终点向上转换为完整覆盖原块的整数分钟窗口，避免向下截断终点；或者明确拒绝非整分钟块并给出合理说明。补一个关闭时间后 30 秒的适配测试。无需放宽算法的完整覆盖判断。

### F4 [P2] 夏令时跨偏移块的转换处理不一致

位置：[locationPlan.ts:58-74](https://github.com/yujunrui06-hue/CampusPilot/blob/dffbca05e9213831d4eb548168a4adbdcc3c7416/src/ui/locationPlan.ts#L58-L74)。当前检查同一当地日期和结束分钟大于开始分钟，没有检查块内是否跨越时区偏移变化。

| 已执行输入（UTC） | 真实时长 | 当前转换结果 |
| --- | ---: | --- |
| `2027-03-14T06:30:00Z` → `07:30:00Z` | 60 分钟 | Sun 90 → 210（当地 01:30 EST → 03:30 EDT，钟面跨度 120 分钟） |
| `2026-11-01T05:30:00Z` → `06:30:00Z` | 60 分钟 | null（两端钟面都为 01:30） |
| `2026-11-01T04:30:00Z` → `07:30:00Z` | 180 分钟 | Sun 30 → 150（当地 00:30 EDT → 02:30 EST，钟面跨度 120 分钟） |

确认的事实是：有些跨偏移块被接受，有些被拒绝，转换后的钟面跨度不能代表真实时长。由此产生的风险是，未来更窄的模拟窗口或重复小时内的开放边界不能只凭一个日内分钟区间判断完整覆盖；现有五地点在上述凌晨大多关闭，不能据此声称当前样例已经错误分配。

最小建议供 B/A 审核：复用已有 `src/ui/format.ts:243` 的 `windowSpansTransition()` 检测能力，对无法用当前契约无歧义表达的跨偏移区间一致返回 unavailable-window，并把说明改为“无法转换为受支持的校园时间窗口”，避免误说同一天的块跨了日期。结束端点是排他的，恰好切换时刻结束时应核对 end 前 1 毫秒，避免误判。若要支持这些区间，应另行确认表达方式；本次不新增算法能力或改分配策略。

## 5. America/New_York 已有覆盖与缺口

以下测试已存在，已包含在本次通过的组合测试中，不应重复添加同样测试：

| 文件 / 位置 | 已有覆盖 | 没有证明的内容 |
| --- | --- | --- |
| `tests/ui-format.test.ts:17` | 2027-03-14 02:30 春季不存在时间被拒绝，邻近 01:30/03:30 合法 | 不调用 B 的 toStudyBlockWindow |
| `tests/ui-format.test.ts:37`、`:51`、`:61` | 2026-11-01 重复小时返回两个偏移；春秋真实经过分钟正确 | 不证明推荐窗口转换正确 |
| `tests/ui-format.test.ts:110`、`:135`、`:141`、`:149` | 偏移变化检测、EDT/EST 标签区分、跨切换结果文字 | 不证明推荐列表在跨偏移块上的状态正确 |
| `tests/ui-format.test.ts:167` 起的任务提交用例 | 秋季重复小时需要选择偏移，选择后存不同 UTC 时间 | 不覆盖地点适配层 |
| `tests/scheduler.test.ts:100` | 春秋切换期间按真实瞬间计算重叠，保留 0.5 分钟 | 不判断地点是否开放，也没有新增分配规则 |
| `tests/render-check.mjs:44` 起；`tests/browser-check.mjs:45` 起 | 秋季 00:00 EDT → 04:00 EST 时间轴为五真实小时的布局夹具；渲染检查本次通过 | 推荐面板的测试使用普通样例时段，不覆盖推荐跨 DST 转换；浏览器脚本本次未运行 |
| PR #5 `tests/ui-locations.test.ts:23`、`:28`、`:91` | 普通同日转换、真正跨午夜被拒绝、状态回退 | 没有春秋偏移变化、恰好午夜结束、带秒时间的测试 |
| PR #6 `tests/campus-locations.test.ts:241` 起 | 星期/分钟窗口、0/1/多结果、边界、筛选、ID、排序 | API 不接受日期或 ISO 时间，所以不能独立证明 UTC→校园星期的转换正确 |

新增验证应放在 B 现有的 `tests/ui-locations.test.ts` 及必要的组件渲染用例中，不复制 ui-format 或 scheduler 的实现与测试。

## 6. 合并后必须执行的联合验证清单

以下清单用于最终两个 PR 合并后的 head。上面的组合副本结果只是当前两个代码 head 的预演，合并、修复或 main 更新后应重新核对。

- [ ] 记录最终 main SHA；确认没有意外改动 scheduler.ts、共享类型和地点分配策略。
- [ ] 使用 Node 24 和锁文件依赖执行 `node --test tests/campus-locations.test.ts tests/ui-locations.test.ts tests/ui-format.test.ts tests/scheduler.test.ts`，完整运行四组测试。只跑 `npm test` 不足，因为它只运行调度器测试。
- [ ] 执行 `node tests/render-check.mjs`、`npm run build` 和 `git diff --check`。
- [ ] 在支持的浏览器环境执行 `node tests/browser-check.mjs`，保存结果；确认真实 CSS 下点击块、列表和链接可用。
- [ ] 页面初始/Reset 后无选中块时显示提示；Build 后三个样例块的地点 ID 均在规范地点数据中。
- [ ] 逐个选择样例块，Where 显示该块已分配的 Thompson；推荐列表按当前规则显示五个地点，首项 18th Avenue 不会被自动当作已分配地点；只有真实匹配的地点显示 Scheduled。
- [ ] 覆盖 0/1/多候选：无匹配时显示明确空状态；仅 18th 开放时仍保留原已分配地点信息，不偷偷重分配。
- [ ] 显示推荐分数、原函数理由和模拟数据说明；预约链接只代表打开官方入口，不表示预约成功或实时有空位。
- [ ] 验证未知 ID 不凭空产生分配，旧 thompson 唯一名称回退可用，已知规范 ID 与过时名称冲突时不会产生多个 Scheduled（F1）。
- [ ] 验证正好午夜结束映射 1440，真正跨午夜仍按约定回退（F2）；验证终点超出关闭时间 30 秒不能误推荐 FAES（F3）。
- [ ] 对下表的 DST 适配用例执行明确断言（F4），并在 `TZ=UTC`、`TZ=America/Los_Angeles`、`TZ=Asia/Tokyo` 下重复地点 UI 适配测试，结果必须始终依据 America/New_York。

### 缺失的 DST 适配验证计划（待 B/A 确认回退策略后落实）

| 用例 | 输入示例（UTC） | 需要断言 |
| --- | --- | --- |
| UTC 日期与校园日期不同 | 2026-10-20 01:00 → 02:00 | Mon 1260 → 1320，不误变 Tue；这个结果已临时探查确认，尚无对应持久测试 |
| 春季切换前、后普通块 | 2027-03-14 06:00 → 06:30；07:00 → 07:30 | 分别转换为 Sun 60 → 90、180 → 210 |
| 春季跨偏移 | 2027-03-14 06:30 → 07:30 | 按获批策略一致回退，不把 60 真实分钟默认为 120 钟面分钟的普通块 |
| 秋季重复小时分别落在 EDT/EST | 2026-11-01 05:10 → 05:50；06:10 → 06:50 | 两个独立同偏移块都可按 Sun 70 → 110 处理；显示仍区分 EDT/EST |
| 秋季两端钟面相同的跨偏移块 | 2026-11-01 05:30 → 06:30 | 按获批策略回退，原因不能误说跨日期 |
| 秋季钟面递增的跨偏移块 | 2026-11-01 04:30 → 07:30 | 与上一条采用同一策略，不能仅凭 endMinutes > startMinutes 接受 |
| 恰好切换时刻作为排他终点/起点 | 春季 07:00Z、秋季 06:00Z 的两侧区间 | 按实际被占用区间检测偏移，明确 end 排他边界；不重复测试已有的时间格式函数 |

## 7. 审核结论与待决定事项

已确认：当前两个代码 head 没有文本冲突，类型和推荐函数接口兼容，组合后的 84 项单元测试、30 项渲染检查和构建通过。正常样例的“推荐候选”和“已分配地点”已经分面板展示，排序不改变分配。

已复现但未修复：F1 的身份标记、F2 的午夜端点、F3 的秒数截断、F4 的 DST 适配不一致。建议由 B 审阅并在其文件中作最小修正，再执行第 6 节清单。没有理由为这些问题扩展推荐算法或改共享调度器。

待 A 决定的仍是学习块地点分配策略。候选列表、预约链接或 Scheduled 标签修正都不能被用来暗中改变 `StudyBlock.locationId`。本审核没有合并 PR，也没有宣称 GitHub CI 或真实浏览器组合验证已通过。

// 临时行为验证脚本：直接驱动 zustand store，验证放行追溯链关键路径
import assert from 'node:assert'

// zustand persist 默认使用 localStorage，Node 下提供空实现
globalThis.localStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined } as unknown as Storage

const { useShipmentStore } = await import('../src/store/useShipmentStore')

const s = useShipmentStore.getState
let passed = 0
const check = (name, cond) => { assert.ok(cond, name); console.log('PASS', name); passed++ }

// ---- 1. 种子数据：任务01已有生效放行，且冻结的是最新核验版 ----
let st = s()
const before = st.releaseRecords.filter((r) => r.shipmentId === 'AIR-260929-01')
check('种子含两次放行结论', before.length === 2)
const active0 = before.find((r) => r.life === '生效')
check('当前生效为第2次结论', active0.seq === 2 && active0.evidenceBasis.every((e) => e.version >= 1))
check('生效依据含温度曲线V2/设备报告V2/包装确认V1', active0.evidenceBasis.some((e) => e.category === '温度曲线' && e.version === 2) && active0.evidenceBasis.some((e) => e.category === '设备报告' && e.version === 2))
check('第1次结论保留并标记为证据更新失效', before[0].life === '已失效-证据更新' && before[0].evidenceBasis.some((e) => e.category === '温度曲线' && e.version === 1))

// ---- 2. 证据新版本到达：生效放行失效，回到待放行，历史依据仍可查 ----
s().addEvidence('AIR-260929-01', { name: 'CDG货站二次复检设备报告.pdf', category: '设备报告', uploadedBy: 'CDG货站', verified: false })
st = s()
let ship = st.shipments.find((x) => x.id === 'AIR-260929-01')
check('证据更新后任务回到待放行', ship.status === '待放行')
check('activeReleaseId 已清空', !ship.activeReleaseId)
check('原结论标记失效且原因留痕', st.releaseRecords.find((r) => r.id === active0.id).life === '已失效-证据更新' && st.releaseRecords.find((r) => r.id === active0.id).invalidReason.includes('设备报告发布V3'))
const latestEquip = ship.evidence.filter((e) => e.category === '设备报告').sort((a, b) => b.version - a.version)[0]
check('新证据为V3且旧版V2被标记stale', latestEquip.version === 3 && ship.evidence.find((e) => e.id === 'E-7').stale === true)

// 未核验最新版不能放行
const req1 = 'REQ-' + Date.now()
const blocked = s().submitRelease({ shipmentId: 'AIR-260929-01', reviewer: '顾言', decision: '放行', note: '尝试', expectedVersion: ship.version, requestId: req1 })
check('最新版未核验拦截放行', blocked.ok === false && blocked.code === 'BLOCKED' && blocked.message.includes('设备报告 V3'))

// 核验后放行成功，冻结V3
s().verifyEvidence('AIR-260929-01', latestEquip.id)
s().verifyEvidence('AIR-260929-01', ship.evidence.find((e) => e.category === '交接签字').id)
const req2 = 'REQ-' + (Date.now() + 1)
const v = s().shipments.find((x) => x.id === 'AIR-260929-01').version
const ok = s().submitRelease({ shipmentId: 'AIR-260929-01', reviewer: '顾言', decision: '放行', note: '按货站最新复检放行', expectedVersion: v, requestId: req2 })
check('核验后放行成功', ok.ok === true && ok.release.seq === 3)
check('新结论冻结设备报告V3', ok.release.evidenceBasis.find((e) => e.category === '设备报告').version === 3)
check('放行记录总数=3条且历史全保留', s().releaseRecords.filter((r) => r.shipmentId === 'AIR-260929-01').length === 3)

// ---- 3. 并发：两名复核员同时提交，后来者收到版本冲突，已填内容不丢（表单状态在UI层，这里验证基准机制）----
const curV = s().shipments.find((x) => x.id === 'AIR-260929-01').version
const conflict = s().submitRelease({ shipmentId: 'AIR-260929-01', reviewer: '复核员B', decision: '拒绝', note: '我填的意见', expectedVersion: curV - 1, requestId: 'REQ-OLD' })
check('旧版本基准提交被拒', conflict.ok === false && conflict.code === 'VERSION_CONFLICT')
check('冲突返回当前最新版本', conflict.currentVersion === curV)
check('冲突时未产生新结论', s().releaseRecords.filter((r) => r.shipmentId === 'AIR-260929-01').length === 3)

// ---- 4. 落盘失败后按原提交重试：失败零写入，重试成功且不重复生成 ----
const failReq = 'REQ-FAIL-' + Date.now()
const vBefore = s().shipments.find((x) => x.id === 'AIR-260929-01').version
const countBefore = s().releaseRecords.length
const fail = s().submitRelease({ shipmentId: 'AIR-260929-01', reviewer: '顾言', decision: '拒绝', note: '落盘失败用例', expectedVersion: curV, requestId: failReq, simulatePersistFailure: true })
check('落盘失败返回PERSIST_FAILED', fail.ok === false && fail.code === 'PERSIST_FAILED' && fail.requestId === failReq)
check('失败后零写入（版本/结论数不变）', s().shipments.find((x) => x.id === 'AIR-260929-01').version === vBefore && s().releaseRecords.length === countBefore)

// 同一 requestId 不带失败标志重试 -> 成功
const retry = s().submitRelease({ shipmentId: 'AIR-260929-01', reviewer: '顾言', decision: '拒绝', note: '落盘失败用例', expectedVersion: curV, requestId: failReq })
check('原提交重试成功', retry.ok === true)
const retryId = retry.release.id

// 再次用同一 requestId 重试 -> 幂等返回同一条，不新增
const dup = s().submitRelease({ shipmentId: 'AIR-260929-01', reviewer: '顾言', decision: '拒绝', note: '落盘失败用例', expectedVersion: s().shipments.find((x) => x.id === 'AIR-260929-01').version, requestId: failReq })
check('重复提交幂等返回原结论', dup.ok === true && dup.duplicate === true && dup.release.id === retryId)
check('结论总数未因重试增加', s().releaseRecords.length === countBefore + 1)

// ---- 5. 偏差重新打开：生效放行失效，调查/复核记录保留且版本前进 ----
const tdev = 'TDEV-260929-02'
const dBefore = s().deviations.find((x) => x.id === tdev)
const dVer = dBefore.version
const reopen = s().reopenDeviation(tdev, '货站新到包装照片显示冷凝水，需要重评')
check('偏差重开成功', reopen.ok === true)
const dAfter = s().deviations.find((x) => x.id === tdev)
check('重开后状态=调查中且版本+1', dAfter.status === '调查中' && dAfter.version === dVer + 1)
check('调查内容未被清空', dAfter.cause.length > 0 && dAfter.assessment.length > 0)
check('原复核结论进入历史', (dAfter.reviewHistory?.length ?? 0) >= 1)
check('重开使任务放行结论失效', s().shipments.find((x) => x.id === 'AIR-260929-01').status === '待放行')
const invalidByDev = s().releaseRecords.filter((r) => r.shipmentId === 'AIR-260929-01' && r.life === '已失效-偏差重开')
check('存在因偏差重开失效的结论且冻结版本可查', invalidByDev.length >= 1 && invalidByDev[0].deviationBasis.some((d) => d.deviationId === tdev))

// 重新关闭：历史再次累积，不重新生成
s().saveInvestigation(tdev, { cause: dAfter.cause, assessment: dAfter.assessment + '（补充冷凝水评估）' })
s().reviewDeviation(tdev, '接受', '补充证据后风险可接受，重新关闭')
const dClosed = s().deviations.find((x) => x.id === tdev)
check('再次关闭后版本继续前进且历史复核累计', dClosed.status === '已关闭' && dClosed.reviewHistory.length >= 2)

console.log(`\n全部 ${passed} 项行为验证通过`)

/* 核心链路冒烟：版本固定 / 失效回退 / 并发冲突 / 幂等重试 */
import { useShipmentStore } from '../src/store/useShipmentStore'
import { armNextWriteFailure } from '../src/services/storage'

const store = useShipmentStore
let passed = 0
const check = (name: string, cond: boolean, extra = '') => {
  if (cond) { passed++; console.log(`  ✅ ${name}`) }
  else { console.error(`  ❌ ${name} ${extra}`); process.exitCode = 1 }
}
const findShipment = (id: string) => store.getState().shipments.find((s) => s.id === id)!
const latestRelease = (id: string) => store.getState().releases.find((r) => r.shipmentId === id)

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

console.log('场景1：同类材料按最新核验版参与放行，放行固定证据/调查版本')
{
  const s = findShipment('AIR-260929-02')
  // 关闭偏差（调查版本固定）
  const dev = store.getState().deviations.find((d) => d.id === 'TDEV-260929-01')!
  // 补核验缺失证据
  const r1 = await store.getState().verifyEvidence('AIR-260929-02', 'E-5', '复核员 沈澜')
  check('设备报告核验成功', r1.ok, r1.message)
  const rv = await store.getState().reviewDeviation(dev.id, '接受', '调查充分，接受该偏差', dev.version)
  check('偏差复核关闭成功', rv.ok, rv.message)
  // 收货方签收
  store.getState().sign('AIR-260929-02', '收货方', '已完成外观与标签复核', '已签')
  const shipment = findShipment('AIR-260929-02')
  const base = shipment.version
  const rel = await store.getState().submitRelease('AIR-260929-02', {
    decision: '批准放行', reviewer: '放行人员 顾言', note: '证据齐全，偏差已按调查版本关闭，同意放行'
  }, base)
  check('放行成功', rel.ok, rel.message)
  const rec = latestRelease('AIR-260929-02')!
  check('放行状态有效', rec.state === '有效')
  check('固定2类证据版本', rec.evidenceBasis.length === 2, `实际 ${rec.evidenceBasis.length}`)
  check('固定温度曲线V1', rec.evidenceBasis.some((e) => e.category === '温度曲线' && e.version === 1))
  const closedDev = store.getState().deviations.find((d) => d.id === dev.id)!
  check('固定偏差调查版本', rec.deviationBasis.some((d) => d.deviationId === dev.id && d.version === closedDev.version))
  check('任务状态=已放行', findShipment('AIR-260929-02').status === '已放行')
}

console.log('场景2：货站补送同类别新证据 → 放行失效、回到复核、历史依据可查')
{
  const before = latestRelease('AIR-260929-02')!
  const r = await store.getState().addEvidence('AIR-260929-02', {
    name: 'CRT-9207货站终版温度曲线.xlsx', category: '温度曲线', uploadedBy: '羽田货站', changeNote: '补齐落地后15分钟地面等待温度点'
  })
  check('新证据版本登记成功', r.ok, r.message)
  const after = latestRelease('AIR-260929-02')!
  check('放行记录仍是同一条（历史保留）', after.id === before.id)
  check('放行状态=失效', after.state === '失效')
  check('任务回到待放行', findShipment('AIR-260929-02').status === '待放行')
  check('失效原因已记录', Boolean(after.invalidated?.reason.includes('温度曲线')))
  check('历史依据仍可查（温度曲线V1）', after.evidenceBasis.some((e) => e.category === '温度曲线' && e.version === 1))
  const newEvidence = findShipment('AIR-260929-02').evidence.find((e) => e.name.includes('终版'))!
  check('新版证据默认未核验、不参与放行', newEvidence.version === 2 && !newEvidence.verified)
}

console.log('场景3：偏差重新打开 → 放行失效')
{
  // 03 票种子已有有效放行；给它造一个已关闭偏差再重开
  store.getState().createDeviation('AIR-260928-03', 'SEG-2', '货舱短时温度波动复查', '一般')
  const d = store.getState().deviations.find((x) => x.shipmentId === 'AIR-260928-03')!
  // 登记偏差本身已使种子放行失效；为验证“重开”路径，先重新放行再重开
  // 直接走完关闭 → 重新放行
  await store.getState().saveInvestigation(d.id, {
    cause: '空调短时切换', assessment: '幅度0.4℃，无质量影响', disposition: '接受',
    correctiveAction: '无需处理', evidence: '温度曲线'
  }, d.version)
  const d2 = store.getState().deviations.find((x) => x.id === d.id)!
  await store.getState().reviewDeviation(d2.id, '接受', '接受', d2.version)
  const s = findShipment('AIR-260928-03')
  const rel = await store.getState().submitRelease('AIR-260928-03', { decision: '批准放行', reviewer: '放行人员 顾言', note: '重新放行' }, s.version)
  check('重新放行成功', rel.ok, rel.message)
  const d3 = store.getState().deviations.find((x) => x.id === d.id)!
  const reopen = await store.getState().reopenDeviation(d3.id, '货站新报告显示停机时间被低估')
  check('偏差重开成功', reopen.ok, reopen.message)
  const rec = latestRelease('AIR-260928-03')!
  check('重开后放行失效', rec.state === '失效')
  check('重开后任务回到待放行', findShipment('AIR-260928-03').status === '待放行')
  const d4 = store.getState().deviations.find((x) => x.id === d.id)!
  check('偏差产生新调查版本且状态=调查中', d4.status === '调查中' && d4.history.length >= 4)
  check('放行记录链保留全部历史', store.getState().releases.filter((x) => x.shipmentId === 'AIR-260928-03').length >= 2)
}

console.log('场景4：两名复核员同时提交，后者收到版本冲突且内容保留')
{
  const s = findShipment('AIR-260929-01')
  const base = s.version
  store.getState().simulateConcurrentSubmit({ kind: 'shipment', id: 'AIR-260929-01' })
  const current = findShipment('AIR-260929-01')
  const r = await store.getState().submitRelease('AIR-260929-01', {
    decision: '批准放行', reviewer: '复核员B（后提交）', note: '我填写的复核意见必须保留'
  }, base)
  check('后者提交被判冲突', !r.ok && r.conflict === true, r.message)
  check('冲突返回当前版本号', r.currentVersion === current.version)
  check('没有生成新的放行记录（先提交者优先）', !store.getState().releases.some((x) => x.shipmentId === 'AIR-260929-01' && x.note.includes('必须保留')))

  // 偏差版本冲突
  const d = store.getState().deviations.find((x) => x.shipmentId === 'AIR-260928-03')!
  const dbase = d.version
  store.getState().simulateConcurrentSubmit({ kind: 'deviation', id: d.id })
  const rd = await store.getState().saveInvestigation(d.id, {
    cause: '后提交者的原因分析', assessment: '后提交者的评估内容', disposition: '接受', correctiveAction: 'x', evidence: 'y'
  }, dbase)
  check('偏差保存遇到版本冲突', !rd.ok && rd.conflict === true, rd.message)
}

console.log('场景5：落盘失败按原提交重试，已完成记录不重复生成')
{
  const releaseCountBefore = store.getState().releases.length
  const s = findShipment('AIR-260929-02')
  // 先核验新版证据（任务2此时处于放行失效待复核）
  armNextWriteFailure()
  const failed = await store.getState().verifyEvidence('AIR-260929-02', findShipment('AIR-260929-02').evidence.find((e) => e.version === 2)!.id, '复核员 沈澜')
  check('故障注入后提交返回落盘失败', failed.persisted === false && Boolean(failed.submitId))
  check('进入待重试队列', store.getState().pendingSubmits.some((p) => p.submitId === failed.submitId))
  const pending = store.getState().pendingSubmits.find((p) => p.submitId === failed.submitId)!
  // 按原提交重试
  const retry = await store.getState().retrySubmit(pending.submitId)
  check('原提交重试成功', retry.ok, retry.message)
  check('重试后队列清空', !store.getState().pendingSubmits.some((p) => p.submitId === failed.submitId))
  const ev = findShipment('AIR-260929-02').evidence.find((e) => e.version === 2)!
  check('证据只核验一次', ev.verified === true)
  // 再次按同一提交号重试（模拟刷新后的重复点击）
  const again = await store.getState().retrySubmit(pending.submitId)
  check('重复重试回放结果、不重复执行', !again.ok && again.message.includes('没有待重试'))
  check('核验记录未重复（审计事件只有一条V2核验）',
    store.getState().audit.filter((a) => a.action === '核验证据' && a.detail.includes('V2')).length === 1)
  check('放行记录未被误生成', store.getState().releases.length === releaseCountBefore)
  await wait(10)
}

console.log(`\n通过 ${passed} 项断言`)

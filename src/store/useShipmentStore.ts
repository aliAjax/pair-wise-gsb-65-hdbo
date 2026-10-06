import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedDeviations, seedReleaseRecords, seedShipments } from '../data/seed'
import type {
  AuditEntry, Deviation, EvidenceCategory, EvidenceFile, ReleaseRecord, ReleaseRequestLedger,
  ReleaseSubmitInput, ReleaseSubmitResult, Shipment, ShipmentStatus
} from '../types'

const EVIDENCE_CATEGORIES: EvidenceCategory[] = ['温度曲线', '设备报告', '包装确认', '交接签字']

interface ShipmentState {
  shipments: Shipment[]
  deviations: Deviation[]
  /** 历次放行结论（生效/失效全部保留，只追加） */
  releaseRecords: ReleaseRecord[]
  /** 放行提交幂等台账：requestId -> 已落盘结论 */
  releaseRequests: ReleaseRequestLedger[]
  audit: AuditEntry[]
  keyword: string
  status: ShipmentStatus | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: ShipmentStatus | '全部') => void
  addEvidence: (shipmentId: string, evidence: Omit<EvidenceFile, 'id' | 'version' | 'uploadedAt' | 'supersedes'>) => void
  verifyEvidence: (shipmentId: string, evidenceId: string) => void
  sign: (shipmentId: string, role: string, comment: string, status: '已签' | '已退回') => { ok: boolean; message: string }
  createDeviation: (shipmentId: string, segmentId: string, title: string, severity: '一般' | '重大') => void
  saveInvestigation: (id: string, patch: Partial<Deviation>) => { ok: boolean; message: string }
  reviewDeviation: (id: string, disposition: Deviation['disposition'], note: string) => { ok: boolean; message: string }
  reopenDeviation: (id: string, reason: string) => { ok: boolean; message: string }
  submitRelease: (input: ReleaseSubmitInput) => ReleaseSubmitResult
  reset: () => void
}

let idSeed = 10
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`
const nowIso = () => new Date().toISOString()
const cloneSeeds = () => ({
  shipments: structuredClone(seedShipments),
  deviations: structuredClone(seedDeviations),
  releaseRecords: structuredClone(seedReleaseRecords),
  releaseRequests: [] as ReleaseRequestLedger[],
  audit: structuredClone(seedAudit)
})

function makeAudit(shipmentId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), shipmentId, action, operator, detail, createdAt: nowIso() }
}

/** 同一分类下版本号最大的材料，即“最新版”；不区分核验状态 */
export function latestEvidence(shipment: Shipment, category: EvidenceCategory): EvidenceFile | undefined {
  return shipment.evidence
    .filter((item) => item.category === category)
    .sort((a, b) => b.version - a.version)[0]
}

function activeReleaseOf(records: ReleaseRecord[], shipmentId: string) {
  return records.find((item) => item.shipmentId === shipmentId && item.life === '生效')
}

/**
 * 证据或偏差发生变化后，使任务当前生效的放行结论失效：
 * 结论本身保留可查，任务回到“待放行”重新复核。
 */
function invalidateActiveRelease(
  records: ReleaseRecord[],
  shipmentId: string,
  life: Extract<ReleaseRecord['life'], '已失效-证据更新' | '已失效-偏差重开'>,
  reason: string
): { records: ReleaseRecord[]; releaseId?: string; at: string } {
  const current = activeReleaseOf(records, shipmentId)
  if (!current) return { records, at: nowIso() }
  const at = nowIso()
  return {
    records: records.map((item) => item.id === current.id ? { ...item, life, invalidatedAt: at, invalidReason: reason } : item),
    releaseId: current.id,
    at
  }
}

export const useShipmentStore = create<ShipmentState>()(persist((set, get) => ({
  ...cloneSeeds(),
  keyword: '',
  status: '全部',
  setKeyword: (keyword) => set({ keyword }),
  setStatus: (status) => set({ status }),

  addEvidence: (shipmentId, evidence) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const previous = latestEvidence(shipment, evidence.category)
    const version = (previous?.version ?? 0) + 1
    const file: EvidenceFile = {
      ...evidence,
      id: nextId('E'),
      version,
      supersedes: previous?.id,
      uploadedAt: nowIso()
    }
    // 旧版本保留可查，但标记 stale：放行只认真正的最新版，旧核验不再算数
    const evidencePatch = new Map<string, EvidenceFile>()
    if (previous) shipment.evidence.forEach((item) => { if (item.category === evidence.category) evidencePatch.set(item.id, { ...item, stale: true }) })
    shipment.evidence = [file, ...shipment.evidence.map((item) => evidencePatch.get(item.id) ?? item)]
    shipment.version += 1
    shipment.updatedAt = file.uploadedAt

    const invalidation = invalidateActiveRelease(
      state.releaseRecords, shipmentId, '已失效-证据更新',
      `${evidence.category}发布V${version}（${evidence.name}），原放行依据的V${previous?.version ?? 0}不再是最新核验版`
    )
    const audit = [
      makeAudit(shipmentId, '上传证据版本', evidence.uploadedBy, `${evidence.name} 版本${version}${previous ? `，替代V${previous.version}` : ''}`),
      ...state.audit
    ]
    if (invalidation.releaseId) {
      shipment.status = '待放行'
      shipment.activeReleaseId = undefined
      audit.unshift(makeAudit(shipmentId, '放行结论失效', '系统', `${invalidation.releaseId} 因证据新版本失效，任务回到待放行复核（历史依据保留可查）`))
    }
    return { shipments: [...state.shipments], releaseRecords: invalidation.records, audit }
  }),

  verifyEvidence: (shipmentId, evidenceId) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    const evidence = shipment?.evidence.find((item) => item.id === evidenceId)
    if (!shipment || !evidence) return state
    evidence.verified = true
    evidence.stale = false
    evidence.verifiedBy = '当前复核员'
    evidence.verifiedAt = nowIso()
    shipment.version += 1
    return { shipments: [...state.shipments], audit: [makeAudit(shipmentId, '核验证据', '当前复核员', `${evidence.name} V${evidence.version} 核验通过`), ...state.audit] }
  }),

  sign: (shipmentId, role, comment, status) => {
    const shipment = get().shipments.find((item) => item.id === shipmentId)
    const signature = shipment?.signatures.find((item) => item.role === role)
    if (!shipment || !signature) return { ok: false, message: '签收角色不存在' }
    if (status === '已退回' && !comment.trim()) return { ok: false, message: '退回必须填写原因' }
    signature.status = status
    signature.comment = comment
    signature.signedAt = nowIso()
    shipment.version += 1
    shipment.updatedAt = signature.signedAt
    set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `${role}${status}`, signature.name, comment || '签署确认'), ...state.audit] }))
    return { ok: true, message: status === '已签' ? '签收成功' : '已退回并要求补充材料' }
  },

  createDeviation: (shipmentId, segmentId, title, severity) => set((state) => {
    const shipment = state.shipments.find((item) => item.id === shipmentId)
    if (!shipment) return state
    const now = nowIso()
    const deviation: Deviation = {
      id: nextId('TDEV'), shipmentId, segmentId, title, source: '人工报告', severity, status: '待调查', owner: '温控质量组', openedAt: now,
      dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '', version: 1
    }
    shipment.status = '待放行'
    shipment.version += 1
    return { deviations: [deviation, ...state.deviations], shipments: [...state.shipments], audit: [makeAudit(shipmentId, '登记温度偏差', '当前用户', title), ...state.audit] }
  }),

  saveInvestigation: (id, patch) => {
    const deviation = get().deviations.find((item) => item.id === id)
    if (!deviation) return { ok: false, message: '偏差不存在' }
    if (deviation.status === '已关闭') return { ok: false, message: '偏差已关闭，修改调查请先重新打开' }
    const merged = { ...deviation, ...patch }
    if (!merged.cause?.trim() || !merged.assessment?.trim()) return { ok: false, message: '原因调查和影响评估必须填写' }
    set((state) => ({
      deviations: state.deviations.map((item) => item.id === id
        ? { ...item, ...patch, status: '待放行复核', version: item.version + 1 }
        : item),
      audit: [makeAudit(deviation.shipmentId, '提交偏差调查', deviation.owner, `调查版本升至V${deviation.version + 1}，进入放行复核`), ...state.audit]
    }))
    return { ok: true, message: '调查已提交放行复核' }
  },

  reviewDeviation: (id, disposition, note) => {
    const state = get()
    const deviation = state.deviations.find((item) => item.id === id)
    if (!deviation) return { ok: false, message: '偏差不存在' }
    if (deviation.status === '已关闭') return { ok: false, message: '该调查版本已关闭' }
    if (!note.trim()) return { ok: false, message: '复核必须填写意见' }
    if (disposition === '拒绝' && !note.trim()) return { ok: false, message: '拒绝放行必须填写理由' }
    const closedAt = nowIso()
    // 把被取代的复核结论归档进历史，调查版本号前进但历史记录不重新生成
    const history = [...(deviation.reviewHistory ?? [])]
    if (deviation.reviewer && deviation.closedAt) {
      history.push({ version: deviation.version, disposition: deviation.disposition, reviewer: deviation.reviewer, reviewNote: deviation.reviewNote, closedAt: deviation.closedAt })
    }
    set((current) => ({
      deviations: current.deviations.map((item) => item.id === id ? {
        ...item, disposition, reviewer: '放行人员 顾言', reviewNote: note, status: '已关闭', closedAt,
        reviewHistory: history, version: item.version + 1
      } : item),
      audit: [makeAudit(deviation.shipmentId, '偏差复核关闭', '放行人员 顾言', `${deviation.id} 调查V${deviation.version + 1} 复核结论：${disposition}。${note}`), ...current.audit]
    }))
    return { ok: true, message: `已执行${disposition}` }
  },

  reopenDeviation: (id, reason) => {
    const state = get()
    const deviation = state.deviations.find((item) => item.id === id)
    if (!deviation) return { ok: false, message: '偏差不存在' }
    if (deviation.status !== '已关闭') return { ok: false, message: '偏差未关闭，无需重新打开' }
    if (!reason.trim()) return { ok: false, message: '重新打开必须填写原因' }
    const reopenedAt = nowIso()
    // 已完成的调查内容与历次复核结论原样保留，只把版本向前推进
    const history = [...(deviation.reviewHistory ?? [])]
    if (deviation.reviewer && deviation.closedAt) {
      history.push({ version: deviation.version, disposition: deviation.disposition, reviewer: deviation.reviewer, reviewNote: deviation.reviewNote, closedAt: deviation.closedAt })
    }
    const invalidation = invalidateActiveRelease(
      state.releaseRecords, deviation.shipmentId, '已失效-偏差重开',
      `偏差${deviation.id} 被重新打开：${reason}（放行依据调查版本V${deviation.version}）`
    )
    set((current) => {
      const shipment = current.shipments.find((item) => item.id === deviation.shipmentId)
      const audit = [
        makeAudit(deviation.shipmentId, '重新打开偏差', '当前用户', `${deviation.id}：${reason}。调查内容与历史复核保留，版本前进至V${deviation.version + 1}`),
        ...current.audit
      ]
      if (shipment) {
        shipment.status = '待放行'
        shipment.activeReleaseId = undefined
        shipment.version += 1
      }
      if (invalidation.releaseId) audit.unshift(makeAudit(deviation.shipmentId, '放行结论失效', '系统', `${invalidation.releaseId} 因偏差重新打开失效，任务回到待放行复核（历史依据保留可查）`))
      return {
        deviations: current.deviations.map((item) => item.id === id ? {
          ...item, status: '调查中', reopenReason: reason, reopenedAt, closedAt: undefined,
          reviewHistory: history, version: item.version + 1
        } : item),
        shipments: [...current.shipments],
        releaseRecords: invalidation.records,
        audit
      }
    })
    return { ok: true, message: '偏差已重新打开，原放行结论失效并回到复核' }
  },

  submitRelease: (input) => {
    const state = get()
    const shipment = state.shipments.find((item) => item.id === input.shipmentId)
    if (!shipment) return { ok: false, code: 'NOT_FOUND', message: '运输任务不存在' }

    // 幂等：同一 requestId 的重试直接返回已落盘结论，不重复生成核验/调查记录
    const ledgerHit = state.releaseRequests.find((item) => item.requestId === input.requestId)
    if (ledgerHit) {
      const existing = state.releaseRecords.find((item) => item.id === ledgerHit.releaseId)
      if (existing) return { ok: true, release: existing, duplicate: true }
    }

    // 模拟落盘失败：任何写入发生之前返回，前端可凭原 requestId 原样重试
    if (input.simulatePersistFailure) {
      return { ok: false, code: 'PERSIST_FAILED', requestId: input.requestId, message: '放行结论落盘失败，数据未变更，可按原提交重试' }
    }

    // 乐观锁：两名复核员并发提交，后到者必须看到任务版本已经前进
    if (shipment.version !== input.expectedVersion) {
      const active = activeReleaseOf(state.releaseRecords, shipment.id)
      return {
        ok: false, code: 'VERSION_CONFLICT', currentVersion: shipment.version, activeRelease: active,
        message: active
          ? `任务版本已前进至V${shipment.version}，另一位复核员已提交结论（${active.id}）。您填写的内容已保留，请基于最新版本重新确认`
          : `任务版本已前进至V${shipment.version}，放行依据发生变化。您填写的内容已保留，请刷新依据后重新确认`
      }
    }

    if (!input.reviewer.trim()) return { ok: false, code: 'BLOCKED', message: '请填写放行复核员' }
    if (input.decision === '拒绝' && !input.note.trim()) return { ok: false, code: 'BLOCKED', message: '拒绝放行必须填写理由' }

    const open = state.deviations.filter((item) => item.shipmentId === shipment.id && item.status !== '已关闭')
    if (input.decision === '放行') {
      if (open.length > 0) return { ok: false, code: 'BLOCKED', message: `存在${open.length}项未关闭温度偏差，不能放行` }
      const missing: string[] = []
      for (const category of EVIDENCE_CATEGORIES) {
        const latest = latestEvidence(shipment, category)
        if (!latest) missing.push(`${category}（缺材料）`)
        else if (!latest.verified || latest.stale) missing.push(`${category} V${latest.version}（最新版未核验）`)
      }
      if (missing.length) return { ok: false, code: 'BLOCKED', message: `最新版证据未全部核验：${missing.join('、')}` }
      const unsigned = shipment.signatures.filter((item) => item.role !== '放行人员' && item.status !== '已签')
      if (unsigned.length) return { ok: false, code: 'BLOCKED', message: `多角色签收未完成：${unsigned.map((item) => item.role).join('、')}` }
    }

    // 冻结放行依据：同类材料只取最新核验版；偏差只取已关闭调查版本
    const evidenceBasis = EVIDENCE_CATEGORIES.map((category) => latestEvidence(shipment, category)).filter((item): item is EvidenceFile => Boolean(item))
      .map((item) => ({ evidenceId: item.id, category: item.category, version: item.version, name: item.name, verified: item.verified }))
    const deviationBasis = state.deviations
      .filter((item) => item.shipmentId === shipment.id && item.status === '已关闭')
      .map((item) => ({
        deviationId: item.id, title: item.title, version: item.version, disposition: item.disposition,
        reviewer: item.reviewer, closedAt: item.closedAt ?? ''
      }))

    const seq = state.releaseRecords.filter((item) => item.shipmentId === shipment.id).reduce((max, item) => Math.max(max, item.seq), 0) + 1
    const decidedAt = nowIso()
    const id = `${shipment.id.replace('AIR-', 'REL-')}-${String(seq).padStart(4, '0')}`
    const record: ReleaseRecord = {
      id, shipmentId: shipment.id, seq, decision: input.decision, reviewer: input.reviewer, note: input.note,
      basedOnShipmentVersion: input.expectedVersion, decidedAt,
      evidenceBasis, deviationBasis, life: '生效', requestId: input.requestId
    }

    // 同一任务上一条生效结论被新结论取代：保留历史，仅改变生命周期
    const superseded = activeReleaseOf(state.releaseRecords, shipment.id)
    const releaseRecords = [
      record,
      ...state.releaseRecords.map((item) => item.id === superseded?.id
        ? { ...item, life: '已失效-被新结论取代' as const, invalidatedAt: decidedAt, invalidReason: `被新结论${id}取代` }
        : item)
    ]
    shipment.status = input.decision === '放行' ? '已放行' : '已拒绝'
    shipment.version += 1
    shipment.updatedAt = decidedAt
    shipment.activeReleaseId = input.decision === '放行' ? id : undefined

    const ledger: ReleaseRequestLedger = { requestId: input.requestId, releaseId: id, shipmentId: shipment.id, committedAt: decidedAt }
    const audit = [
      makeAudit(shipment.id, input.decision === '放行' ? '放行结论生效' : '放行拒绝', input.reviewer,
        `${id} 基于任务V${input.expectedVersion}提交，冻结证据${evidenceBasis.length}份（按最新核验版）、偏差调查${deviationBasis.length}份。${input.note}`),
      ...state.audit
    ]
    if (superseded) audit.unshift(makeAudit(shipment.id, '放行结论失效', '系统', `${superseded.id} 被新结论${id}取代，历史依据保留可查`))

    set({ shipments: [...state.shipments], releaseRecords, releaseRequests: [ledger, ...state.releaseRequests], audit })
    return { ok: true, release: record }
  },

  reset: () => set({ ...cloneSeeds(), keyword: '', status: '全部' })
}), {
  name: 'gsb65:temperature-chain',
  version: 2,
  // 数据模型升级：旧快照缺少放行记录链，直接以可追溯演示数据重建
  migrate: () => ({ ...cloneSeeds(), keyword: '', status: '全部' as const })
}))

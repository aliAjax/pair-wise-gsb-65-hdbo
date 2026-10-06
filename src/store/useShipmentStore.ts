import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { seedAudit, seedDeviations, seedReleases, seedShipments } from '../data/seed'
import { persist as persistWrite, resetProcessedSubmits } from '../services/storage'
import type {
  AuditEntry, Deviation, EvidenceCategory, EvidenceFile, PendingSubmit, ReleaseDecisionKind,
  ReleaseDeviationRef, ReleaseEvidenceRef, ReleaseRecord, Shipment, ShipmentStatus, SubmitResult
} from '../types'

interface NewEvidenceInput {
  name: string
  category: EvidenceCategory
  uploadedBy: string
  changeNote: string
}

interface ReleaseInput {
  decision: ReleaseDecisionKind
  reviewer: string
  note: string
}

/** 待重试提交的载荷，按类型区分 */
type SubmitPayload =
  | { kind: 'addEvidence'; shipmentId: string; input: NewEvidenceInput }
  | { kind: 'verifyEvidence'; shipmentId: string; evidenceId: string; reviewer: string }
  | { kind: 'saveInvestigation'; deviationId: string; patch: Partial<Deviation>; baseVersion: number }
  | { kind: 'reviewDeviation'; deviationId: string; disposition: Deviation['disposition']; note: string; baseVersion: number }
  | { kind: 'reopenDeviation'; deviationId: string; reason: string; operator: string }
  | { kind: 'release'; shipmentId: string; input: ReleaseInput; baseVersion: number }

interface ShipmentState {
  shipments: Shipment[]
  deviations: Deviation[]
  releases: ReleaseRecord[]
  audit: AuditEntry[]
  pendingSubmits: PendingSubmit[]
  /** submitId → 已落盘结果，持久化；保证刷新后按原提交重试也不重复生成核验/调查/放行记录 */
  applied: Record<string, SubmitResult>
  submitting: boolean
  keyword: string
  status: ShipmentStatus | '全部'
  setKeyword: (value: string) => void
  setStatus: (value: ShipmentStatus | '全部') => void
  addEvidence: (shipmentId: string, input: NewEvidenceInput) => Promise<SubmitResult>
  verifyEvidence: (shipmentId: string, evidenceId: string, reviewer?: string) => Promise<SubmitResult>
  sign: (shipmentId: string, role: string, comment: string, status: '已签' | '已退回') => { ok: boolean; message: string }
  createDeviation: (shipmentId: string, segmentId: string, title: string, severity: '一般' | '重大') => void
  saveInvestigation: (id: string, patch: Partial<Deviation>, baseVersion: number) => Promise<SubmitResult>
  reviewDeviation: (id: string, disposition: Deviation['disposition'], note: string, baseVersion: number) => Promise<SubmitResult>
  reopenDeviation: (id: string, reason: string, operator?: string) => Promise<SubmitResult>
  submitRelease: (shipmentId: string, input: ReleaseInput, baseVersion: number) => Promise<SubmitResult>
  retrySubmit: (submitId: string) => Promise<SubmitResult>
  dismissPending: (submitId: string) => void
  /** 两位复核员同时提交的并发模拟：把任务/偏差版本向前推进一步 */
  simulateConcurrentSubmit: (target: { kind: 'shipment'; id: string } | { kind: 'deviation'; id: string }) => void
  reset: () => void
}

let idSeed = 10
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${idSeed++}`
const now = () => new Date().toISOString()

/** 同类材料取最新版本；放行只采纳已核验版 */
export function latestVerifiedByCategory(evidence: EvidenceFile[]): Map<EvidenceCategory, EvidenceFile> {
  const result = new Map<EvidenceCategory, EvidenceFile>()
  for (const item of evidence) {
    if (!item.verified) continue
    const current = result.get(item.category)
    if (!current || item.version > current.version) result.set(item.category, item)
  }
  return result
}

/** 运输任务的当前放行结论（releases 按时间倒序写入，首条即最新） */
export function activeReleaseOf(releases: ReleaseRecord[], shipmentId: string): ReleaseRecord | undefined {
  return releases.find((item) => item.shipmentId === shipmentId)
}

const conflictResult = (label: string, base: number, current: number): SubmitResult => ({
  ok: false,
  conflict: true,
  currentVersion: current,
  persisted: true,
  message: `版本冲突：${label}已从V${base}前进到V${current}，另一位复核员的提交先生效。您填写的内容已保留，请核对最新依据后再提交。`
})

function makeAudit(shipmentId: string, action: string, operator: string, detail: string): AuditEntry {
  return { id: nextId('AUD'), shipmentId, action, operator, detail, createdAt: now() }
}

export const useShipmentStore = create<ShipmentState>()(persist((set, get) => {
  /** 在“落盘成功”后才执行的状态变更；同一 submitId 只执行一次 */
  const applyMutation = (payload: SubmitPayload): SubmitResult => {
    const state = get()

    if (payload.kind === 'addEvidence') {
      const shipment = state.shipments.find((item) => item.id === payload.shipmentId)
      if (!shipment) return { ok: false, message: '运输任务不存在', persisted: true }
      const family = shipment.evidence.filter((item) => item.category === payload.input.category)
      const previous = family.sort((a, b) => b.version - a.version)[0]
      const version = (previous?.version ?? 0) + 1
      const timestamp = now()
      const evidence: EvidenceFile = {
        id: nextId('E'), name: payload.input.name, category: payload.input.category, version,
        uploadedBy: payload.input.uploadedBy, uploadedAt: timestamp, verified: false,
        verifiedAt: '', verifiedBy: '', changeNote: payload.input.changeNote, supersedes: previous?.id ?? ''
      }
      shipment.evidence.unshift(evidence)
      shipment.version += 1
      shipment.updatedAt = timestamp
      const audits = [
        makeAudit(shipment.id, '上传证据版本', payload.input.uploadedBy, `${evidence.name}（${evidence.category} V${version}）${previous ? `，替代V${previous.version}` : ''}`)
      ]
      const release = activeReleaseOf(get().releases, shipment.id)
      if (release?.state === '有效') {
        invalidateRelease(shipment, release, `证据版本更新：${evidence.category}到达V${version}（${evidence.name}）`, payload.input.uploadedBy, undefined, timestamp)
        audits.push(makeAudit(shipment.id, '放行失效', '系统', `${release.id} 因${evidence.category}新版证据失效，任务回到复核`))
      }
      set((current) => ({ shipments: [...current.shipments], releases: [...current.releases], audit: [...audits, ...current.audit] }))
      return { ok: true, message: `已登记${evidence.category} V${version}，待核验`, persisted: true }
    }

    if (payload.kind === 'verifyEvidence') {
      const shipment = state.shipments.find((item) => item.id === payload.shipmentId)
      const evidence = shipment?.evidence.find((item) => item.id === payload.evidenceId)
      if (!shipment || !evidence) return { ok: false, message: '证据不存在', persisted: true }
      if (evidence.verified) return { ok: false, message: '该证据版本已完成核验，未重复生成记录', persisted: true }
      evidence.verified = true
      evidence.verifiedAt = now()
      evidence.verifiedBy = payload.reviewer
      shipment.version += 1
      shipment.updatedAt = evidence.verifiedAt
      set((current) => ({
        shipments: [...current.shipments],
        audit: [makeAudit(shipment.id, '核验证据', payload.reviewer, `${evidence.name}（${evidence.category} V${evidence.version}）`), ...current.audit]
      }))
      return { ok: true, message: `已核验 ${evidence.category} V${evidence.version}`, persisted: true }
    }

    if (payload.kind === 'saveInvestigation') {
      const deviation = state.deviations.find((item) => item.id === payload.deviationId)
      if (!deviation) return { ok: false, message: '偏差不存在', persisted: true }
      if (deviation.version !== payload.baseVersion) return conflictResult('偏差调查版本', payload.baseVersion, deviation.version)
      if (!payload.patch.cause?.trim() || !payload.patch.assessment?.trim()) return { ok: false, message: '原因调查与影响评估必须完整', persisted: true }
      Object.assign(deviation, payload.patch)
      deviation.status = '待放行复核'
      deviation.version += 1
      deviation.history.push(snapshotHistory(deviation, '提交偏差调查', deviation.owner))
      set((current) => ({
        deviations: [...current.deviations],
        audit: [makeAudit(deviation.shipmentId, '提交偏差调查', deviation.owner, `调查版本V${deviation.version}：${deviation.assessment}`), ...current.audit]
      }))
      return { ok: true, message: `调查已保存（V${deviation.version}）并提交放行复核`, persisted: true }
    }

    if (payload.kind === 'reviewDeviation') {
      const deviation = state.deviations.find((item) => item.id === payload.deviationId)
      if (!deviation) return { ok: false, message: '偏差不存在', persisted: true }
      if (deviation.version !== payload.baseVersion) return conflictResult('偏差调查版本', payload.baseVersion, deviation.version)
      if (payload.disposition === '拒绝' && !payload.note.trim()) return { ok: false, message: '拒绝放行必须填写理由', persisted: true }
      deviation.disposition = payload.disposition
      deviation.reviewer = '放行人员 顾言'
      deviation.reviewNote = payload.note
      deviation.status = '已关闭'
      deviation.closedAt = now()
      deviation.version += 1
      deviation.history.push(snapshotHistory(deviation, '放行复核', deviation.reviewer))
      const shipment = get().shipments.find((item) => item.id === deviation.shipmentId)
      if (shipment) {
        shipment.status = payload.disposition === '拒绝' ? '已拒绝' : '待放行'
        shipment.version += 1
        shipment.updatedAt = deviation.closedAt
      }
      set((current) => ({
        deviations: [...current.deviations],
        shipments: [...current.shipments],
        audit: [makeAudit(deviation.shipmentId, `偏差复核：${payload.disposition}`, deviation.reviewer, `依据调查V${deviation.version - 1}关闭偏差。${payload.note}`), ...current.audit]
      }))
      return { ok: true, message: `偏差已关闭（调查V${deviation.version}）`, persisted: true }
    }

    if (payload.kind === 'reopenDeviation') {
      const deviation = state.deviations.find((item) => item.id === payload.deviationId)
      if (!deviation) return { ok: false, message: '偏差不存在', persisted: true }
      if (deviation.status !== '已关闭') return { ok: false, message: '仅已关闭的偏差可以重新打开', persisted: true }
      deviation.status = '调查中'
      deviation.closedAt = ''
      deviation.version += 1
      deviation.history.push(snapshotHistory(deviation, `重新打开偏差：${payload.reason}`, payload.operator))
      const shipment = get().shipments.find((item) => item.id === deviation.shipmentId)
      const timestamp = now()
      const audits = [makeAudit(deviation.shipmentId, '重新打开偏差', payload.operator, `${deviation.title}（调查V${deviation.version}）：${payload.reason}`)]
      if (shipment) {
        shipment.status = '待放行'
        shipment.version += 1
        shipment.updatedAt = timestamp
        const release = activeReleaseOf(get().releases, shipment.id)
        if (release?.state === '有效') {
          invalidateRelease(shipment, release, `偏差${deviation.id}重新打开：${payload.reason}`, payload.operator, deviation.version, timestamp)
          audits.push(makeAudit(shipment.id, '放行失效', '系统', `${release.id} 所依据的调查V${release.deviationBasis.find((item) => item.deviationId === deviation.id)?.version ?? ''}被重新打开，任务回到复核`))
        }
      }
      set((current) => ({ deviations: [...current.deviations], shipments: [...current.shipments], releases: [...current.releases], audit: [...audits, ...current.audit] }))
      return { ok: true, message: `偏差已重新打开（调查V${deviation.version}），原放行结论失效`, persisted: true }
    }

    // release
    const shipment = state.shipments.find((item) => item.id === payload.shipmentId)
    if (!shipment) return { ok: false, message: '运输任务不存在', persisted: true }
    if (shipment.version !== payload.baseVersion) return conflictResult('运输任务版本', payload.baseVersion, shipment.version)
    const open = state.deviations.some((item) => item.shipmentId === shipment.id && item.status !== '已关闭')
    if (payload.input.decision === '批准放行') {
      if (open) return { ok: false, message: '存在未关闭温度偏差，不能放行', persisted: true }
      if (shipment.evidence.some((item) => !item.verified)) return { ok: false, message: '仍有证据版本未核验，不能放行', persisted: true }
      if (shipment.signatures.some((item) => item.role !== '放行人员' && item.status !== '已签')) return { ok: false, message: '多角色签收未完成，不能放行', persisted: true }
    }
    const timestamp = now()
    const evidenceBasis: ReleaseEvidenceRef[] = [...latestVerifiedByCategory(shipment.evidence).entries()].map(([category, item]) => ({
      category, evidenceId: item.id, evidenceName: item.name, version: item.version, verifiedAt: item.verifiedAt, verifiedBy: item.verifiedBy
    }))
    const deviationBasis: ReleaseDeviationRef[] = state.deviations
      .filter((item) => item.shipmentId === shipment.id && item.status === '已关闭')
      .map((item) => ({ deviationId: item.id, title: item.title, version: item.version, disposition: item.disposition, reviewer: item.reviewer, closedAt: item.closedAt }))
    const record: ReleaseRecord = {
      id: nextId('REL'), shipmentId: shipment.id, decision: payload.input.decision, reviewer: payload.input.reviewer,
      note: payload.input.note, shipmentVersion: shipment.version, releasedAt: timestamp,
      evidenceBasis, deviationBasis, state: '有效'
    }
    shipment.status = payload.input.decision === '批准放行' ? '已放行' : '已拒绝'
    shipment.version += 1
    shipment.updatedAt = timestamp
    const releaseSignature = shipment.signatures.find((item) => item.role === '放行人员')
    if (releaseSignature && payload.input.decision === '批准放行') {
      releaseSignature.status = '已签'
      releaseSignature.name = payload.input.reviewer
      releaseSignature.signedAt = timestamp
      releaseSignature.comment = payload.input.note
    }
    const basisText = evidenceBasis.map((item) => `${item.category}V${item.version}`).join('、')
      + (deviationBasis.length ? `；偏差调查${deviationBasis.map((item) => `V${item.version}`).join('、')}` : '')
    set((current) => ({
      shipments: [...current.shipments],
      releases: [record, ...current.releases],
      audit: [makeAudit(shipment.id, payload.input.decision, payload.input.reviewer, `${record.id} 任务V${record.shipmentVersion}；依据：${basisText}。${payload.input.note}`), ...current.audit]
    }))
    return { ok: true, message: `${payload.input.decision}已落盘（${record.id}），依据版本已固定`, persisted: true, submitId: record.id }
  }

  /** 让有效放行失效并回到复核，记录本身保留可查 */
  const invalidateRelease = (shipment: Shipment, release: ReleaseRecord, reason: string, by: string, _deviationVersion: number | undefined, timestamp: string) => {
    release.state = '失效'
    release.invalidated = { reason, at: timestamp, by, shipmentVersionAtInvalidate: shipment.version }
    shipment.status = '待放行'
  }

  /** 提交入口：业务校验先行，落盘阶段按 submitId 幂等 */
  const dispatch = async (payload: SubmitPayload, label: string, submitId: string): Promise<SubmitResult> => {
    const preflight = preflightCheck(payload)
    if (preflight) return preflight
    // 同一提交此前已落盘（含刷新后重试）：直接回放结果，不重复执行
    const already = get().applied[submitId]
    if (already) {
      set((state) => ({ pendingSubmits: state.pendingSubmits.filter((item) => item.submitId !== submitId) }))
      return already
    }
    set({ submitting: true })
    try {
      const result = await persistWrite(submitId, label, () => applyMutation(payload))
      set((state) => ({
        submitting: false,
        applied: { ...state.applied, [submitId]: result },
        pendingSubmits: state.pendingSubmits.filter((item) => item.submitId !== submitId)
      }))
      return result
    } catch (error) {
      const pending: PendingSubmit = {
        kind: payload.kind, label, shipmentId: shipmentIdOf(payload), submitId,
        baseVersion: 'baseVersion' in payload ? payload.baseVersion : 0, at: now(), payload
      }
      set((state) => ({
        submitting: false,
        pendingSubmits: [...state.pendingSubmits.filter((item) => item.submitId !== submitId), pending]
      }))
      return { ok: false, persisted: false, submitId, message: error instanceof Error ? error.message : '落盘失败，可按原提交重试' }
    }
  }

  const preflightCheck = (payload: SubmitPayload): SubmitResult | null => {
    const state = get()
    if (payload.kind === 'addEvidence') {
      const shipment = state.shipments.find((item) => item.id === payload.shipmentId)
      if (!shipment) return { ok: false, message: '运输任务不存在' }
      if (!payload.input.name.trim() || !payload.input.changeNote.trim()) return { ok: false, message: '文件名与版本差异说明必填' }
    }
    if (payload.kind === 'verifyEvidence') {
      const evidence = state.shipments.find((item) => item.id === payload.shipmentId)?.evidence.find((item) => item.id === payload.evidenceId)
      if (!evidence) return { ok: false, message: '证据不存在' }
    }
    if (payload.kind === 'saveInvestigation' || payload.kind === 'reviewDeviation') {
      const deviation = state.deviations.find((item) => item.id === (payload as { deviationId: string }).deviationId)
      if (!deviation) return { ok: false, message: '偏差不存在' }
    }
    if (payload.kind === 'reopenDeviation') {
      const deviation = state.deviations.find((item) => item.id === payload.deviationId)
      if (!deviation) return { ok: false, message: '偏差不存在' }
      if (deviation.status !== '已关闭') return { ok: false, message: '仅已关闭的偏差可以重新打开' }
      if (!payload.reason.trim()) return { ok: false, message: '重新打开必须填写原因' }
    }
    if (payload.kind === 'release') {
      if (!payload.input.reviewer.trim()) return { ok: false, message: '请填写复核员' }
      if (!payload.input.note.trim()) return { ok: false, message: '放行结论必须填写复核意见' }
    }
    return null
  }

  return {
    shipments: seedShipments,
    deviations: seedDeviations,
    releases: seedReleases,
    audit: seedAudit,
    pendingSubmits: [],
    applied: {},
    submitting: false,
    keyword: '',
    status: '全部',
    setKeyword: (keyword) => set({ keyword }),
    setStatus: (status) => set({ status }),

    addEvidence: (shipmentId, input) =>
      dispatch({ kind: 'addEvidence', shipmentId, input }, `${input.category}证据新版本`, nextId('SUB')),
    verifyEvidence: (shipmentId, evidenceId, reviewer = '复核员 沈澜') =>
      dispatch({ kind: 'verifyEvidence', shipmentId, evidenceId, reviewer }, '证据核验', nextId('SUB')),

    sign: (shipmentId, role, comment, status) => {
      const shipment = get().shipments.find((item) => item.id === shipmentId)
      const signature = shipment?.signatures.find((item) => item.role === role)
      if (!shipment || !signature) return { ok: false, message: '签收角色不存在' }
      if (status === '已退回' && !comment.trim()) return { ok: false, message: '退回必须填写原因' }
      signature.status = status
      signature.comment = comment
      signature.signedAt = now()
      shipment.version += 1
      shipment.updatedAt = signature.signedAt
      set((state) => ({ shipments: [...state.shipments], audit: [makeAudit(shipmentId, `${role}${status}`, signature.name, comment || '签署确认'), ...state.audit] }))
      return { ok: true, message: status === '已签' ? '签收成功' : '已退回并要求补充材料' }
    },

    createDeviation: (shipmentId, segmentId, title, severity) => {
      const shipment = get().shipments.find((item) => item.id === shipmentId)
      if (!shipment) return
      const timestamp = now()
      const deviation: Deviation = {
        id: nextId('TDEV'), shipmentId, segmentId, title, source: '人工报告', severity, status: '待调查', owner: '温控质量组', openedAt: timestamp,
        dueDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '', version: 1, closedAt: '',
        history: [{ version: 1, stage: '待调查', action: '登记偏差', operator: '当前用户', at: timestamp, cause: '', assessment: '', disposition: '补充处理', correctiveAction: '', evidence: '', reviewer: '', reviewNote: '' }]
      }
      shipment.status = '待放行'
      shipment.version += 1
      shipment.updatedAt = timestamp
      const audits = [makeAudit(shipmentId, '登记温度偏差', '当前用户', title)]
      const release = activeReleaseOf(get().releases, shipmentId)
      if (release?.state === '有效') {
        invalidateRelease(shipment, release, `登记新偏差：${title}`, '当前用户', undefined, timestamp)
        audits.push(makeAudit(shipmentId, '放行失效', '系统', `${release.id} 因新登记偏差失效，任务回到复核`))
      }
      set((state) => ({ deviations: [deviation, ...state.deviations], shipments: [...state.shipments], releases: [...state.releases], audit: [...audits, ...state.audit] }))
    },

    saveInvestigation: (id, patch, baseVersion) =>
      dispatch({ kind: 'saveInvestigation', deviationId: id, patch, baseVersion }, '偏差调查保存', nextId('SUB')),
    reviewDeviation: (id, disposition, note, baseVersion) =>
      dispatch({ kind: 'reviewDeviation', deviationId: id, disposition, note, baseVersion }, '偏差放行复核', nextId('SUB')),
    reopenDeviation: (id, reason, operator = '温控质量组') =>
      dispatch({ kind: 'reopenDeviation', deviationId: id, reason, operator }, '偏差重新打开', nextId('SUB')),
    submitRelease: (shipmentId, input, baseVersion) =>
      dispatch({ kind: 'release', shipmentId, input, baseVersion }, '放行结论提交', nextId('SUB')),

    retrySubmit: async (submitId) => {
      const pending = get().pendingSubmits.find((item) => item.submitId === submitId)
      if (!pending) return { ok: false, message: '没有待重试的提交' }
      return dispatch(pending.payload as SubmitPayload, pending.label, submitId)
    },
    dismissPending: (submitId) =>
      set((state) => ({ pendingSubmits: state.pendingSubmits.filter((item) => item.submitId !== submitId) })),

    simulateConcurrentSubmit: (target) => set((state) => {
      const audit: AuditEntry[] = []
      if (target.kind === 'shipment') {
        const shipment = state.shipments.find((item) => item.id === target.id)
        if (!shipment) return state
        shipment.version += 1
        shipment.updatedAt = now()
        audit.push(makeAudit(shipment.id, '并发提交', '另一工位复核员', `另一位复核员已先行提交（任务V${shipment.version}）`))
      } else {
        const deviation = state.deviations.find((item) => item.id === target.id)
        if (!deviation) return state
        const timestamp = now()
        deviation.version += 1
        deviation.history.push({
          version: deviation.version, stage: deviation.status, action: '并发提交', operator: '另一工位复核员', at: timestamp,
          cause: deviation.cause, assessment: deviation.assessment, disposition: deviation.disposition,
          correctiveAction: deviation.correctiveAction, evidence: deviation.evidence,
          reviewer: deviation.reviewer, reviewNote: deviation.reviewNote
        })
        audit.push(makeAudit(deviation.shipmentId, '并发提交', '另一工位复核员', `另一位复核员已先行保存调查（调查V${deviation.version}）`))
      }
      return { shipments: [...state.shipments], deviations: [...state.deviations], audit: [...audit, ...state.audit] }
    }),

    reset: () => {
      resetProcessedSubmits()
      set({
        shipments: structuredClone(seedShipments), deviations: structuredClone(seedDeviations),
        releases: structuredClone(seedReleases), audit: structuredClone(seedAudit),
        pendingSubmits: [], applied: {}, submitting: false, keyword: '', status: '全部'
      })
    }
  }
}, {
  name: 'gsb65:temperature-chain',
  version: 2,
  migrate: (persisted: unknown) => {
    const state = (persisted ?? {}) as Partial<ShipmentState>
    return {
      ...state,
      releases: state.releases ?? [],
      pendingSubmits: state.pendingSubmits ?? [],
      applied: state.applied ?? {},
      shipments: (state.shipments ?? []).map((shipment) => ({
        ...shipment,
        evidence: shipment.evidence.map((item) => ({
          ...item,
          verifiedAt: item.verifiedAt ?? (item.verified ? shipment.updatedAt : ''),
          verifiedBy: item.verifiedBy ?? (item.verified ? '历史核验' : ''),
          changeNote: item.changeNote ?? '',
          supersedes: item.supersedes ?? ''
        }))
      })),
      deviations: (state.deviations ?? []).map((item) => ({
        ...item,
        closedAt: item.closedAt ?? '',
        history: item.history ?? []
      }))
    } as ShipmentState
  }
}))

function snapshotHistory(deviation: Deviation, action: string, operator: string): Deviation['history'][number] {
  return {
    version: deviation.version, stage: deviation.status, action, operator, at: now(),
    cause: deviation.cause, assessment: deviation.assessment, disposition: deviation.disposition,
    correctiveAction: deviation.correctiveAction, evidence: deviation.evidence,
    reviewer: deviation.reviewer, reviewNote: deviation.reviewNote
  }
}

function shipmentIdOf(payload: SubmitPayload): string {
  if (payload.kind === 'saveInvestigation' || payload.kind === 'reviewDeviation' || payload.kind === 'reopenDeviation') {
    return useShipmentStore.getState().deviations.find((item) => item.id === payload.deviationId)?.shipmentId ?? ''
  }
  return payload.shipmentId
}

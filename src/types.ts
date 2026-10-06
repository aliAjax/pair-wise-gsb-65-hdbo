export type ShipmentStatus = '待装机' | '运输中' | '待放行' | '已放行' | '已拒绝'
export type DeviationStatus = '待调查' | '调查中' | '待放行复核' | '已关闭'
export type EvidenceCategory = '温度曲线' | '设备报告' | '包装确认' | '交接签字'

export interface TemperaturePoint {
  id: string
  time: string
  value: number
}

export interface ShipmentSegment {
  id: string
  from: string
  to: string
  flight: string
  plannedStart: string
  actualStart: string
  actualEnd: string
  handler: string
  note: string
  temperature: TemperaturePoint[]
}

export interface EvidenceFile {
  id: string
  name: string
  category: EvidenceCategory
  version: number
  uploadedBy: string
  uploadedAt: string
  verified: boolean
  verifiedAt: string
  verifiedBy: string
  /** 与上一版相比的说明，便于调查员判断新版是否影响放行 */
  changeNote: string
  /** 替代的同类别上一版证据 id */
  supersedes: string
}

export interface ShipmentSignature {
  role: '发货方' | '承运方' | '收货方' | '放行人员'
  name: string
  status: '待签' | '已签' | '已退回'
  signedAt: string
  comment: string
}

/** 放行时冻结的证据版本快照：同类别只取最新且已核验的一版 */
export interface ReleaseEvidenceRef {
  category: EvidenceCategory
  evidenceId: string
  evidenceName: string
  version: number
  verifiedAt: string
  verifiedBy: string
}

/** 放行时冻结的偏差调查版本快照 */
export interface ReleaseDeviationRef {
  deviationId: string
  title: string
  version: number
  disposition: Deviation['disposition']
  reviewer: string
  closedAt: string
}

export type ReleaseState = '有效' | '失效'
export type ReleaseDecisionKind = '批准放行' | '拒绝放行'

export interface ReleaseInvalidation {
  reason: string
  at: string
  by: string
  shipmentVersionAtInvalidate: number
  deviationVersionAtInvalidate?: number
}

/** 放行结论：一旦生成内容不可变；仅允许通过 invalidated 标记失效 */
export interface ReleaseRecord {
  id: string
  shipmentId: string
  decision: ReleaseDecisionKind
  reviewer: string
  note: string
  /** 提交时依据的运输任务版本（乐观锁基准） */
  shipmentVersion: number
  releasedAt: string
  evidenceBasis: ReleaseEvidenceRef[]
  deviationBasis: ReleaseDeviationRef[]
  state: ReleaseState
  invalidated?: ReleaseInvalidation
}

export interface DeviationHistoryEntry {
  version: number
  stage: DeviationStatus
  action: string
  operator: string
  at: string
  cause: string
  assessment: string
  disposition: Deviation['disposition']
  correctiveAction: string
  evidence: string
  reviewer: string
  reviewNote: string
}

export interface Shipment {
  id: string
  product: string
  batch: string
  route: string
  containerId: string
  tempMin: number
  tempMax: number
  plannedDeparture: string
  actualArrival: string
  status: ShipmentStatus
  segments: ShipmentSegment[]
  evidence: EvidenceFile[]
  signatures: ShipmentSignature[]
  version: number
  updatedAt: string
}

export interface Deviation {
  id: string
  shipmentId: string
  segmentId: string
  title: string
  source: '自动监测' | '人工报告'
  severity: '一般' | '重大'
  status: DeviationStatus
  owner: string
  openedAt: string
  dueDate: string
  cause: string
  assessment: string
  disposition: '接受' | '补充处理' | '拒绝'
  correctiveAction: string
  evidence: string
  reviewer: string
  reviewNote: string
  version: number
  closedAt: string
  /** 每次保存调查 / 复核 / 重开形成的调查版本快照，最新一条即当前调查版本 */
  history: DeviationHistoryEntry[]
}

export interface AuditEntry {
  id: string
  shipmentId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

/** 提交类型；用于落盘失败后的幂等重试 */
export type SubmitKind = 'addEvidence' | 'verifyEvidence' | 'saveInvestigation' | 'reviewDeviation' | 'reopenDeviation' | 'release'

export interface ReleaseSubmitInput {
  decision: ReleaseDecisionKind
  reviewer: string
  note: string
}

export interface PendingSubmit {
  kind: SubmitKind
  label: string
  shipmentId: string
  submitId: string
  baseVersion: number
  at: string
  payload: unknown
}

export interface SubmitResult {
  ok: boolean
  message: string
  /** 版本冲突：提交期间任务/偏差版本已前进，表单内容保留 */
  conflict?: boolean
  currentVersion?: number
  /** 落盘失败：可用同一 submitId 原样重试 */
  persisted?: boolean
  submitId?: string
}

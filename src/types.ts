export type ShipmentStatus = '待装机' | '运输中' | '待放行' | '已放行' | '已拒绝'
export type DeviationStatus = '待调查' | '调查中' | '待放行复核' | '已关闭'
export type EvidenceCategory = '温度曲线' | '设备报告' | '包装确认' | '交接签字'
export type ReleaseDecision = '放行' | '拒绝'
export type ReleaseLife = '生效' | '已失效-证据更新' | '已失效-偏差重开' | '已失效-被新结论取代'

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
  /** 同一证据材料的版本序号，重新上传同名/同类材料时递增 */
  version: number
  /** 该版本所替换的上一版本 id，形成材料自身的版本链 */
  supersedes?: string
  uploadedBy: string
  uploadedAt: string
  verified: boolean
  /** 失效核验：新版本到达后，旧版本上的核验标记不再参与放行 */
  stale?: boolean
  verifiedBy?: string
  verifiedAt?: string
}

export interface ShipmentSignature {
  role: '发货方' | '承运方' | '收货方' | '放行人员'
  name: string
  status: '待签' | '已签' | '已退回'
  signedAt: string
  comment: string
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
  /** 当前生效放行结论的 id；失效后清空，任务回到“待放行”复核 */
  activeReleaseId?: string
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
  /** 调查/复核内容版本，每次提交递增 */
  version: number
  closedAt?: string
  /** 重新打开时记录的原因，历史复核结论保留在 reviewHistory 中 */
  reopenReason?: string
  reopenedAt?: string
  reviewHistory?: DeviationReviewSnapshot[]
}

export interface DeviationReviewSnapshot {
  version: number
  disposition: Deviation['disposition']
  reviewer: string
  reviewNote: string
  closedAt: string
}

/** 放行时冻结的单个证据引用：只认当时最新且已核验的版本 */
export interface EvidenceBasis {
  evidenceId: string
  category: EvidenceCategory
  version: number
  name: string
  verified: boolean
}

/** 放行时冻结的偏差调查版本引用 */
export interface DeviationBasis {
  deviationId: string
  title: string
  version: number
  disposition: Deviation['disposition']
  reviewer: string
  closedAt: string
}

export interface ReleaseRecord {
  id: string
  shipmentId: string
  /** 该任务第几次放行结论，仅递增不复用 */
  seq: number
  decision: ReleaseDecision
  reviewer: string
  note: string
  /** 提交时任务所在版本（乐观锁基准） */
  basedOnShipmentVersion: number
  /** 放行依据冻结时刻 */
  decidedAt: string
  evidenceBasis: EvidenceBasis[]
  deviationBasis: DeviationBasis[]
  life: ReleaseLife
  invalidatedAt?: string
  invalidReason?: string
  /** 幂等键：落盘失败后凭同一 requestId 重试，不会重复生成结论 */
  requestId: string
}

/** 已落盘提交的幂等台账：同一 requestId 永远只对应一条结论 */
export interface ReleaseRequestLedger {
  requestId: string
  releaseId: string
  shipmentId: string
  committedAt: string
}

export interface ReleaseSubmitInput {
  shipmentId: string
  reviewer: string
  decision: ReleaseDecision
  note: string
  /** 打开放行单时看到的任务版本，用于并发冲突检测 */
  expectedVersion: number
  requestId: string
  /** 演示用：让本次落盘在写入前失败（网络抖动/持久化故障） */
  simulatePersistFailure?: boolean
}

export type ReleaseSubmitResult =
  | { ok: true; release: ReleaseRecord; duplicate?: boolean }
  | { ok: false; code: 'VERSION_CONFLICT'; currentVersion: number; activeRelease?: ReleaseRecord; message: string }
  | { ok: false; code: 'BLOCKED'; message: string }
  | { ok: false; code: 'PERSIST_FAILED'; requestId: string; message: string }
  | { ok: false; code: 'NOT_FOUND'; message: string }

export interface AuditEntry {
  id: string
  shipmentId: string
  action: string
  operator: string
  detail: string
  createdAt: string
}

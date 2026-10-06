import type { AuditEntry, Deviation, ReleaseRecord, Shipment } from '../types'

const series = (base: number, pattern: number[]): { id: string; time: string; value: number }[] => pattern.map((value, index) => ({
  id: `T-${index}`,
  time: `2026-09-29T${String(6 + Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}:00`,
  value: base + value
}))

export const seedShipments: Shipment[] = [
  {
    id: 'AIR-260929-01', product: '单克隆抗体注射液', batch: 'MAB-260927', route: '上海浦东 PVG → 巴黎 CDG', containerId: 'RKN-44018',
    tempMin: 2, tempMax: 8, plannedDeparture: '2026-09-29T06:00:00', actualArrival: '2026-09-29T06:00:00', status: '待放行', version: 8, updatedAt: '2026-09-29T10:40:00', activeReleaseId: 'REL-260929-01-0002',
    segments: [
      { id: 'SEG-1', from: '上海医药仓库', to: '浦东机场货站', flight: '陆运', plannedStart: '2026-09-29T04:30:00', actualStart: '2026-09-29T04:36:00', actualEnd: '2026-09-29T05:22:00', handler: '张骁', note: '预冷至4.2℃后装车', temperature: series(3.8, [0, .2, .4, .7, .5, .3, .1, .2, .4, .6, .5, .3]) },
      { id: 'SEG-2', from: '浦东机场货站', to: 'CDG货站', flight: 'AF111', plannedStart: '2026-09-29T06:00:00', actualStart: '2026-09-29T06:42:00', actualEnd: '2026-09-29T18:30:00', handler: '法航货运', note: '中转停留2小时，外包装完整', temperature: series(4.1, [0, .3, .5, .2, -.2, -.5, -.8, -.4, .1, .8, 1.3, 1.7, 1.9, 1.4, .7, .2, -.1, .3]) },
      { id: 'SEG-3', from: 'CDG货站', to: '巴黎中心仓', flight: '陆运', plannedStart: '2026-09-29T18:30:00', actualStart: '2026-09-29T19:05:00', actualEnd: '2026-09-29T20:20:00', handler: 'L. Martin', note: '交接时箱体指示灯正常', temperature: series(4.5, [0, .4, .8, 1.2, .9, .5, .2, -.1, -.2, .1]) }
    ],
    evidence: [
      { id: 'E-1', name: 'RKN-44018原始温度记录.csv', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T20:32:00', verified: true, verifiedBy: '温控质量组', verifiedAt: '2026-09-29T21:05:00' },
      { id: 'E-6', name: 'RKN-44018到货温度记录（货站补传）.csv', category: '温度曲线', version: 2, supersedes: 'E-1', uploadedBy: 'CDG货站', uploadedAt: '2026-09-29T22:15:00', verified: true, verifiedBy: '温控质量组', verifiedAt: '2026-09-29T22:40:00' },
      { id: 'E-2', name: 'AF111装机确认.pdf', category: '设备报告', version: 1, uploadedBy: '法航货运', uploadedAt: '2026-09-29T06:50:00', verified: true, verifiedBy: '温控质量组', verifiedAt: '2026-09-29T21:05:00' },
      { id: 'E-7', name: 'AF111集装器温控设备复检报告.pdf', category: '设备报告', version: 2, supersedes: 'E-2', uploadedBy: '法航货运', uploadedAt: '2026-09-29T22:20:00', verified: true, verifiedBy: '温控质量组', verifiedAt: '2026-09-29T22:40:00' },
      { id: 'E-8', name: 'RKN-44018到货包装确认单.jpg', category: '包装确认', version: 1, uploadedBy: 'CDG货站', uploadedAt: '2026-09-29T22:10:00', verified: true, verifiedBy: '温控质量组', verifiedAt: '2026-09-29T22:40:00' },
      { id: 'E-3', name: '巴黎中心仓交接单.jpg', category: '交接签字', version: 1, uploadedBy: 'L. Martin', uploadedAt: '2026-09-29T20:25:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '张骁', status: '已签', signedAt: '2026-09-29T05:30:00', comment: '包装与预冷符合要求' },
      { role: '承运方', name: '法航货运', status: '已签', signedAt: '2026-09-29T19:12:00', comment: '航段交接无异常' },
      { role: '收货方', name: 'L. Martin', status: '已签', signedAt: '2026-09-29T20:30:00', comment: '外包装完整，箱体数据已核' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  },
  {
    id: 'AIR-260929-02', product: '细胞治疗样本', batch: 'CELL-260929', route: '北京首都 PEK → 东京羽田 HND', containerId: 'CRT-9207',
    tempMin: 2, tempMax: 10, plannedDeparture: '2026-09-29T09:30:00', actualArrival: '2026-09-29T09:30:00', status: '待放行', version: 4, updatedAt: '2026-09-29T17:40:00',
    segments: [
      { id: 'SEG-1', from: '北京实验室', to: '首都机场', flight: '陆运', plannedStart: '2026-09-29T07:00:00', actualStart: '2026-09-29T07:12:00', actualEnd: '2026-09-29T08:05:00', handler: '苏晴', note: '干冰余量复核', temperature: series(4.2, [0, .3, .6, .8, .5, .2]) },
      { id: 'SEG-2', from: '首都机场', to: '羽田机场', flight: 'NH964', plannedStart: '2026-09-29T09:30:00', actualStart: '2026-09-29T10:05:00', actualEnd: '2026-09-29T14:10:00', handler: '全日空货运', note: '货舱温度短时偏高', temperature: series(5.8, [0, .9, 1.8, 2.4, 3.1, 4.4, 3.2, 1.8, .7, .2]) }
    ],
    evidence: [
      { id: 'E-4', name: 'CRT-9207温度曲线.xlsx', category: '温度曲线', version: 1, uploadedBy: '系统', uploadedAt: '2026-09-29T17:12:00', verified: true, verifiedBy: '温控质量组', verifiedAt: '2026-09-29T17:30:00' },
      { id: 'E-5', name: '货舱温控说明.pdf', category: '设备报告', version: 1, uploadedBy: '全日空货运', uploadedAt: '2026-09-29T17:20:00', verified: false }
    ],
    signatures: [
      { role: '发货方', name: '苏晴', status: '已签', signedAt: '2026-09-29T08:10:00', comment: '样本封箱完成' },
      { role: '承运方', name: '全日空货运', status: '已签', signedAt: '2026-09-29T14:30:00', comment: '温度波动已报告' },
      { role: '收货方', name: '佐藤健', status: '待签', signedAt: '', comment: '' },
      { role: '放行人员', name: '顾言', status: '待签', signedAt: '', comment: '' }
    ]
  }
]

export const seedDeviations: Deviation[] = [
  {
    id: 'TDEV-260929-01', shipmentId: 'AIR-260929-02', segmentId: 'SEG-2', title: '航段温度最高达到10.4℃', source: '自动监测', severity: '重大', status: '调查中', owner: '温控质量组', openedAt: '2026-09-29T14:05:00', dueDate: '2026-09-29', version: 3,
    cause: '航班临时调整至非温控货舱，转运时开门时间延长。', assessment: '超限约18分钟，样本稳定性研究显示可承受30分钟内偏差，但需收货方确认。', disposition: '补充处理', correctiveAction: '收货方完成外观和温度标签复核后决定是否接收。', evidence: '温度原始曲线、航班货舱变更通知、地面操作记录。', reviewer: '', reviewNote: ''
  },
  {
    id: 'TDEV-260929-02', shipmentId: 'AIR-260929-01', segmentId: 'SEG-2', title: 'AF111航段中转区短时温度波动', source: '自动监测', severity: '一般', status: '已关闭', owner: '温控质量组', openedAt: '2026-09-29T18:40:00', dueDate: '2026-09-29', version: 2, closedAt: '2026-09-29T21:20:00',
    cause: '中转停留期间冷藏车对接延迟约15分钟，箱内温度峰值8.1℃。', assessment: '超限持续4分钟，幅度0.1℃，温度记录仪显示回落后持续稳定，药品稳定性风险可接受。', disposition: '接受', correctiveAction: '要求货站优化中转对接时序，记录本次延迟。', evidence: '温度曲线V1、装机确认单、地面操作记录。', reviewer: '放行人员 顾言', reviewNote: '超限轻微且有回落证据，同意关闭并放行。',
    reviewHistory: [{ version: 1, disposition: '接受', reviewer: '放行人员 顾言', reviewNote: '依据温度曲线V1初核：超限轻微，同意关闭。', closedAt: '2026-09-29T21:00:00' }]
  }
]

export const seedReleaseRecords: ReleaseRecord[] = [
  {
    id: 'REL-260929-01-0001', shipmentId: 'AIR-260929-01', seq: 1, decision: '放行', reviewer: '放行人员 顾言', note: '首批材料核验完成，偏差TDEV-260929-02已关闭，同意放行。',
    basedOnShipmentVersion: 5, decidedAt: '2026-09-29T21:30:00', life: '已失效-证据更新', invalidatedAt: '2026-09-29T22:15:00',
    invalidReason: '温度曲线发布V2（RKN-44018到货温度记录（货站补传）.csv），放行依据的V1不再是最新核验版',
    evidenceBasis: [
      { evidenceId: 'E-1', category: '温度曲线', version: 1, name: 'RKN-44018原始温度记录.csv', verified: true },
      { evidenceId: 'E-2', category: '设备报告', version: 1, name: 'AF111装机确认.pdf', verified: true }
    ],
    deviationBasis: [
      { deviationId: 'TDEV-260929-02', title: 'AF111航段中转区短时温度波动', version: 1, disposition: '接受', reviewer: '放行人员 顾言', closedAt: '2026-09-29T21:00:00' }
    ],
    requestId: 'SEED-REL-0001'
  },
  {
    id: 'REL-260929-01-0002', shipmentId: 'AIR-260929-01', seq: 2, decision: '放行', reviewer: '放行人员 顾言', note: '货站补传材料已全部核验，按最新核验版重新放行。',
    basedOnShipmentVersion: 8, decidedAt: '2026-09-29T22:50:00', life: '生效',
    evidenceBasis: [
      { evidenceId: 'E-6', category: '温度曲线', version: 2, name: 'RKN-44018到货温度记录（货站补传）.csv', verified: true },
      { evidenceId: 'E-7', category: '设备报告', version: 2, name: 'AF111集装器温控设备复检报告.pdf', verified: true },
      { evidenceId: 'E-8', category: '包装确认', version: 1, name: 'RKN-44018到货包装确认单.jpg', verified: true }
    ],
    deviationBasis: [
      { deviationId: 'TDEV-260929-02', title: 'AF111航段中转区短时温度波动', version: 2, disposition: '接受', reviewer: '放行人员 顾言', closedAt: '2026-09-29T21:20:00' }
    ],
    requestId: 'SEED-REL-0002'
  }
]

export const seedAudit: AuditEntry[] = [
  { id: 'A65-1', shipmentId: 'AIR-260929-01', action: '任务创建', operator: '张骁', detail: '关联3个航段和4类证据要求', createdAt: '2026-09-29T04:10:00' },
  { id: 'A65-2', shipmentId: 'AIR-260929-02', action: '自动创建偏差', operator: '温度监测系统', detail: 'SEG-2温度10.4℃超出2-10℃范围', createdAt: '2026-09-29T14:05:00' },
  { id: 'A65-3', shipmentId: 'AIR-260929-02', action: '提交偏差调查', operator: '温控质量组', detail: '补充处理分支，等待收货方稳定性确认', createdAt: '2026-09-29T16:40:00' },
  { id: 'A65-4', shipmentId: 'AIR-260929-01', action: '放行结论生效', operator: '放行人员 顾言', detail: 'REL-260929-01-0001 放行，冻结证据2份、偏差调查1份（TDEV-260929-02 V1）', createdAt: '2026-09-29T21:30:00' },
  { id: 'A65-5', shipmentId: 'AIR-260929-01', action: '放行结论失效', operator: '系统', detail: 'REL-260929-01-0001 因温度曲线V2发布失效，任务回到待放行复核', createdAt: '2026-09-29T22:15:00' },
  { id: 'A65-6', shipmentId: 'AIR-260929-01', action: '放行结论生效', operator: '放行人员 顾言', detail: 'REL-260929-01-0002 放行，冻结最新核验版证据3份、偏差调查TDEV-260929-02 V2', createdAt: '2026-09-29T22:50:00' }
]

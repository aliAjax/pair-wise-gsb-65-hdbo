import { useMemo, useState } from 'react'
import { Button, Input, Table, Tag, Tabs, Timeline, Tooltip } from 'antd'
import { FailureDrillButton } from '../components/PendingSubmitBar'
import { useShipmentStore } from '../store/useShipmentStore'
import type { AuditEntry, ReleaseRecord } from '../types'

export function AuditTrail() {
  const state = useShipmentStore()
  const [keyword, setKeyword] = useState('')
  const rows = useMemo(() => state.audit.filter((item) => `${item.shipmentId} ${item.action} ${item.operator} ${item.detail}`.toLowerCase().includes(keyword.toLowerCase())), [state.audit, keyword])
  const releases = useMemo(() => state.releases.filter((item) => `${item.shipmentId} ${item.id} ${item.reviewer} ${item.note}`.toLowerCase().includes(keyword.toLowerCase())), [state.releases, keyword])
  const exportReport = () => {
    const report = { generatedAt: new Date().toISOString(), shipments: state.shipments, deviations: state.deviations, releases: state.releases, audit: state.audit }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = '航空温控放行报告.json'; anchor.click(); URL.revokeObjectURL(url)
  }
  const columns = [
    { title: '时间', dataIndex: 'createdAt', width: 160, render: (value: string) => value.replace('T', ' ').slice(0, 16) },
    { title: '运输任务', dataIndex: 'shipmentId', width: 160 },
    { title: '动作', dataIndex: 'action', width: 170, render: (value: string) => <Tag color={value.includes('失效') ? 'warning' : value.includes('偏差') ? 'purple' : value.includes('放行') || value.includes('拒绝') ? 'success' : 'processing'}>{value}</Tag> },
    { title: '操作人', dataIndex: 'operator', width: 150 },
    { title: '说明', dataIndex: 'detail' }
  ]
  return <section className="page">
    <header className="page-head">
      <div><p>放行结论 / 证据版本 / 偏差调查版本 / 签收</p><h1>完整报告与审计</h1></div>
      <Button.Group><FailureDrillButton /><Button type="primary" onClick={exportReport}>导出完整报告</Button></Button.Group>
    </header>
    <div className="toolbar"><Input value={keyword} onChange={(event) => setKeyword(event.target.value)} allowClear placeholder="搜索任务、放行号、动作、操作人或说明" /><span>共{rows.length}条审计事件 · {releases.length}份放行记录</span></div>
    <Tabs items={[
      {
        key: 'audit', label: `审计事件 (${rows.length})`,
        children: <Table<AuditEntry> rowKey="id" size="small" columns={columns} dataSource={rows} pagination={{ pageSize: 12 }} />
      },
      {
        key: 'releases', label: `放行依据链 (${releases.length})`,
        children: <Timeline className="audit-releases" items={releases.map((record) => ({
          color: record.state === '失效' ? 'gray' : record.decision === '批准放行' ? 'green' : 'red',
          children: <ReleaseAuditCard record={record} />
        }))} />
      }
    ]} />
  </section>
}

function ReleaseAuditCard({ record }: { record: ReleaseRecord }) {
  return <div className="audit-release-card">
    <div className="release-card-head">
      <b>{record.decision}</b>
      <Tag>{record.id}</Tag>
      <Tag color={record.state === '有效' ? 'success' : 'default'}>{record.state}</Tag>
      <small className="muted">{record.shipmentId} · 任务V{record.shipmentVersion} · {record.reviewer} · {record.releasedAt.replace('T', ' ').slice(0, 16)}</small>
    </div>
    <p>{record.note}</p>
    <div>
      {record.evidenceBasis.map((item) => <Tooltip key={item.evidenceId} title={`${item.evidenceName} · ${item.verifiedBy} 于 ${item.verifiedAt.replace('T', ' ').slice(0, 16)} 核验`}>
        <Tag color="cyan">{item.category} V{item.version}</Tag>
      </Tooltip>)}
      {record.deviationBasis.map((item) => <Tag key={item.deviationId} color="purple">{item.deviationId} 调查V{item.version}（{item.disposition}）</Tag>)}
    </div>
    {record.invalidated && <div className="invalidated-box">
      {record.invalidated.at.replace('T', ' ').slice(0, 16)} 失效：{record.invalidated.reason} <small>触发：{record.invalidated.by}</small>
    </div>}
  </div>
}

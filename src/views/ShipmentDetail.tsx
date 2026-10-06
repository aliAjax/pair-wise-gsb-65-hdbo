import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, Descriptions, Divider, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Timeline, message } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { TemperatureChart } from '../components/TemperatureChart'
import { ReleaseModal } from '../components/ReleaseModal'
import { useShipmentStore } from '../store/useShipmentStore'
import type { EvidenceCategory, EvidenceFile, ReleaseRecord } from '../types'

const lifeColor: Record<ReleaseRecord['life'], string> = {
  '生效': 'success',
  '已失效-证据更新': 'warning',
  '已失效-偏差重开': 'warning',
  '已失效-被新结论取代': 'default'
}

export function ShipmentDetail() {
  const { id } = useParams()
  const state = useShipmentStore()
  const shipment = state.shipments.find((item) => item.id === id)
  const [activeSegmentId, setActiveSegmentId] = useState(shipment?.segments[0]?.id ?? '')
  const [signOpen, setSignOpen] = useState(false)
  const [deviationOpen, setDeviationOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [form] = Form.useForm()
  const [uploadForm] = Form.useForm()
  if (!shipment) return <section className="page empty">未找到运输任务</section>

  const activeSegment = shipment.segments.find((item) => item.id === activeSegmentId) ?? shipment.segments[0]
  const deviations = state.deviations.filter((item) => item.shipmentId === shipment.id)
  const openDeviations = deviations.filter((item) => item.status !== '已关闭')
  const releases = state.releaseRecords.filter((item) => item.shipmentId === shipment.id)
  const activeRelease = releases.find((item) => item.life === '生效')
  const lastInvalid = releases.find((item) => item.life !== '生效')

  const evidenceColumns = [
    {
      title: '文件', dataIndex: 'name',
      render: (value: string, row: EvidenceFile) => <div>
        <strong>{value}</strong>
        <small className="cell-sub">{row.category} · V{row.version}{row.supersedes ? ` · 替代 V${row.version - 1}` : ''}</small>
      </div>
    },
    { title: '上传', render: (_: unknown, row: EvidenceFile) => `${row.uploadedBy} ${row.uploadedAt.replace('T', ' ').slice(0, 16)}` },
    {
      title: '核验状态', width: 150,
      render: (_: unknown, row: EvidenceFile) => {
        if (row.stale) return <Tag color="warning">旧版·已被新版取代</Tag>
        if (row.verified) return <div><Tag color="success">已核验</Tag><small className="cell-sub">{row.verifiedBy} {row.verifiedAt?.replace('T', ' ').slice(5, 16)}</small></div>
        return <Button size="small" onClick={() => state.verifyEvidence(shipment.id, row.id)}>核验</Button>
      }
    }
  ]

  const sign = async () => {
    const values = await form.validateFields()
    const result = state.sign(shipment.id, values.role, values.comment ?? '', values.decision)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) setSignOpen(false)
  }
  const createDeviation = async () => {
    const values = await form.validateFields()
    state.createDeviation(shipment.id, values.segmentId, values.title, values.severity)
    setDeviationOpen(false)
    message.success('已创建偏差并进入调查队列')
  }
  const upload = async () => {
    const values = await uploadForm.validateFields()
    state.addEvidence(shipment.id, {
      name: values.name,
      category: values.category,
      uploadedBy: values.uploadedBy || '货站补传',
      verified: false
    })
    setUploadOpen(false)
    uploadForm.resetFields()
    message.warning(`已收到${values.category}新版本，如任务已放行，原结论将失效并回到复核`)
  }

  return <section className="page">
    <header className="page-head detail-head">
      <div><p>{shipment.id} · {shipment.batch}</p><h1>{shipment.product}</h1></div>
      <Space>
        <Button onClick={() => setDeviationOpen(true)}>登记偏差</Button>
        <Button onClick={() => setSignOpen(true)}>角色签收</Button>
        <Button onClick={() => setUploadOpen(true)} icon={<UploadOutlined />}>货站补传证据</Button>
        <Button type="primary" onClick={() => setReleaseOpen(true)}>放行复核</Button>
      </Space>
    </header>

    {activeRelease && <Alert
      type="success" showIcon
      style={{ marginBottom: 10 }}
      message={`当前生效放行结论 ${activeRelease.id}（${activeRelease.decision}）· 依据任务V${activeRelease.basedOnShipmentVersion}`}
      description={`冻结证据${activeRelease.evidenceBasis.length}份最新核验版、偏差调查${activeRelease.deviationBasis.length}份；复核员：${activeRelease.reviewer}；时间：${activeRelease.decidedAt.replace('T', ' ').slice(0, 16)}`}
    />}
    {shipment.status === '待放行' && lastInvalid && <Alert
      type="warning" showIcon
      style={{ marginBottom: 10 }}
      message={`历史放行结论 ${lastInvalid.id} 已失效（${lastInvalid.life}），任务已回到复核`}
      description={lastInvalid.invalidReason}
    />}
    {openDeviations.length > 0 && <Alert type="error" showIcon style={{ marginBottom: 10 }} message={`存在${openDeviations.length}项未关闭温度偏差，系统阻止放行`} />}

    <Descriptions className="summary-band" size="small" column={5} items={[
      { key: 'route', label: '运输路线', children: shipment.route },
      { key: 'box', label: '温控箱', children: shipment.containerId },
      { key: 'range', label: '允许范围', children: `${shipment.tempMin} - ${shipment.tempMax} ℃` },
      { key: 'version', label: '任务版本', children: `V${shipment.version}` },
      { key: 'updated', label: '最近更新', children: shipment.updatedAt.replace('T', ' ').slice(0, 16) }
    ]} />
    <div className="detail-grid">
      <div className="timeline-panel">
        <div className="panel-title"><h2>航段时间轴</h2><span>原始温度点不可修改</span></div>
        {shipment.segments.map((segment) => <button key={segment.id} className={activeSegment.id === segment.id ? 'active' : ''} onClick={() => setActiveSegmentId(segment.id)}>
          <div className="segment-index">{segment.id.replace('SEG-', '')}</div>
          <div><strong>{segment.from} → {segment.to}</strong><span>{segment.flight} · {segment.plannedStart.replace('T', ' ').slice(0, 16)}</span><small>操作人：{segment.handler} · {segment.note}</small></div>
          <Badge status={segment.temperature.some((item) => item.value < shipment.tempMin || item.value > shipment.tempMax) ? 'error' : 'success'} />
        </button>)}
      </div>
      <div className="chart-panel">
        <div className="panel-title"><h2>{activeSegment.from} → {activeSegment.to}</h2><span>{activeSegment.flight}</span></div>
        <TemperatureChart points={activeSegment.temperature} min={shipment.tempMin} max={shipment.tempMax} />
        <div className="segment-meta"><span>计划：{activeSegment.plannedStart.replace('T', ' ').slice(0, 16)}</span><span>实际：{activeSegment.actualStart.replace('T', ' ').slice(0, 16)} - {activeSegment.actualEnd.replace('T', ' ').slice(0, 16)}</span></div>
      </div>
    </div>
    <Tabs className="detail-tabs" items={[
      {
        key: 'evidence', label: `证据版本 (${shipment.evidence.length})`,
        children: <div>
          <div className="tab-actions"><Button size="small" icon={<UploadOutlined />} onClick={() => setUploadOpen(true)}>补传新版本</Button><span>同类材料按版本递增；放行只取每类最新核验版，旧版保留可查</span></div>
          <Table rowKey="id" size="small" columns={evidenceColumns} dataSource={shipment.evidence} pagination={false} />
        </div>
      },
      {
        key: 'signatures', label: `签收记录 (${shipment.signatures.filter((item) => item.status === '已签').length}/${shipment.signatures.length})`,
        children: <div className="signature-grid">{shipment.signatures.map((item) => <Card key={item.role} size="small"><div className="signature-head"><strong>{item.role}</strong><Tag color={item.status === '已签' ? 'success' : item.status === '已退回' ? 'error' : 'default'}>{item.status}</Tag></div><p>{item.name}</p><small>{item.signedAt ? item.signedAt.replace('T', ' ').slice(0, 16) : '尚未签署'}</small><Divider /><span>{item.comment || '暂无意见'}</span></Card>)}</div>
      },
      {
        key: 'deviations', label: `偏差 (${deviations.length})`,
        children: <Table rowKey="id" size="small" pagination={false} dataSource={deviations} columns={[
          { title: '编号', dataIndex: 'id' },
          { title: '标题', dataIndex: 'title' },
          { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === '已关闭' ? 'success' : 'error'}>{value}</Tag> },
          { title: '调查版本', dataIndex: 'version', render: (value: number) => `V${value}` }
        ]} />
      },
      {
        key: 'releases', label: `放行结论 (${releases.length})`,
        children: releases.length === 0
          ? <div className="empty" style={{ padding: 30 }}>尚无放行结论</div>
          : <Timeline items={releases.map((release) => ({
            color: release.life === '生效' ? 'green' : 'gray',
            children: <Card size="small" style={{ background: release.life === '生效' ? '#f6ffed' : '#fafafa' }}>
              <div className="signature-head">
                <strong>{release.id} · 第{release.seq}次结论 · {release.decision}</strong>
                <Tag color={lifeColor[release.life]}>{release.life}</Tag>
              </div>
              <p style={{ margin: '8px 0 4px' }}>{release.note}</p>
              <small className="cell-sub">{release.reviewer} · {release.decidedAt.replace('T', ' ').slice(0, 16)} · 基于任务V{release.basedOnShipmentVersion}</small>
              <Divider style={{ margin: '8px 0' }} />
              <div className="release-basis">
                <span>证据依据：</span>
                {release.evidenceBasis.map((item) => <Tag key={item.evidenceId}>{item.category} V{item.version}{item.verified ? '·已核验' : ''}</Tag>)}
              </div>
              <div className="release-basis">
                <span>偏差依据：</span>
                {release.deviationBasis.length === 0
                  ? <small>无已关闭偏差</small>
                  : release.deviationBasis.map((item) => <Tag key={item.deviationId} color="success">{item.deviationId} V{item.version} · {item.disposition}</Tag>)}
              </div>
              {release.invalidReason && <Alert style={{ marginTop: 8 }} type="warning" showIcon message="失效原因" description={release.invalidReason} />}
            </Card>
          }))} />
      }
    ]} />

    {releaseOpen && <ReleaseModal shipment={shipment} open={releaseOpen} onClose={() => setReleaseOpen(false)} />}

    <Modal title="多角色签收" open={signOpen} onCancel={() => setSignOpen(false)} onOk={sign} okText="提交签收">
      <Form form={form} layout="vertical" initialValues={{ role: '放行人员', decision: '已签' }}>
        <Form.Item name="role" label="签收角色" rules={[{ required: true }]}><Select options={shipment.signatures.map((item) => ({ label: item.role, value: item.role }))} /></Form.Item>
        <Form.Item name="decision" label="签收决定" rules={[{ required: true }]}><Select options={[{ label: '签署确认', value: '已签' }, { label: '退回补充', value: '已退回' }]} /></Form.Item>
        <Form.Item name="comment" label="签收意见"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="登记温度偏差" open={deviationOpen} onCancel={() => setDeviationOpen(false)} onOk={createDeviation} okText="创建偏差">
      <Form form={form} layout="vertical" initialValues={{ segmentId: activeSegment.id, severity: '一般' }}>
        <Form.Item name="segmentId" label="发生航段" rules={[{ required: true }]}><Select options={shipment.segments.map((item) => ({ label: `${item.from} → ${item.to}`, value: item.id }))} /></Form.Item>
        <Form.Item name="title" label="偏差描述" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select options={['一般', '重大'].map((value) => ({ label: value, value }))} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="货站补传证据（新版本）" open={uploadOpen} onCancel={() => setUploadOpen(false)} onOk={upload} okText="提交新版本">
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="同分类材料将自动递增版本；任务已有生效放行结论时，新证据到达会使结论失效并回到复核，历史依据保留。" />
      <Form form={uploadForm} layout="vertical" initialValues={{ category: '温度曲线', uploadedBy: 'CDG货站' }}>
        <Form.Item name="category" label="证据分类" rules={[{ required: true }]}>
          <Select options={( ['温度曲线', '设备报告', '包装确认', '交接签字'] as EvidenceCategory[]).map((value) => ({ label: value, value }))} />
        </Form.Item>
        <Form.Item name="name" label="文件名" rules={[{ required: true, message: '请填写补传文件名' }]}><Input placeholder="例如：RKN-44018到货温度记录（货站补传）.csv" /></Form.Item>
        <Form.Item name="uploadedBy" label="提交方"><Input /></Form.Item>
      </Form>
    </Modal>
  </section>
}

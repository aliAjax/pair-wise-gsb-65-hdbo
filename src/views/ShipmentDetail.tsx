import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Alert, Badge, Button, Card, Descriptions, Divider, Form, Input, Modal, Select, Space, Table, Tabs, Tag, message } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { TemperatureChart } from '../components/TemperatureChart'
import { ReleasePanel } from '../components/ReleasePanel'
import { FailureDrillButton } from '../components/PendingSubmitBar'
import { useShipmentStore } from '../store/useShipmentStore'
import type { EvidenceCategory, EvidenceFile } from '../types'

const CATEGORIES: EvidenceCategory[] = ['温度曲线', '设备报告', '包装确认', '交接签字']

export function ShipmentDetail() {
  const { id } = useParams()
  const state = useShipmentStore()
  const shipment = state.shipments.find((item) => item.id === id)
  const [activeSegmentId, setActiveSegmentId] = useState(shipment?.segments[0]?.id ?? '')
  const [signOpen, setSignOpen] = useState(false)
  const [deviationOpen, setDeviationOpen] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [releaseOpen, setReleaseOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  /** 打开弹窗时记录的版本基准，用于乐观并发校验 */
  const [baseVersion, setBaseVersion] = useState(0)
  const [signForm] = Form.useForm()
  const [deviationForm] = Form.useForm()
  const [uploadForm] = Form.useForm()
  const [releaseForm] = Form.useForm()

  if (!shipment) return <section className="page empty">未找到运输任务</section>
  const activeSegment = shipment.segments.find((item) => item.id === activeSegmentId) ?? shipment.segments[0]
  const deviations = state.deviations.filter((item) => item.shipmentId === shipment.id)
  const openDeviations = deviations.filter((item) => item.status !== '已关闭')
  const currentRelease = state.releases.find((item) => item.shipmentId === shipment.id)
  const unverified = shipment.evidence.filter((item) => !item.verified)

  const evidenceColumns = [
    {
      title: '文件 / 分类', dataIndex: 'name',
      render: (value: string, row: EvidenceFile) => <div>
        <strong>{value}</strong>
        <small className="cell-sub">{row.category} · V{row.version}{row.supersedes ? ' · 替代上一版' : ''}</small>
        {row.changeNote && <small className="cell-sub change-note">版本说明：{row.changeNote}</small>}
      </div>
    },
    { title: '上传', render: (_: unknown, row: EvidenceFile) => `${row.uploadedBy} ${row.uploadedAt.replace('T', ' ').slice(0, 16)}` },
    {
      title: '核验状态', dataIndex: 'verified', width: 150,
      render: (value: boolean, row: EvidenceFile) => value
        ? <div><Tag color="success">已核验 V{row.version}</Tag><small className="cell-sub">{row.verifiedBy}<br />{row.verifiedAt.replace('T', ' ').slice(0, 16)}</small></div>
        : <Button size="small" loading={submitting} onClick={async () => {
          setSubmitting(true)
          const result = await state.verifyEvidence(shipment.id, row.id)
          setSubmitting(false)
          result.ok ? message.success(result.message) : message.error(result.message)
        }}>标记核验</Button>
    }
  ]

  const sign = async () => {
    const values = await signForm.validateFields()
    const result = state.sign(shipment.id, values.role, values.comment ?? '', values.decision)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) setSignOpen(false)
  }
  const createDeviation = async () => {
    const values = await deviationForm.validateFields()
    state.createDeviation(shipment.id, values.segmentId, values.title, values.severity)
    setDeviationOpen(false)
    message.success('已创建偏差；若此前已有放行，该放行已失效')
  }
  const upload = async () => {
    const values = await uploadForm.validateFields()
    setSubmitting(true)
    const result = await state.addEvidence(shipment.id, {
      name: values.name, category: values.category, uploadedBy: values.uploadedBy || '货站补充', changeNote: values.changeNote
    })
    setSubmitting(false)
    if (result.ok) {
      message.success(result.message)
      setUploadOpen(false)
      uploadForm.resetFields()
    } else message.error(result.message)
  }
  const openReleaseModal = () => {
    setBaseVersion(shipment.version)
    releaseForm.setFieldsValue({
      reviewer: '放行人员 顾言',
      note: currentRelease?.state === '失效' ? `原放行${currentRelease.id}已失效，依据最新核验证据重新复核：` : '',
      decision: '批准放行'
    })
    setReleaseOpen(true)
  }
  const release = async () => {
    const values = await releaseForm.validateFields()
    if (shipment.version !== baseVersion) {
      message.warning(`任务版本已从V${baseVersion}前进到V${shipment.version}，请刷新依据后再提交；您填写的内容保留在表单中。`)
      return
    }
    setSubmitting(true)
    const result = await state.submitRelease(shipment.id, values, baseVersion)
    setSubmitting(false)
    if (result.ok) {
      message.success(result.message)
      setReleaseOpen(false)
    } else if (result.persisted === false) {
      message.error('落盘失败，已加入页面顶部的待重试队列，可按原提交重试')
    } else if (result.conflict) {
      message.error(result.message)
      setBaseVersion(result.currentVersion ?? shipment.version)
    } else {
      message.error(result.message)
    }
  }

  return <section className="page">
    <header className="page-head detail-head">
      <div><p>{shipment.id} · {shipment.batch}</p><h1>{shipment.product}</h1></div>
      <Space>
        <FailureDrillButton />
        <Button onClick={() => setDeviationOpen(true)}>登记偏差</Button>
        <Button onClick={() => setSignOpen(true)}>角色签收</Button>
        <Button type="primary" onClick={openReleaseModal}>放行审核</Button>
      </Space>
    </header>
    {openDeviations.length > 0 && <Alert style={{ marginBottom: 12 }} type="error" showIcon message={`存在${openDeviations.length}项未关闭温度偏差，系统阻止放行`} />}
    {currentRelease?.state === '失效' && <Alert style={{ marginBottom: 12 }} type="warning" showIcon
      message={`放行${currentRelease.id}已失效，任务回到复核；历史依据仍可在下方记录链中查阅`} />}
    {currentRelease?.state === '有效' && shipment.status === '已放行' && <Alert style={{ marginBottom: 12 }} type="success" showIcon
      message={`当前依据 ${currentRelease.evidenceBasis.map((item) => `${item.category}V${item.version}`).join('、')} 放行；货站若补送同类别新版材料，本结论将自动失效`} />}
    <Descriptions className="summary-band" size="small" column={5} items={[
      { key: 'route', label: '运输路线', children: shipment.route },
      { key: 'box', label: '温控箱', children: shipment.containerId },
      { key: 'range', label: '允许范围', children: `${shipment.tempMin} - ${shipment.tempMax} ℃` },
      { key: 'version', label: '任务版本', children: `V${shipment.version}（弹窗打开时基准V${baseVersion || shipment.version}）` },
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
    <div className="release-inline"><ReleasePanel shipmentId={shipment.id} onRelease={openReleaseModal} /></div>
    <Tabs className="detail-tabs" items={[
      {
        key: 'evidence', label: `证据版本 (${shipment.evidence.length})`,
        children: <div>
          <div className="tab-actions">
            <Space>
              <Button icon={<UploadOutlined />} onClick={() => { uploadForm.resetFields(); uploadForm.setFieldsValue({ category: '包装确认', uploadedBy: '货站补充' }); setUploadOpen(true) }}>补送新材料</Button>
              <span>同类别材料自动递增版本；放行仅采纳最新且已核验版</span>
            </Space>
            {unverified.length > 0 && <Tag color="warning">{unverified.length}份待核验，不能放行</Tag>}
          </div>
          <Table rowKey="id" size="small" columns={evidenceColumns} dataSource={shipment.evidence} pagination={false} />
        </div>
      },
      { key: 'signatures', label: `签收记录 (${shipment.signatures.filter((item) => item.status === '已签').length}/${shipment.signatures.length})`, children: <div className="signature-grid">{shipment.signatures.map((item) => <Card key={item.role} size="small"><div className="signature-head"><strong>{item.role}</strong><Tag color={item.status === '已签' ? 'success' : item.status === '已退回' ? 'error' : 'default'}>{item.status}</Tag></div><p>{item.name}</p><small>{item.signedAt ? item.signedAt.replace('T', ' ').slice(0, 16) : '尚未签署'}</small><Divider /><span>{item.comment || '暂无意见'}</span></Card>)}</div> },
      { key: 'deviations', label: `偏差 (${deviations.length})`, children: <Table rowKey="id" size="small" pagination={false} dataSource={deviations} columns={[
        { title: '编号', dataIndex: 'id' },
        { title: '标题', dataIndex: 'title' },
        { title: '状态', dataIndex: 'status', render: (value: string) => <Tag color={value === '已关闭' ? 'success' : 'processing'}>{value}</Tag> },
        { title: '调查版本', dataIndex: 'version', render: (value: number) => `V${value}` }
      ]} /> }
    ]} />

    <Modal title="多角色签收" open={signOpen} onCancel={() => setSignOpen(false)} onOk={sign} okText="提交签收">
      <Form form={signForm} layout="vertical" initialValues={{ role: '放行人员', decision: '已签' }}>
        <Form.Item name="role" label="签收角色" rules={[{ required: true }]}><Select options={shipment.signatures.map((item) => ({ label: item.role, value: item.role }))} /></Form.Item>
        <Form.Item name="decision" label="签收决定" rules={[{ required: true }]}><Select options={[{ label: '签署确认', value: '已签' }, { label: '退回补充', value: '已退回' }]} /></Form.Item>
        <Form.Item name="comment" label="签收意见"><Input.TextArea rows={3} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="登记温度偏差" open={deviationOpen} onCancel={() => setDeviationOpen(false)} onOk={createDeviation} okText="创建偏差">
      <Form form={deviationForm} layout="vertical" initialValues={{ segmentId: activeSegment.id, severity: '一般' }}>
        <Form.Item name="segmentId" label="发生航段" rules={[{ required: true }]}><Select options={shipment.segments.map((item) => ({ label: `${item.from} → ${item.to}`, value: item.id }))} /></Form.Item>
        <Form.Item name="title" label="偏差描述" rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
        <Form.Item name="severity" label="严重度" rules={[{ required: true }]}><Select options={['一般', '重大'].map((value) => ({ label: value, value }))} /></Form.Item>
      </Form>
    </Modal>
    <Modal title="货站补送证据（新版本）" open={uploadOpen} onCancel={() => setUploadOpen(false)} onOk={upload} okText="登记新版本" confirmLoading={submitting}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }} message="若该任务已有有效放行，同类别新版证据登记后放行结论立即失效并回到复核（历史依据保留）。新版默认未核验，不参与下一次放行。" />
      <Form form={uploadForm} layout="vertical">
        <Form.Item name="category" label="材料类别" rules={[{ required: true }]}><Select options={CATEGORIES.map((value) => ({ label: value, value }))} /></Form.Item>
        <Form.Item name="name" label="文件名称" rules={[{ required: true }]}><Input placeholder="如 RKN-44018补充温度记录-货站终版.csv" /></Form.Item>
        <Form.Item name="uploadedBy" label="送来方"><Input placeholder="货站 / 航司 / 代理" /></Form.Item>
        <Form.Item name="changeNote" label="与上一版的差异" rules={[{ required: true, message: '必须说明新版差异，便于追查' }]}><Input.TextArea rows={3} placeholder="如 新增CDG货站地面等待段12个温度点；原读数保持不变" /></Form.Item>
      </Form>
    </Modal>
    <Modal
      title={<Space>放行审核 <Tag color="blue">任务基准 V{baseVersion}</Tag>{shipment.version !== baseVersion && <Tag color="error">当前已 V{shipment.version}</Tag>}</Space>}
      open={releaseOpen} width={680}
      onCancel={() => setReleaseOpen(false)} onOk={release} okText="提交放行结论" confirmLoading={submitting}
    >
      <Alert
        type={shipment.version !== baseVersion ? 'warning' : 'info'} showIcon style={{ marginBottom: 12 }}
        message={shipment.version !== baseVersion
          ? `任务版本在您填写期间已从V${baseVersion}前进到V${shipment.version}（另一位复核员可能已提交）。直接提交将收到冲突提示且表单内容保留；请先核对最新证据/调查后再提交。`
          : `提交即固定当前依据：任务V${shipment.version}、各类别最新核验证据、已关闭偏差的调查版本。`}
        action={<Button size="small" onClick={() => { state.simulateConcurrentSubmit({ kind: 'shipment', id: shipment.id }); message.info('已模拟另一工位复核员先行提交：任务版本+1') }}>模拟另一复核员同时提交</Button>}
      />
      <Descriptions size="small" column={1} bordered items={[
        { key: 'e', label: '将固定的证据版本', children: shipment.evidence.filter((item) => item.verified)
          .slice()
          .sort((a, b) => a.category.localeCompare(b.category) || b.version - a.version)
          .filter((item, index, arr) => arr.findIndex((x) => x.category === item.category) === index)
          .map((item) => <Tag key={item.id} color="cyan">{item.category} V{item.version}</Tag>) },
        { key: 'd', label: '将固定的偏差调查版本', children: deviations.filter((item) => item.status === '已关闭').length
          ? deviations.filter((item) => item.status === '已关闭').map((item) => <Tag key={item.id} color="purple">{item.id} 调查V{item.version}</Tag>)
          : <small className="muted">无已关闭偏差</small> },
        { key: 'block', label: '放行拦截项', children: openDeviations.length
          ? <Tag color="error">{openDeviations.length}项偏差未关闭</Tag>
          : unverified.length ? <Tag color="error">{unverified.length}份证据未核验</Tag>
            : <Tag color="success">无</Tag> }
      ]} />
      <div style={{ height: 12 }} />
      <Form form={releaseForm} layout="vertical">
        <Form.Item name="decision" label="放行结论" rules={[{ required: true }]}><Select options={[{ label: '批准放行', value: '批准放行' }, { label: '拒绝放行', value: '拒绝放行' } as const]} /></Form.Item>
        <Form.Item name="reviewer" label="复核员" rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="note" label="复核意见（将随版本依据一起固定）" rules={[{ required: true, message: '必须填写复核意见' }]}><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
  </section>
}

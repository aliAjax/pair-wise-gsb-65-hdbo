import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, Timeline, message } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'

export function DeviationWorkbench() {
  const state = useShipmentStore()
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const selected = state.deviations.find((item) => item.id === selectedId) ?? state.deviations[0]
  const [form] = Form.useForm()
  const [reviewForm] = Form.useForm()
  const [reopenForm] = Form.useForm()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)

  useEffect(() => { if (selected) form.setFieldsValue(selected) }, [selected, form])
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.id) }, [selectedId, selected])

  const readOnly = selected?.status === '已关闭'
  const save = async () => {
    const values = await form.validateFields()
    const result = state.saveInvestigation(selected.id, values)
    result.ok ? message.success(result.message) : message.error(result.message)
  }
  const review = async () => {
    const values = await reviewForm.validateFields()
    const result = state.reviewDeviation(selected.id, values.disposition, values.reviewNote)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) setReviewOpen(false)
  }
  const reopen = async () => {
    const values = await reopenForm.validateFields()
    const result = state.reopenDeviation(selected.id, values.reason)
    result.ok ? message.success(result.message) : message.error(result.message)
    if (result.ok) {
      setReopenOpen(false)
      reopenForm.resetFields()
    }
  }

  if (!selected) return <section className="page"><Empty description="暂无偏差" /></section>
  return <section className="page">
    <header className="page-head"><div><p>温度超限 / 原因调查 / 放行复核 / 重新打开</p><h1>温度偏差调查</h1></div><Badge count={state.deviations.filter((item) => item.status !== '已关闭').length} showZero /></header>
    <div className="deviation-layout">
      <div className="deviation-nav">{state.deviations.map((item) => <button key={item.id} className={item.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><div><Badge status={item.severity === '重大' ? 'error' : 'warning'} /><strong>{item.title}</strong></div><span>{item.id}</span><small>{item.shipmentId} · 调查V{item.version}{item.reopenReason ? ' · 曾重开' : ''}</small><Tag color={item.status === '已关闭' ? 'success' : 'processing'}>{item.status}</Tag></button>)}</div>
      <div className="deviation-main">
        <div className="panel-title">
          <div><h2>{selected.title}</h2><span>{selected.id} · {selected.source} · 当前调查V{selected.version}</span></div>
          <Space>
            {readOnly
              ? <Button danger onClick={() => setReopenOpen(true)}>重新打开偏差</Button>
              : <>
                <Button onClick={() => { reviewForm.setFieldsValue({ disposition: selected.disposition, reviewNote: '' }); setReviewOpen(true) }} disabled={selected.status !== '待放行复核'}>放行复核</Button>
                <Button type="primary" onClick={save}>保存并提交</Button>
              </>}
          </Space>
        </div>
        {readOnly && <Alert
          style={{ marginBottom: 12 }}
          type="success" showIcon
          message={`调查V${selected.version}已关闭（${selected.disposition}），复核人：${selected.reviewer}`}
          description="重新打开后当前调查内容与历次复核结论原样保留，仅版本号前进；已依据本结论生效的放行将失效并回到复核。"
        />}
        {selected.reopenReason && <Alert
          style={{ marginBottom: 12 }}
          type="warning" showIcon
          message={`曾于 ${selected.reopenedAt?.replace('T', ' ').slice(0, 16)} 重新打开`}
          description={`原因：${selected.reopenReason}`}
        />}
        <Descriptions size="small" column={4} items={[
          { key: 'shipment', label: '运输任务', children: selected.shipmentId },
          { key: 'segment', label: '航段', children: selected.segmentId },
          { key: 'owner', label: '调查负责人', children: selected.owner },
          { key: 'due', label: '截止日期', children: selected.dueDate }
        ]} />
        <Form form={form} layout="vertical" className="deviation-form">
          <div className="two-column">
            <Form.Item name="cause" label="原因调查" rules={[{ required: true, message: '必须记录设备、操作、转运或环境因素' }]}><Input.TextArea rows={5} disabled={readOnly} /></Form.Item>
            <Form.Item name="assessment" label="影响评估" rules={[{ required: true, message: '必须评估超限时间与货物稳定性' }]}><Input.TextArea rows={5} disabled={readOnly} /></Form.Item>
          </div>
          <div className="two-column">
            <Form.Item name="disposition" label="建议处置" rules={[{ required: true }]}><Select disabled={readOnly} options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="evidence" label="证据摘要" rules={[{ required: true }]}><Input disabled={readOnly} /></Form.Item>
          </div>
          <Form.Item name="correctiveAction" label="纠正措施或收货条件" rules={[{ required: true }]}><Input.TextArea rows={3} disabled={readOnly} /></Form.Item>
        </Form>
        <Tabs items={[
          {
            key: 'point', label: '原始时间点',
            children: <div className="raw-points"><strong>温度点只读</strong><p>航段原始记录已关联至任务，任何调查修订不得覆盖设备原始曲线。</p><code>{state.shipments.find((item) => item.id === selected.shipmentId)?.segments.find((item) => item.id === selected.segmentId)?.temperature.slice(0, 6).map((item) => `${item.time.slice(11, 16)} ${item.value}℃`).join('  |  ')}</code></div>
          },
          {
            key: 'review', label: `复核记录 (${1 + (selected.reviewHistory?.length ?? 0)})`,
            children: <Timeline items={[
              { color: 'green', children: <Card size="small"><strong>当前版本 V{selected.version} · {selected.disposition}</strong><p>{selected.reviewNote || '尚未复核'}</p><small>{selected.reviewer}{selected.closedAt ? ` · ${selected.closedAt.replace('T', ' ').slice(0, 16)}` : ''}</small></Card> },
              ...(selected.reviewHistory ?? []).slice().reverse().map((item) => ({
                color: 'gray' as const,
                children: <Card size="small" style={{ background: '#fafafa' }}>
                  <strong>历史版本 V{item.version} · {item.disposition}（已保留）</strong>
                  <p>{item.reviewNote}</p>
                  <small>{item.reviewer} · {item.closedAt.replace('T', ' ').slice(0, 16)}</small>
                </Card>
              }))
            ]} />
          }
        ]} />
      </div>
    </div>
    <Modal title={`放行复核 · ${selected.id} V${selected.version}`} open={reviewOpen} onCancel={() => setReviewOpen(false)} onOk={review} okText="确认复核">
      <Form form={reviewForm} layout="vertical">
        <Form.Item name="disposition" label="复核结论" rules={[{ required: true }]}><Select options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
        <Form.Item name="reviewNote" label="复核意见" rules={[{ required: true, message: '复核必须填写意见' }]}><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>
    <Modal title={`重新打开偏差 · ${selected.id}`} open={reopenOpen} onCancel={() => setReopenOpen(false)} onOk={reopen} okText="确认重新打开">
      <p style={{ color: '#a35', marginBottom: 10 }}>调查内容与已完成复核不会丢失或重新生成；若放行结论正在生效，将立即失效并回到复核。</p>
      <Form form={reopenForm} layout="vertical">
        <Form.Item name="reason" label="重新打开原因" rules={[{ required: true, message: '必须填写重新打开原因' }]}><Input.TextArea rows={4} placeholder="例如：货站补充设备报告显示超限时长需重新评估" /></Form.Item>
      </Form>
    </Modal>
  </section>
}

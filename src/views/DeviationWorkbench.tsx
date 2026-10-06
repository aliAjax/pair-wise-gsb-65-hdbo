import { useEffect, useState } from 'react'
import { Alert, Badge, Button, Card, Descriptions, Empty, Form, Input, Modal, Select, Space, Tabs, Tag, Timeline, message } from 'antd'
import { FailureDrillButton } from '../components/PendingSubmitBar'
import { useShipmentStore } from '../store/useShipmentStore'
import type { Deviation } from '../types'

export function DeviationWorkbench() {
  const state = useShipmentStore()
  const [selectedId, setSelectedId] = useState(state.deviations[0]?.id ?? '')
  const selected = state.deviations.find((item) => item.id === selectedId) ?? state.deviations[0]
  const [form] = Form.useForm()
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reopenOpen, setReopenOpen] = useState(false)
  const [baseVersion, setBaseVersion] = useState(0)
  const [reviewBaseVersion, setReviewBaseVersion] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reopenForm] = Form.useForm()

  useEffect(() => {
    if (!selected) return
    // 复核弹窗打开时保留用户已填意见；其余字段可安全同步
    if (reviewOpen) {
      const draft = form.getFieldsValue()
      form.setFieldsValue({ ...selected, disposition: draft.disposition ?? selected.disposition, reviewNote: draft.reviewNote ?? selected.reviewNote })
    } else {
      form.setFieldsValue(selected)
    }
    setBaseVersion(selected.version)
  }, [selected, form, reviewOpen])
  useEffect(() => { if (!selectedId && selected) setSelectedId(selected.id) }, [selectedId, selected])

  if (!selected) return <section className="page"><Empty description="暂无偏差" /></section>

  const save = async () => {
    const values = await form.validateFields()
    if (selected.version !== baseVersion) {
      message.warning(`调查版本已从V${baseVersion}前进到V${selected.version}（另一位调查员可能已保存）。您填写的内容保留，请核对后再提交。`)
      return
    }
    setBusy(true)
    const result = await state.saveInvestigation(selected.id, values, baseVersion)
    setBusy(false)
    if (result.ok) {
      message.success(result.message)
      setBaseVersion(selected.version)
    } else if (result.persisted === false) {
      message.error('落盘失败，已加入待重试队列，可按原提交重试')
    } else if (result.conflict) {
      message.error(result.message)
      setBaseVersion(result.currentVersion ?? selected.version)
    } else message.error(result.message)
  }

  const openReview = () => {
    setReviewBaseVersion(selected.version)
    form.setFieldsValue({ disposition: selected.disposition, reviewNote: selected.reviewNote })
    setReviewOpen(true)
  }
  const review = async () => {
    const values = await form.validateFields()
    if (selected.version !== reviewBaseVersion) {
      message.warning(`调查版本已从V${reviewBaseVersion}前进到V${selected.version}，请按最新调查版本复核；表单内容保留。`)
      return
    }
    setBusy(true)
    const result = await state.reviewDeviation(selected.id, values.disposition, values.reviewNote, reviewBaseVersion)
    setBusy(false)
    if (result.ok) {
      message.success(result.message)
      setReviewOpen(false)
    } else if (result.persisted === false) {
      message.error('落盘失败，已加入待重试队列，可按原提交重试')
    } else if (result.conflict) {
      message.error(result.message)
      setReviewBaseVersion(result.currentVersion ?? selected.version)
    } else message.error(result.message)
  }

  const reopen = async () => {
    const values = await reopenForm.validateFields()
    setBusy(true)
    const result = await state.reopenDeviation(selected.id, values.reason)
    setBusy(false)
    if (result.ok) {
      message.success(result.message)
      setReopenOpen(false)
      reopenForm.resetFields()
    } else if (result.persisted === false) {
      message.error('落盘失败，已加入待重试队列，可按原提交重试')
    } else message.error(result.message)
  }

  const syncBaseVersion = () => {
    setBaseVersion(selected.version)
    form.setFieldsValue(selected)
  }

  const versionAdvanced = baseVersion !== 0 && selected.version !== baseVersion

  return <section className="page">
    <header className="page-head">
      <div><p>温度超限 / 原因调查 / 放行复核 / 重新打开</p><h1>温度偏差调查</h1></div>
      <Space><FailureDrillButton /><Badge count={state.deviations.filter((item) => item.status !== '已关闭').length} showZero /></Space>
    </header>
    <div className="deviation-layout">
      <div className="deviation-nav">{state.deviations.map((item) => <button key={item.id} className={item.id === selected.id ? 'active' : ''} onClick={() => setSelectedId(item.id)}><div><Badge status={item.severity === '重大' ? 'error' : 'warning'} /><strong>{item.title}</strong></div><span>{item.id}</span><small>{item.shipmentId} · 调查V{item.version}</small><Tag color={item.status === '已关闭' ? 'success' : 'processing'}>{item.status}</Tag></button>)}</div>
      <div className="deviation-main">
        <div className="panel-title">
          <div>
            <h2>{selected.title} <Tag color="blue">当前调查V{selected.version}</Tag>{baseVersion !== 0 && versionAdvanced && <Tag color="error">您打开时是V{baseVersion}</Tag>}</h2>
            <span>{selected.id} · {selected.source}</span>
          </div>
          <Space>
            {selected.status === '已关闭'
              ? <Button danger onClick={() => { reopenForm.resetFields(); setReopenOpen(true) }}>重新打开偏差</Button>
              : <Button onClick={openReview} disabled={selected.status !== '待放行复核'}>放行复核</Button>}
            <Button type="primary" onClick={save} loading={busy} disabled={selected.status === '已关闭'}>保存并提交</Button>
          </Space>
        </div>
        {versionAdvanced && <Alert
          type="warning" showIcon style={{ marginBottom: 12 }}
          message={`调查版本在您编辑期间已前进（V${baseVersion} → V${selected.version}），另一位调查员的提交先生效。您已填写的内容仍保留在表单中。`}
          action={<Button size="small" onClick={syncBaseVersion}>以最新版覆盖表单并继续</Button>}
        />}
        {selected.status === '已关闭' && <Alert
          type="success" showIcon style={{ marginBottom: 12 }}
          message={`偏差已按调查V${selected.version}关闭并参与放行；如重新打开，引用该调查版本的放行结论将失效并回到复核。`}
        />}
        <Descriptions size="small" column={4} items={[
          { key: 'shipment', label: '运输任务', children: selected.shipmentId },
          { key: 'segment', label: '航段', children: selected.segmentId },
          { key: 'owner', label: '调查负责人', children: selected.owner },
          { key: 'due', label: '截止日期', children: selected.dueDate }
        ]} />
        <Form form={form} layout="vertical" className="deviation-form">
          <div className="two-column">
            <Form.Item name="cause" label="原因调查" rules={[{ required: true, message: '必须记录设备、操作、转运或环境因素' }]}><Input.TextArea rows={5} disabled={selected.status === '已关闭'} /></Form.Item>
            <Form.Item name="assessment" label="影响评估" rules={[{ required: true, message: '必须评估超限时间与货物稳定性' }]}><Input.TextArea rows={5} disabled={selected.status === '已关闭'} /></Form.Item>
          </div>
          <div className="two-column">
            <Form.Item name="disposition" label="建议处置" rules={[{ required: true }]}><Select disabled={selected.status === '已关闭'} options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="evidence" label="证据摘要" rules={[{ required: true }]}><Input disabled={selected.status === '已关闭'} /></Form.Item>
          </div>
          <Form.Item name="correctiveAction" label="纠正措施或收货条件" rules={[{ required: true }]}><Input.TextArea rows={3} disabled={selected.status === '已关闭'} /></Form.Item>
        </Form>
        <Tabs items={[
          {
            key: 'point', label: '原始时间点',
            children: <div className="raw-points"><strong>温度点只读</strong><p>航段原始记录已关联至任务，任何调查修订不得覆盖设备原始曲线。</p><code>{state.shipments.find((item) => item.id === selected.shipmentId)?.segments.find((item) => item.id === selected.segmentId)?.temperature.slice(0, 6).map((item) => `${item.time.slice(11, 16)} ${item.value}℃`).join('  |  ')}</code></div>
          },
          {
            key: 'history', label: `调查版本历史 (${selected.history.length})`,
            children: <Timeline className="deviation-history" items={selected.history.slice().reverse().map((entry) => ({
              color: entry.action.includes('重新打开') ? 'red' : entry.action.includes('并发') ? 'orange' : 'blue',
              children: <Card size="small">
                <Space wrap><Tag color="blue">V{entry.version}</Tag><b>{entry.action}</b><small className="muted">{entry.operator} · {entry.at.replace('T', ' ').slice(0, 16)}</small></Space>
                {entry.cause && <p className="history-field"><b>原因：</b>{entry.cause}</p>}
                {entry.assessment && <p className="history-field"><b>评估：</b>{entry.assessment}</p>}
                {entry.reviewNote && <p className="history-field"><b>复核意见：</b>{entry.reviewNote}（{entry.reviewer}）</p>}
              </Card>
            }))} />
          },
          {
            key: 'review', label: '复核记录',
            children: selected.reviewer
              ? <Card size="small"><Space><strong>{selected.reviewer}</strong><Tag>依据调查V{selected.version}</Tag></Space><p>{selected.reviewNote}</p></Card>
              : <Empty description="尚未复核" />
          }
        ]} />
      </div>
    </div>

    <Modal
      title={<Space>放行复核 <Tag color="purple">调查基准 V{reviewBaseVersion}</Tag>{selected.version !== reviewBaseVersion && <Tag color="error">当前V{selected.version}</Tag>}</Space>}
      open={reviewOpen} onCancel={() => setReviewOpen(false)} onOk={review} okText="确认复核" confirmLoading={busy}
    >
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="关闭偏差会固定当前调查版本；该版本随后被放行结论引用。偏差重开将使引用它的放行失效。"
        action={<Button size="small" onClick={() => { state.simulateConcurrentSubmit({ kind: 'deviation', id: selected.id }); message.info('已模拟另一工位同时提交：调查版本+1') }}>模拟两人同时提交</Button>} />
      <Form form={form} layout="vertical">
        <Form.Item name="disposition" label="复核结论" rules={[{ required: true }]}><Select options={['接受', '补充处理', '拒绝'].map((value) => ({ label: value, value }))} /></Form.Item>
        <Form.Item name="note-readonly" label={<span>调查版本</span>}><Input value={`V${reviewBaseVersion}（${selected.version !== reviewBaseVersion ? `已前进到V${selected.version}` : '未变化'}）`} readOnly /></Form.Item>
        <Form.Item name="reviewNote" label="复核意见" rules={[{ required: true, message: '复核必须填写意见' }]}><Input.TextArea rows={4} /></Form.Item>
      </Form>
    </Modal>

    <Modal title="重新打开偏差" open={reopenOpen} onCancel={() => setReopenOpen(false)} onOk={reopen} okText="确认重新打开" confirmLoading={busy}>
      <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="重新打开会生成新调查版本，并使任务当前有效放行结论失效、回到复核；历史放行依据仍可查。" />
      <Form form={reopenForm} layout="vertical">
        <Form.Item name="reopen-operator" label="操作人"><Input defaultValue="温控质量组" disabled /></Form.Item>
        <Form.Item name="reason" label="重新打开原因" rules={[{ required: true, message: '必须填写重新打开原因' }]}><Input.TextArea rows={4} placeholder="如 货站补送设备报告显示制冷机在航段中停机14分钟，原关闭依据不充分" /></Form.Item>
      </Form>
    </Modal>
  </section>
}

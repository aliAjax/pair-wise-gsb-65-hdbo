import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Descriptions, Divider, Form, Input, Modal, Radio, Tag, message } from 'antd'
import { useShipmentStore, latestEvidence } from '../store/useShipmentStore'
import type { ReleaseSubmitResult, Shipment } from '../types'

const CATEGORIES = ['温度曲线', '设备报告', '包装确认', '交接签字'] as const
const newRequestId = () => `REL-REQ-${Date.now()}-${Math.floor(Math.random() * 1e4)}`

interface Props {
  shipment: Shipment
  open: boolean
  onClose: () => void
}

/**
 * 放行复核弹窗：
 * - 打开时记录任务版本（expectedVersion）与 requestId；
 * - 提交时冻结“最新核验版证据 + 已关闭偏差调查版本”；
 * - 版本冲突：弹窗与已填内容保留，提示任务版本已前进，可刷新依据后用同一 requestId 继续；
 * - 落盘失败：任何写入都未发生，可用同一 requestId 原样重试。
 */
export function ReleaseModal({ shipment, open, onClose }: Props) {
  const submitRelease = useShipmentStore((state) => state.submitRelease)
  const deviations = useShipmentStore((state) => state.deviations.filter((item) => item.shipmentId === shipment.id))
  const [form] = Form.useForm()
  const [requestId, setRequestId] = useState(newRequestId())
  const [expectedVersion, setExpectedVersion] = useState(shipment.version)
  const [conflict, setConflict] = useState<{ currentVersion: number; message: string } | null>(null)
  const [persistFailed, setPersistFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setRequestId(newRequestId())
      setExpectedVersion(shipment.version)
      setConflict(null)
      setPersistFailed(false)
      form.setFieldsValue({ reviewer: '放行人员 顾言', decision: '放行', note: '', simulatePersistFailure: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const closedDeviations = deviations.filter((item) => item.status === '已关闭')
  const openDeviations = deviations.filter((item) => item.status !== '已关闭')
  const basisCheck = useMemo(() => CATEGORIES.map((category) => {
    const latest = latestEvidence(shipment, category)
    return { category, latest, ready: Boolean(latest && latest.verified && !latest.stale) }
  }), [shipment])
  const unsigned = shipment.signatures.filter((item) => item.role !== '放行人员' && item.status !== '已签')
  const versionAdvanced = shipment.version !== expectedVersion

  const submit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    const result: ReleaseSubmitResult = submitRelease({
      shipmentId: shipment.id,
      reviewer: values.reviewer,
      decision: values.decision,
      note: values.note ?? '',
      expectedVersion,
      requestId,
      simulatePersistFailure: values.simulatePersistFailure
    })
    setSubmitting(false)
    if (result.ok) {
      message.success(result.duplicate ? '该提交此前已落盘，返回原放行结论（未重复生成）' : '放行结论已落盘并冻结依据版本')
      onClose()
      return
    }
    if (result.code === 'VERSION_CONFLICT') {
      setConflict({ currentVersion: result.currentVersion, message: result.message })
      return
    }
    if (result.code === 'PERSIST_FAILED') {
      setPersistFailed(true)
      message.error(result.message)
      return
    }
    message.error(result.message)
  }

  return <Modal
    title={`放行复核 · ${shipment.id}`}
    open={open}
    onCancel={onClose}
    width={760}
    footer={[
      <Button key="cancel" onClick={onClose}>取消</Button>,
      <Button key="submit" type="primary" loading={submitting} onClick={submit}>
        {persistFailed ? '按原提交重试' : conflict ? '基于最新版本重新提交' : '提交放行结论'}
      </Button>
    ]}
  >
    <Descriptions size="small" column={3} bordered items={[
      { key: 'v', label: '打开时任务版本', children: <span>V{expectedVersion}{versionAdvanced && <Tag color="error" style={{ marginLeft: 8 }}>当前已前进至V{shipment.version}</Tag>}</span> },
      { key: 'req', label: '提交编号', children: <code style={{ fontSize: 11 }}>{requestId}</code> },
      { key: 'rule', label: '冻结规则', children: '同类材料只取最新核验版' }
    ]} />

    {conflict && <Alert
      style={{ marginTop: 12 }}
      type="warning"
      showIcon
      message="并发冲突：另一位复核员的提交已经先行落盘"
      description={<div>
        <p style={{ marginBottom: 6 }}>{conflict.message}</p>
        <Button size="small" onClick={() => { setExpectedVersion(shipment.version); setConflict(null) }}>我已核对最新依据，版本基准更新为V{shipment.version}（已填意见保留）</Button>
      </div>}
    />}
    {persistFailed && <Alert
      style={{ marginTop: 12 }}
      type="error"
      showIcon
      message="落盘失败：核验与调查记录未重新生成"
      description="本次提交未写入任何数据。请取消“模拟落盘失败”后点击“按原提交重试”，系统凭同一提交编号识别，不会重复生成结论或依据记录。"
    />}

    <Divider orientation="left" style={{ fontSize: 13 }}>本次将冻结的证据依据（按分类取最新版）</Divider>
    <Descriptions size="small" column={1} bordered items={basisCheck.map(({ category, latest, ready }) => ({
      key: category,
      label: category,
      children: latest
        ? <span>{latest.name} <Tag color={ready ? 'success' : 'warning'}>V{latest.version}{ready ? ' · 已核验' : latest.stale ? ' · 已被取代' : ' · 待核验'}</Tag>{latest.verifiedBy && <small style={{ color: '#8c989a' }}> 核验人：{latest.verifiedBy}</small>}</span>
        : <Tag color="error">缺该类材料</Tag>
    }))} />

    <Divider orientation="left" style={{ fontSize: 13 }}>偏差调查版本依据</Divider>
    {closedDeviations.length === 0 && openDeviations.length === 0
      ? <small style={{ color: '#8c989a' }}>本任务无温度偏差</small>
      : <div style={{ display: 'grid', gap: 6 }}>
        {closedDeviations.map((item) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{item.title}<small className="cell-sub">{item.id}</small></span>
          <span><Tag color="success">V{item.version} · {item.disposition} · 已关闭</Tag><small>{item.reviewer}</small></span>
        </div>)}
        {openDeviations.map((item) => <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{item.title}<small className="cell-sub">{item.id}</small></span>
          <Tag color="error">V{item.version} · {item.status}（拦截放行）</Tag>
        </div>)}
      </div>}
    {unsigned.length > 0 && <Alert style={{ marginTop: 10 }} type="error" showIcon message={`签收未完成：${unsigned.map((item) => item.role).join('、')}`} />}

    <Divider orientation="left" style={{ fontSize: 13 }}>复核结论</Divider>
    <Form form={form} layout="vertical">
      <Form.Item name="decision" label="结论" rules={[{ required: true }]}><Radio.Group options={[{ label: '放行', value: '放行' }, { label: '拒绝', value: '拒绝' }]} /></Form.Item>
      <Form.Item name="reviewer" label="复核员" rules={[{ required: true, message: '请填写复核员' }]}><Input /></Form.Item>
      <Form.Item name="note" label="复核意见" rules={[{ required: true, message: '复核必须填写意见' }]}><Input.TextArea rows={3} placeholder="结论将与证据版本、偏差调查版本一并冻结，供日后追查" /></Form.Item>
      <Form.Item name="simulatePersistFailure" valuePropName="checked"><Checkbox>模拟落盘失败（演示断网/写入故障后的原提交重试）</Checkbox></Form.Item>
    </Form>
  </Modal>
}

import { Alert, Button, Popconfirm, Space, Tag, message } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import { armNextWriteFailure, isWriteFailureArmed } from '../services/storage'
import { useEffect, useState } from 'react'

export function PendingSubmitBar() {
  const pendingSubmits = useShipmentStore((state) => state.pendingSubmits)
  const retrySubmit = useShipmentStore((state) => state.retrySubmit)
  const dismissPending = useShipmentStore((state) => state.dismissPending)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  if (pendingSubmits.length === 0) return null
  const retry = async (submitId: string) => {
    setRetryingId(submitId)
    const result = await retrySubmit(submitId)
    setRetryingId(null)
    if (result.ok) message.success(`重试成功：${result.message}`)
    else if (!result.conflict) message.error(result.message)
  }
  return <div className="pending-bar">
    {pendingSubmits.map((item) => <Alert
      key={item.submitId}
      type="warning" showIcon
      message={<Space wrap>
        <b>落盘失败：{item.label}</b>
        <Tag>提交号 {item.submitId.slice(-8)}</Tag>
        <span className="pending-meta">{item.at.replace('T', ' ').slice(0, 19)} 发起 · {item.shipmentId}</span>
        <Button size="small" type="primary" loading={retryingId === item.submitId} onClick={() => retry(item.submitId)}>按原提交重试</Button>
        <Popconfirm title="放弃该提交？已填写内容不会保留在服务端记录中" onConfirm={() => dismissPending(item.submitId)}>
          <Button size="small" type="text">移出队列</Button>
        </Popconfirm>
      </Space>}
      description="同一提交号重试为幂等操作：此前若已有核验或调查记录落盘，不会重复生成。"
    />)}
  </div>
}

export function FailureDrillButton() {
  const [armed, setArmed] = useState(isWriteFailureArmed())
  useEffect(() => {
    const timer = window.setInterval(() => setArmed(isWriteFailureArmed()), 700)
    return () => window.clearInterval(timer)
  }, [])
  return <Button
    size="small"
    type={armed ? 'primary' : 'default'}
    danger={armed}
    onClick={() => { armNextWriteFailure(); setArmed(true) }}
    title="开启后，下一次核验/调查/放行提交会模拟落盘失败，用于验证按原提交重试"
  >
    {armed ? '故障已注入：下一笔提交将落盘失败' : '演练：模拟下一笔落盘失败'}
  </Button>
}

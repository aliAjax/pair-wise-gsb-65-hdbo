import { Alert, Button, Empty, Space, Tag, Timeline, Tooltip } from 'antd'
import { useShipmentStore } from '../store/useShipmentStore'
import type { ReleaseRecord } from '../types'

interface Props {
  shipmentId: string
  onRelease: () => void
}

export function ReleasePanel({ shipmentId, onRelease }: Props) {
  const releases = useShipmentStore((state) => state.releases.filter((item) => item.shipmentId === shipmentId))
  const current = releases[0]
  return <div className="release-panel">
    <div className="panel-title">
      <div><h2>放行结论与依据版本</h2><span>同类材料仅最新核验版参与放行；放行时固定证据版本与偏差调查版本</span></div>
      <Button type="primary" onClick={onRelease}>{current?.state === '有效' && current.decision === '批准放行' ? '复核后重新放行' : '放行审核'}</Button>
    </div>
    {current?.state === '有效' && <Alert
      type={current.decision === '批准放行' ? 'success' : 'error'}
      showIcon
      message={<Space wrap>
        <b>{current.decision}</b>
        <Tag color={current.decision === '批准放行' ? 'success' : 'error'}>{current.id}</Tag>
        <span>{current.reviewer} · {current.releasedAt.replace('T', ' ').slice(0, 16)}</span>
        <span className="basis-version">依据任务 V{current.shipmentVersion}</span>
      </Space>}
      description={current.note}
    />}
    {current?.state === '失效' && <Alert
      type="warning" showIcon
      message={<Space wrap>
        <b>放行结论已失效，任务回到复核</b>
        <Tag color="warning">{current.id}</Tag>
        <span>{current.invalidated?.at.replace('T', ' ').slice(0, 16)} · {current.invalidated?.by}</span>
      </Space>}
      description={current.invalidated?.reason}
    />}
    {!current && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无放行结论，完成证据核验与偏差关闭后提交" />}
    <div className="release-history">
      <div className="release-history-title">放行记录链（历史依据可追溯，不覆盖）</div>
      {releases.length === 0 && <small className="muted">暂无记录</small>}
      <Timeline items={releases.map((record) => ({
        color: record.state === '失效' ? 'gray' : record.decision === '批准放行' ? 'green' : 'red',
        children: <ReleaseRecordCard record={record} />
      }))} />
    </div>
  </div>
}

function ReleaseRecordCard({ record }: { record: ReleaseRecord }) {
  return <div className="release-card">
    <div className="release-card-head">
      <Space wrap>
        <b>{record.decision}</b>
        <Tag>{record.id}</Tag>
        <Tag color={record.state === '有效' ? 'success' : 'default'}>{record.state}</Tag>
        <small className="muted">{record.reviewer} · {record.releasedAt.replace('T', ' ').slice(0, 16)}</small>
      </Space>
    </div>
    <p>{record.note}</p>
    <div className="basis-grid">
      <div>
        <div className="basis-label">放行依据 · 证据版本（{record.evidenceBasis.length}类）</div>
        {record.evidenceBasis.map((item) => <div key={item.category} className="basis-row">
          <Tag color="cyan">{item.category} V{item.version}</Tag>
          <Tooltip title={`核验：${item.verifiedBy} ${item.verifiedAt.replace('T', ' ').slice(0, 16)}`}>
            <span>{item.evidenceName}</span>
          </Tooltip>
        </div>)}
      </div>
      <div>
        <div className="basis-label">放行依据 · 偏差调查版本（{record.deviationBasis.length}项）</div>
        {record.deviationBasis.length === 0 && <small className="muted">放行时无已关闭偏差</small>}
        {record.deviationBasis.map((item) => <div key={item.deviationId} className="basis-row">
          <Tag color="purple">调查 V{item.version}</Tag>
          <span>{item.deviationId} · {item.title}（{item.disposition}，{item.reviewer}）</span>
        </div>)}
      </div>
    </div>
    {record.invalidated && <div className="invalidated-box">
      失效原因：{record.invalidated.reason}
      <small>由 {record.invalidated.by} 触发 · {record.invalidated.at.replace('T', ' ').slice(0, 16)}</small>
    </div>}
  </div>
}

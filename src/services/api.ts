import axios from 'axios'
import type { ReleaseRecord, Shipment } from '../types'

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 5000 })

export async function loadShipmentSnapshot(fallback: Shipment[]): Promise<Shipment[]> {
  if (!import.meta.env.VITE_API_BASE_URL) return fallback
  try { return (await client.get<Shipment[]>('/shipments')).data } catch { return fallback }
}

/**
 * 放行提交（后端对接位）。前端演示由 store 内的幂等 persist 层模拟：
 * 真实后端应以 submitId 做去重键，同一 submitId 重试只生效一次。
 */
export async function requestRelease(
  shipmentId: string,
  payload: { submitId: string; baseVersion: number; note: string; decision: ReleaseRecord['decision'] }
) {
  if (!import.meta.env.VITE_API_BASE_URL) return { accepted: true, requestId: payload.submitId }
  return (await client.post(`/shipments/${shipmentId}/release`, payload)).data
}

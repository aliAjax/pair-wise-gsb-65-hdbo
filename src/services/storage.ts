/**
 * 模拟后端落盘。前端演示默认成功；可通过故障开关让下一次写入失败，
 * 用于验证「落盘失败后按原提交重试」的幂等行为。
 */

const FAIL_FLAG = 'gsb65:fail-next-write'

export function armNextWriteFailure(label = '已模拟一次落盘失败') {
  localStorage.setItem(FAIL_FLAG, label)
}

export function clearWriteFailure() {
  localStorage.removeItem(FAIL_FLAG)
}

export function isWriteFailureArmed() {
  return Boolean(localStorage.getItem(FAIL_FLAG))
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 提交一笔写入。submitId 相同的请求视为同一笔提交：
 * 后端记录已处理的 submitId，重试直接返回首次结果，不重复执行副作用。
 */
const processed = new Map<string, { result: unknown }>()

export async function persist<T>(submitId: string, label: string, apply: () => T): Promise<T> {
  await delay(450)
  const done = processed.get(submitId)
  if (done) {
    // 同一提交重试：不再执行 apply，核验/调查/放行记录不会重复生成
    return done.result as T
  }
  if (localStorage.getItem(FAIL_FLAG)) {
    localStorage.removeItem(FAIL_FLAG)
    throw new Error(`网络异常：${label}未落盘，请按原提交重试`)
  }
  const result = apply()
  processed.set(submitId, { result })
  return result
}

export function resetProcessedSubmits() {
  processed.clear()
}

export type AppState = {
  status: string
  tunnelAvailable?: boolean
  connectedAt?: number
  // Saved before node groups, this can still be a single-source profile.
  profile?: unknown
  lastError?: string
}
declare global {
  interface Window {
    webkit?: {
      messageHandlers: {
        oneday: { postMessage(message: unknown): Promise<unknown> }
      }
    }
  }
}

export async function callNative<T>(
  method: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const bridge = window.webkit?.messageHandlers.oneday
  if (!bridge) {
    if (method === 'getState') return { status: 'disconnected' } as T
    throw new Error('请在 iPhone 上安装并打开「有朝」以使用此功能。')
  }
  return (await bridge.postMessage({ method, args })) as T
}

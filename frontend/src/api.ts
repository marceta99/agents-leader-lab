export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// Same-origin fetch wrapper. Cookie auth, JSON in/out. Throws ApiError with the backend's `detail`.
export async function api<T = unknown>(
  path: string,
  opts: { method?: string; json?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.json === undefined ? 'GET' : 'POST'),
    credentials: 'include',
    headers: opts.json === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: opts.json === undefined ? undefined : JSON.stringify(opts.json),
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${path}`
}

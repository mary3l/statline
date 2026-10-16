export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

export function withQuery(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/** JSON fetch against the same-origin /api (proxied to the backend in development). */
export async function api<T>(path: string, init: { method?: string; body?: unknown; query?: Query } = {}): Promise<T> {
  const res = await fetch(withQuery(`/api${path}`, init.query), {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // Non-JSON (e.g. the proxy's own error page when the API is down).
  }
  if (!res.ok) {
    const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const message =
      typeof body.message === 'string'
        ? body.message
        : res.status >= 500 && data === undefined
          ? // The dev proxy (and most gateways) answer with an empty 5xx when the API is down.
            'Cannot reach the STATLINE server. Is the backend running?'
          : `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, body);
  }
  return data as T;
}

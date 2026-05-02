import { authStore } from './auth';
import { demoStore } from './demo';

const BASE = '/api';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const pin = authStore.getPin();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (pin) headers.Authorization = `Bearer ${pin}`;
  if (demoStore.isActive()) headers['X-Demo-Mode'] = 'true';
  if (init.body && !(init.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, { ...init, headers });
  if (res.status === 401) {
    authStore.logout();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Unauthorized');
  }
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { /* ignore */ }
    const msg = (body as { message?: string })?.message ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  if (res.status === 204) return undefined as T;
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return res.json() as Promise<T>;
  return undefined as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  postForm: <T>(path: string, form: FormData) =>
    request<T>(path, { method: 'POST', body: form }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

export async function verifyPin(pin: string): Promise<boolean> {
  const res = await fetch(`${BASE}/budgets`, {
    headers: { Authorization: `Bearer ${pin}` },
  });
  return res.ok;
}

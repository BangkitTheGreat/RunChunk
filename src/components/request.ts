/** Browser-side API call: JSON in/out, error keys from the server surface as Error messages. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (response.status === 401) {
    window.location.assign('/login');
    throw new Error('errors.unauthorized');
  }
  if (!response.ok) {
    const errorKey = typeof data.error === 'string' ? data.error : 'errors.server';
    throw new Error(errorKey);
  }
  return data as T;
}

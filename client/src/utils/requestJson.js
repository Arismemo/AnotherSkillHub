// 会话过期或被登出：回到登录页，登录后再回到当前地址
export function redirectToLogin() {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

// 所有请求都带同站标记头：服务端据此挡住跨站伪造的写请求（server/auth.js 的 csrfOk）。
// 401 默认跳去登录；登录表单这类「401 就是答案」的调用传 { onUnauthorized: null }。
export async function requestJson(url, options = {}, { onUnauthorized = redirectToLogin } = {}) {
  const headers = new Headers(options.headers);
  headers.set('X-ASH-Request', '1');
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查后端服务是否启动。');
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && onUnauthorized) onUnauthorized();
    const error = new Error(payload?.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  if (payload === null) throw new Error('服务器返回了无效响应，请重试。');
  return payload;
}

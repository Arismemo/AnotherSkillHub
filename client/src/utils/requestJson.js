export async function requestJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error instanceof TypeError) throw new Error('网络连接失败，请检查后端服务是否启动。');
    throw error;
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error || `请求失败（${response.status}）`);
    error.status = response.status;
    throw error;
  }
  if (payload === null) throw new Error('服务器返回了无效响应，请重试。');
  return payload;
}

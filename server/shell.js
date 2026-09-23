// 生成 bash 脚本时的转义工具：任何来自请求或数据库的值都只能以单引号字面量进入脚本。
function shQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

// 请求头拼出来的服务地址也可能被伪造，只允许普通 URL 字符
function getBaseUrl(req) {
  const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
  const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
  const safeHost = /^[A-Za-z0-9.:[\]-]+$/.test(host) ? host : 'localhost';
  const safeProto = proto === 'https' ? 'https' : 'http';
  return `${safeProto}://${safeHost}`;
}

module.exports = { shQuote, getBaseUrl };

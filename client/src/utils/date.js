const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });

// SQLite CURRENT_TIMESTAMP 是不带时区的 UTC（"2026-09-23 08:00:00"），直接 new Date 会被当成本地时间
export function parseTimestamp(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`);
  }
  return new Date(value);
}

export function formatShortDate(value) {
  if (!value) return '';
  return shortDateFormatter.format(parseTimestamp(value));
}

export function formatDateTime(value) {
  if (!value) return '';
  const date = parseTimestamp(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '';
}

export function relativeTime(value, now = Date.now()) {
  const stamp = parseTimestamp(value).getTime();
  if (!Number.isFinite(stamp)) return '';
  const minutes = Math.round((now - stamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return fullDateFormatter.format(stamp);
}

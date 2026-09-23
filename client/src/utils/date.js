const shortDateFormatter = new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' });
const fullDateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' });

export function formatShortDate(value) {
  if (!value) return '';
  return shortDateFormatter.format(new Date(value));
}

export function relativeTime(value, now = Date.now()) {
  const stamp = new Date(value).getTime();
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

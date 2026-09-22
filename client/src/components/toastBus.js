// 轻量 Toast 事件派发（与组件分离，保证 fast-refresh 纯净）
export function showToast(message, options = {}) {
  window.dispatchEvent(new CustomEvent('ash:toast', {
    detail: {
      message,
      actionLabel: options.actionLabel,
      onAction: options.onAction,
      duration: options.duration,
    },
  }));
}

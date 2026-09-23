import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

// 轻量 Toast + 撤销（Linear/Raycast 式）：操作后右下角浮条，可带撤销按钮
let toastCounter = 0;

export default function ToastContainer() {
  // timers 用模块外闭包不合适（多实例），改为 Map + effect 清理
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    const timers = new Map();
    const onShow = (event) => {
      const { message, actionLabel, onAction, duration = 5000 } = event.detail || {};
      const id = `toast-${++toastCounter}`;
      setToasts((prev) => [...prev.slice(-2), { id, message, actionLabel, onAction }]);
      timers.set(id, window.setTimeout(() => {
        timers.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration));
    };
    window.addEventListener('ash:toast', onShow);
    return () => {
      window.removeEventListener('ash:toast', onShow);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast-item">
          <span>{toast.message}</span>
          {toast.actionLabel && (
            <button
              type="button"
              onClick={() => {
                toast.onAction?.();
                dismiss(toast.id);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => dismiss(toast.id)}><X size={14} aria-hidden="true" /></button>
        </div>
      ))}
    </div>
  );
}

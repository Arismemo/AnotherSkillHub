import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

// 轻量 Toast + 撤销（Linear/Raycast 式）：操作后右下角浮条，可带撤销按钮
let toastCounter = 0;

// 带「撤销」的提示给足思考时间：批量移动 20 个后常要先去目标目录看一眼才决定撤不撤
const PLAIN_DURATION = 5000;
const ACTION_DURATION = 10000;

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const arm = useCallback((id, duration) => {
    const existing = timersRef.current.get(id);
    if (existing) window.clearTimeout(existing);
    timersRef.current.set(id, window.setTimeout(() => {
      timersRef.current.delete(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration));
  }, []);

  // hover 时暂停倒计时：正在读的提示不该在眼皮底下消失
  const pause = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    const onShow = (event) => {
      const { message, actionLabel, onAction, duration } = event.detail || {};
      const id = `toast-${++toastCounter}`;
      const life = duration || (actionLabel ? ACTION_DURATION : PLAIN_DURATION);
      setToasts((prev) => [...prev.slice(-2), { id, message, actionLabel, onAction, duration: life }]);
      arm(id, life);
    };
    window.addEventListener('ash:toast', onShow);
    return () => {
      window.removeEventListener('ash:toast', onShow);
      timers.forEach((t) => window.clearTimeout(t));
      timers.clear();
    };
  }, [arm]);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="toast-item"
          onMouseEnter={() => pause(toast.id)}
          onMouseLeave={() => arm(toast.id, toast.duration)}
        >
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

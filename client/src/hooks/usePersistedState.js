import { useEffect, useState } from 'react';

export default function usePersistedState(key, initial, isValid = () => true) {
  const [value, setValue] = useState(() => {
    try {
      const saved = window.localStorage.getItem(`ash:${key}`);
      if (saved === null) return initial;
      const parsed = JSON.parse(saved);
      return isValid(parsed) ? parsed : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(`ash:${key}`, JSON.stringify(value));
    } catch { /* 存储不可用则静默降级为内存态 */ }
  }, [key, value]);
  return [value, setValue];
}

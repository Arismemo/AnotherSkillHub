import { useEffect, useState } from 'react';

// 连续输入只让最后一次值进入查询，计时器随值或延迟变化重置。
export default function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

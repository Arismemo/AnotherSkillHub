import { useLayoutEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

const choices = ['system', 'light', 'dark'];
const labels = { system: '跟随系统', light: '浅色', dark: '深色' };
const icons = { system: Monitor, light: Sun, dark: Moon };
const storageKey = 'ash-theme';

export default function ThemeToggle({ compact = false }) {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return choices.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });

  useLayoutEffect(() => {
    const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      document.documentElement.dataset.theme = theme === 'system'
        ? (systemDark.matches ? 'dark' : 'light')
        : theme;
    };
    applyTheme();
    systemDark.addEventListener('change', applyTheme);
    return () => systemDark.removeEventListener('change', applyTheme);
  }, [theme]);

  const nextTheme = choices[(choices.indexOf(theme) + 1) % choices.length];
  const Icon = icons[theme];
  const description = `外观：${labels[theme]}；点击切换为${labels[nextTheme]}`;

  const cycleTheme = () => {
    setTheme(nextTheme);
    try {
      window.localStorage.setItem(storageKey, nextTheme);
    } catch {
      // 存储被浏览器禁用时，本次会话仍可切换。
    }
  };

  return (
    <button
      type="button"
      className={`nav-item${compact ? ' rail-item' : ''}`}
      onClick={cycleTheme}
      aria-label={description}
      title={description}
    >
      <Icon size={16} aria-hidden="true" />
      {!compact && <span>外观：{labels[theme]}</span>}
    </button>
  );
}

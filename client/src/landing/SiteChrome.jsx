// landing 与文档页共用的品牌、顶栏和页脚
import { ArrowRight, Terminal } from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle';

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true"><Terminal size={16} /></span>
      <span>AnotherSkillHub</span>
    </span>
  );
}

// nav：[{ href, label, current? }]
export function SiteHeader({ user, registration, nav = [] }) {
  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <a href="/" aria-label="AnotherSkillHub 首页"><Brand /></a>
        <nav className="site-nav" aria-label="站点导航">
          {nav.map((item) => (
            <a key={item.href} href={item.href} aria-current={item.current ? 'page' : undefined}>{item.label}</a>
          ))}
        </nav>
        <div className="site-actions">
          <span className="theme-slot"><ThemeToggle compact /></span>
          {user ? (
            <a className="btn btn-primary" href="/app">进入应用<ArrowRight size={14} aria-hidden="true" /></a>
          ) : (
            <>
              <a className="btn btn-ghost" href="/login">登录</a>
              {registration !== 'closed' && <a className="btn btn-primary" href="/register">注册</a>}
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-inner">
        <Brand />
        <span>
          MIT License · <a href="https://github.com/Arismemo/AnotherSkillHub" target="_blank" rel="noreferrer">GitHub</a>
          {' · '}<a href="/docs">文档</a>{' · '}<a href="/agent.md">Agent 指南</a>
        </span>
      </div>
    </footer>
  );
}

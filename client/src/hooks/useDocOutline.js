import { useEffect, useRef, useState } from 'react';

// 悬浮大纲的视口阈值：与 index.css 的 .doc-outline 收窄断点保持一致
const OUTLINE_MIN_VIEWPORT = '(min-width: 1280px)';

export const HEADING_SELECTOR = '.markdown-document h1, .markdown-document h2, .markdown-document h3, .markdown-document h4';

/**
 * 详情页悬浮大纲：显隐偏好（localStorage）、视口宽度判定、scroll-spy 高亮、点击跳转。
 * renderedMarkdown / auxRendered / selectedFile / mode 只作为「内容变了，重量标题位置」的触发器。
 * 须在 SkillDetail 给标题补 id 的 effect 之后调用，保持原有 effect 顺序。
 */
export default function useDocOutline({ scrollRef, headings, mode, renderedMarkdown, auxRendered, selectedFile }) {
  // D1: 大纲显隐持久化
  const [outlineHidden, setOutlineHidden] = useState(() => {
    try { return window.localStorage.getItem('ash:outline-hidden') === '1'; }
    catch { return false; }
  });
  // 大纲按「视口宽度」判定，而不是滚动区宽度：滚动区永远是视口减去左两栏，
  // 用它做阈值会让大纲在 1684px 以下的视口里永远不出现。
  const [outlineFits, setOutlineFits] = useState(() => window.matchMedia(OUTLINE_MIN_VIEWPORT).matches);
  // B1: 大纲当前高亮索引
  const [activeHeading, setActiveHeading] = useState(0);

  useEffect(() => {
    const query = window.matchMedia(OUTLINE_MIN_VIEWPORT);
    const sync = () => setOutlineFits(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem('ash:outline-hidden', outlineHidden ? '1' : '0'); }
    catch { /* 存储不可用时仍可在当前会话切换大纲 */ }
  }, [outlineHidden]);

  // B1: 大纲跟随滚动高亮（scroll-spy）
  // 原实现每帧 querySelectorAll + 逐标题 getBoundingClientRect——每次滚动都强制同步布局。
  // 改成：标题位置只在内容/尺寸变化时量一次，滚动中只比 scrollTop，零 rect 读取。
  const headingOffsetsRef = useRef([]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container || headings.length < 2) return undefined;

    const measure = () => {
      const containerTop = container.getBoundingClientRect().top;
      headingOffsetsRef.current = [...container.querySelectorAll(HEADING_SELECTOR)]
        .map((node) => node.getBoundingClientRect().top - containerTop + container.scrollTop);
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        const offsets = headingOffsetsRef.current;
        if (!offsets.length) return;
        const line = container.scrollTop + 60;
        let current = 0;
        for (let i = 0; i < offsets.length; i += 1) {
          if (offsets[i] <= line) current = i;
        }
        // 滚动到底时高亮最后一个标题（末尾内容不足一屏时永远差一点）
        if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
          current = offsets.length - 1;
        }
        setActiveHeading(current);
      });
    };

    measure();
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    // 字体/图片加载或面板改宽都会挪动标题：重量一次，仍然不碰滚动路径
    const content = container.querySelector('.detail-content');
    const observer = content && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => { measure(); onScroll(); })
      : null;
    if (observer && content) observer.observe(content);
    return () => {
      container.removeEventListener('scroll', onScroll);
      observer?.disconnect();
    };
  }, [scrollRef, headings.length, renderedMarkdown, auxRendered, selectedFile, mode]);

  const jumpToHeading = (index) => {
    const container = scrollRef.current;
    if (!container) return;
    const nodes = container.querySelectorAll(HEADING_SELECTOR);
    const target = nodes[index];
    if (!target) return;
    // offsetTop 的参照系是 offsetParent（.app-detail），不是滚动容器；
    // 用 rect 相对差值计算真实滚动位置
    const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
    // 末尾标题补位：确保即使内容不足也能把标题滚到视口上部
    const needed = container.scrollTop + delta - 12;
    const maxScroll = container.scrollHeight - container.clientHeight;
    if (needed > maxScroll) {
      // 动态撑高底部 padding，让最后标题可达
      const content = container.querySelector('.detail-content');
      if (content) {
        const extra = needed - maxScroll;
        content.style.paddingBottom = `${Math.round(extra + 3 * 16)}px`;
        window.requestAnimationFrame(() => container.scrollTo({ top: needed, behavior: 'smooth' }));
        return;
      }
    }
    container.scrollTo({ top: container.scrollTop + delta - 12, behavior: 'smooth' });
  };

  // 预览模式 + 视口够宽 + 至少两个标题才有大纲；hidden 时只留一个「显示大纲」按钮
  const visible = mode === 'preview' && outlineFits && headings.length > 1;

  return { visible, hidden: outlineHidden, setHidden: setOutlineHidden, activeHeading, jumpToHeading };
}

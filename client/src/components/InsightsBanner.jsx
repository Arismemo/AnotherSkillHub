import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { requestJson } from '../utils/requestJson';
import './Usage.css';

const percent = (value) => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

// 「需关注」视图顶部的闭环指标：健康信号（常失败、从未使用……）只有在 Agent 真的回报时才可信，
// 所以先把「用了多少次、回报了多少次」摆出来。反馈率低时告诉用户怎么补：在 Claude Code 机器上装 hook
export default function InsightsBanner() {
  const [insights, setInsights] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    requestJson('/api/skills/insights', { signal: controller.signal })
      .then(setInsights)
      .catch(() => null); // 指标只是辅助信息：取不到就不显示，不打扰列表本身
    return () => controller.abort();
  }, []);

  if (!insights || (!insights.uses && !insights.feedback)) return null;
  const silent = insights.silent_terminals || [];

  return (
    <section className={`insights-banner${insights.low_feedback ? ' is-low' : ''}`} aria-label="使用与反馈概况">
      <p>
        <Activity size={14} aria-hidden="true" />
        <span>
          近 {insights.days} 天：使用 <strong>{insights.uses}</strong> 次 · 反馈 <strong>{insights.feedback}</strong> 次 · 反馈率 <strong>{percent(insights.feedback_rate)}</strong>
        </span>
      </p>
      {insights.low_feedback ? (
        <p className="insights-hint">
          反馈太少，下面的「常失败」「从未使用」可能不准。在跑 Claude Code 的机器上运行 <code>ash hooks install</code>，会话结束时会自动提醒 Agent 回报。
        </p>
      ) : silent.length > 0 && (
        <p className="insights-hint">从没回报过的机器：{silent.join('、')}（在上面运行 <code>ash hooks install</code>）</p>
      )}
    </section>
  );
}

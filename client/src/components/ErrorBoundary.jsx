import { Component } from 'react';

export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('页面渲染失败', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <main role="alert" style={{ maxWidth: 480, margin: '15vh auto', padding: 24, textAlign: 'center' }}>
        <h1>页面暂时无法显示</h1>
        <p>加载时发生错误，请重试。如果问题持续，请刷新页面。</p>
        <button type="button" onClick={() => this.setState({ hasError: false })}>重试</button>
        <button type="button" onClick={() => window.location.reload()} style={{ marginLeft: 12 }}>刷新页面</button>
      </main>
    );
  }
}

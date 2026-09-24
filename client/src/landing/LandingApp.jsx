// 公开入口：/ 是介绍页，/docs 是文档，/login 与 /register 是账号表单。服务端对这些路径都返回同一个 index.html，
// 这里按 pathname 选页面（页面间用普通链接跳转，不引入路由库）。
import { useEffect, useState } from 'react';
import { requestJson } from '../utils/requestJson';
import AuthPage from './AuthPage';
import Docs from './Docs';
import Landing from './Landing';

export default function LandingApp() {
  const [user, setUser] = useState(null);
  const [registration, setRegistration] = useState('open');
  const path = window.location.pathname;

  useEffect(() => {
    // 已登录时介绍页的主按钮变成「进入应用」；401 在这里是正常答案，不跳转
    requestJson('/api/auth/me', {}, { onUnauthorized: null }).then(({ user: me }) => setUser(me)).catch(() => null);
    requestJson('/api/auth/config', {}, { onUnauthorized: null }).then((config) => setRegistration(config.registration)).catch(() => null);
  }, []);

  if (path === '/login') return <AuthPage mode="login" registration={registration} />;
  if (path === '/register') return <AuthPage mode="register" registration={registration} />;
  if (path === '/docs') return <Docs user={user} registration={registration} />;
  return <Landing user={user} registration={registration} />;
}

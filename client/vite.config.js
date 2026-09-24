import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const backend = `http://127.0.0.1:${process.env.API_PORT || 9444}`

// 两个入口：index.html 是公开的 landing（含 /login、/register），app.html 是登录后的应用（/app）。
// 生产环境由 express 按路径分发（server/index.js）；开发服务器这里做同样的改写。
function pageRoutes() {
  return {
    name: 'ash-page-routes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const [pathname, query = ''] = req.url.split('?');
        const search = query ? `?${query}` : '';
        if (pathname === '/app' || pathname.startsWith('/app/')) req.url = `/app.html${search}`;
        else if (['/login', '/register', '/docs'].includes(pathname)) req.url = `/index.html${search}`;
        next();
      });
    },
  }
}

export default defineConfig({
  plugins: [react(), pageRoutes()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, 'index.html'),
        app: resolve(import.meta.dirname, 'app.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': backend,
      // 前缀匹配：写成 '/s' 会把 /src/*.jsx 也转给后端，只代理 /s/ 下的技能短链
      '^/s/': backend,
      '/healthz': backend,
      '/setup.sh': backend,
      '/cli.sh': backend,
      '/agent.md': backend,
      '/llms.txt': backend,
    },
  },
})

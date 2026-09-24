# AnotherSkillHub 部署手册（seed-SER9 / Docker）

单容器部署：Mac 本地构建源码 → scp 到服务器 → 服务器 docker build → compose 切镜像 tag 滚动更新。
全程约 1–2 分钟；数据库在宿主机卷，容器重建不丢数据。

## 环境

| 项 | 值 |
|---|---|
| 服务器 | seed-SER9，`ssh 100.112.81.111`（用户 liukun，Ubuntu） |
| 容器 | `ash`（compose 项目 `skillhub-app`，实际以 `-p ash` 管理） |
| 数据卷 | `/home/liukun/services/skillhub-app/data`（SQLite + skills_files） |
| 发布目录 | `/home/liukun/services/skillhub-releases/<sha>/`（每个版本一个目录，含源码和 compose.deploy.yml） |
| 公网入口 | https://ash.709970.xyz（反向 SSH 隧道 38084→9444，公网网关 Nginx 反代，独立于本流程） |
| 端口 | 容器 9444，仅绑服务器 127.0.0.1 |

## 标准部署流程（五步）

在本地仓库（`/Users/liukun/workspace/AnotherSkillHub-dev`，分支与 main 同点）执行：

### 1. 本地全绿门禁

```bash
cd client
npm run build        # vite + tailwind 构建
npm run lint         # oxlint（存量 warning 可接受，error 必须为 0）
npm run test:ui      # 前端回归测试
cd ..
node --test server/tests/*.test.js   # 服务端测试
```

> UI 改动另需本地起服务过一遍真实浏览器（`PORT=19444 node server/index.js` + ego-browser 验证），不再赘述。

### 2. 提交并推送

```bash
git add -A
git commit -m "<type>: <描述>"
SHA=$(git rev-parse --short HEAD)
git push origin HEAD:refs/heads/main
```

### 3. 备份数据库（必做，防迁移/坏数据）

```bash
ssh 100.112.81.111 "docker exec ash node -e 'const D=require(\"better-sqlite3\"); new D(\"/app/data/another-skillhub.db\").backup(\"/app/data/backup-before-$SHA.db\").then(()=>console.log(\"backup ok\"))'"
```

技能文件也一起备份（多用户迁移、认领旧数据会搬动目录）：

```bash
ssh 100.112.81.111 "cd /home/liukun/services/skillhub-app/data && tar -czf backup-files-before-$SHA.tgz skills_files"
```

备份文件留在数据卷内（`backup-before-<sha>.db`、`backup-files-before-<sha>.tgz`），可按需清理旧备份。

### 4. 传输源码 → 服务器构建镜像

```bash
git archive --format=tar HEAD -o /tmp/ash-$SHA.tar
scp /tmp/ash-$SHA.tar 100.112.81.111:/home/liukun/services/ash-$SHA.tar
ssh 100.112.81.111 "
  mkdir -p /home/liukun/services/skillhub-releases/$SHA &&
  tar -xf /home/liukun/services/ash-$SHA.tar -C /home/liukun/services/skillhub-releases/$SHA &&
  cd /home/liukun/services/skillhub-releases/$SHA &&
  rm -rf data &&                       # 归档误带运行数据时剔除（data 已 gitignore，正常不会带）
  docker build -t ash:$SHA .           # 失败重跑一次（服务器偶发网络抖动 npm install 失败）
"
```

### 5. 切镜像滚动更新 + 核验

```bash
ssh 100.112.81.111 "
  cd /home/liukun/services/skillhub-releases/$SHA &&
  sed \"s#ash:<旧版本>#ash:$SHA#\" /home/liukun/services/skillhub-releases/<旧版本>/compose.deploy.yml > compose.deploy.yml &&
  docker compose -p ash -f compose.deploy.yml up -d --no-build &&
  docker inspect ash --format '{{.Config.Image}} {{.State.Status}}'
"
```

线上冒烟（本地即可；除 landing、/setup.sh、/agent.md 外都要 token，`ash login` 后从 ~/.ash/token 取）：

```bash
AUTH="Authorization: Bearer $(cat ~/.ash/token)"
curl -s -o /dev/null -w '%{http_code}\n' https://ash.709970.xyz/api/skills   # 未带 token 应为 401
curl -s -H "$AUTH" "https://ash.709970.xyz/api/skills?folder=all" | python3 -c "import json,sys; print('skills:', len(json.load(sys.stdin)))"
curl -s -H "$AUTH" https://ash.709970.xyz/s/ego-browser.md | head -3   # Agent 协议
# 浏览器强刷（⌘⇧R）验证 UI；DB 结构变化时确认老库自动迁移（CREATE IF NOT EXISTS / 轻量 ALTER）
```

## 一次性：上线多用户鉴权（feat/auth-landing）

这个版本起所有接口都要登录。老库启动时自动迁移，但旧数据**没有主人，任何账号都看不到**，要由管理员认领。按顺序做：

1. 照常执行第 1–4 步。第 3 步的 DB 备份和 `skills_files` 备份都不能省。
2. 第 5 步生成 `compose.deploy.yml` 之后、`up -d` 之前，先在 `environment` 里加一行 `- ASH_REGISTRATION=closed`，避免认领前有陌生人注册。
3. `up -d` 之后，认领旧数据（会交互读取密码）：
   ```bash
   docker exec -it ash npm run user:create -- liukun --admin --claim-legacy
   # 输出应为：✅ 已认领旧数据：N 个技能（搬移 N 个目录）、…
   ```
4. 浏览器打开 https://ash.709970.xyz ：先看到 landing，登录后进入 `/app`，技能都在。
5. 每台接入的机器执行一次 `ash update && ash login`，否则 Agent 会报「尚未登录」。
6. 如果需要开放注册：把 `compose.deploy.yml` 里这一行改成 `open`，再执行一次 `up -d --no-build`。

回滚到鉴权之前的版本时，**数据也要一起回滚**：旧代码不认识迁移后的表结构。停容器后用 `backup-before-<sha>.db` 覆盖数据库，并把 `backup-files-before-<sha>.tgz` 解压回 `skills_files`。

公网网关的 Nginx 需要传 `X-Forwarded-For` 和 `X-Forwarded-Proto`。否则登录限流会把所有人算作同一个 IP，cookie 也拿不到 `Secure` 标记。

## 回滚

```bash
ssh 100.112.81.111 "
  cd /home/liukun/services/skillhub-releases/<好版本> &&
  docker compose -p ash -f compose.deploy.yml up -d --no-build
"
# 数据如需回滚：停容器后用数据卷内的 backup-before-<sha>.db 覆盖 another-skillhub.db
```

历史镜像均保留在服务器（`docker images ash`），旧版本目录不删。

## 本地开发环境

```bash
cd AnotherSkillHub-dev
npm install && (cd client && npm install)
PORT=19444 node server/index.js          # http://127.0.0.1:19444
```

- 本地数据：`AnotherSkillHub-dev/data/`（gitignored，与生产独立）
- 主仓 `/Users/liukun/workspace/AnotherSkillHub`（main）+ 开发 worktree `AnotherSkillHub-dev`（feat/ui-polish，与 main 同点）

## 注意事项

1. **顺序铁律**：门禁 → commit → push → 备份 → 构建 → 上线。跳备份的 schema 变更 = 裸奔。
2. **compose 版本链**：每次只 `sed` 替换 image tag，其余字段不动；compose 文件跟随版本目录，天然留档。
3. **首次网络抖动**：服务器 `docker build` 的 `npm install` 偶发失败，重跑即全 CACHED。
4. **数据不入库**：`data/` 已 gitignore；`git archive` 若带出务必 `rm -rf data` 再 build。
5. **隧道/域名**属独立基础设施（skillhub-tunnel.service + 公网网关），容器重启不受影响；如公网 502 先查隧道服务再查容器。

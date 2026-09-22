---
name: internal-service-deploy
description: 基于 seed-SER9 和反向 SSH 隧道快速发布 HTTPS 公网服务
tags: [devops, tunnel, nginx, ssh]
version: 2.0.0
---

# 内网服务公网穿透与部署

## 拓扑
`seed-SER9 (内网)` --SSH Tunnel--> `公网网关 (117.72.155.136)` --Nginx HTTPS--> `709970.xyz`

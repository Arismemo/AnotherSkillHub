---
name: stpc-planning-migrate
description: 将 stpc_planning 算法适配至 Voyager 双 ThorX 架构指南
tags: [planning, stpc, thorx]
version: 1.0.1
---

# STPC Planning 迁移与适配指南

## 架构要点
- 双 ThorX 架构下，STPC 作为主规划器运行在 ADU Thor A
- 通过共享内存接收 Perception 输出的目标列表与预测轨迹

---
name: voyager-worldsim
description: 嬴彻科技 Voyager 平台十字路口左右转及高速仿真运行与自验规范
tags: [voyager, simulation, worldsim, planning]
version: 1.2.0
---

# Voyager Worldsim 仿真调试指南

## 核心说明
本技能用于在开发或仿真机（如 4090）上跑通 Voyager worldsim 最小集闭环。

### 1. 常用启动命令
```bash
# 最小集仿真启动
./scripts/run_worldsim_minimal.sh --scenario junction_turn_left --map sh_lingang_hdmap

# 启动 Web 监控控制台
./scripts/launch_console.sh --port 8080
```

### 2. 关键自验标准
- [ ] 车辆在十字路口停止线前正确感知红绿灯状态
- [ ] 左转曲率规划平滑，无大曲率急打方向
- [ ] 挂车铰接角在安全限值内（< 42度）

# 星际塔防 · NEON BASTION

一款纯前端、零依赖的塔防游戏。Canvas 2D + WebAudio + localStorage，
**无构建、无 npm、无 CDN、无外部资源**，双击 `index.html` 即玩。

![](https://img.shields.io/badge/依赖-无-brightgreen)
![](https://img.shields.io/badge/语言-JavaScript-yellow)
![](https://img.shields.io/badge/许可-MIT-blue)

## 特性

- **48 张地图**（12 套布局 × 4 变体），每图双路径
- **25 座炮塔**：洲际导弹、超重型轨道炮、空中母舰（自动补充无人机）、
  可单格转移的空中单位等
- **17 种敌人**，含破甲、护盾、干扰、突袭等机制
- **双开夹具**：同一格叠加两座炮塔
- **逆转系统**：回到 5 分钟内的任意时刻
- **自适应画质**：帧率偏低时自动降档并说明，回复后自动恢复
- 商城 / 天赋 / 成就 / 无尽模式 / 本地命名存档

## 运行

直接打开 `index.html`。

若需本地服务器：

```bash
python -m http.server 8000
# 浏览器访问 http://localhost:8000
```

## 操作

| 按键 | 功能 |
|---|---|
| 左键 | 选中炮塔；选中空中单位后点空格 = 移动 |
| 右键 | 查看炮塔属性栏 |
| `Q` | 铲子 |
| `E` | 双开夹具 |
| `R` | 转移模式 |
| `U` / `X` | 升级 / 拆除 |
| 空格 | 立即出击 |
| `P` / `F` | 暂停 / 变速 |

## 结构

按职责分子目录，共 22 个源文件 + 1 个样式表：

```
index.html                  入口（script 顺序 = 依赖顺序，勿随意调整）
assets/css/main.css         设计系统：金属装甲 / 切角面板 / 警示斜纹
assets/js/main.js           启动引导
assets/js/core/             基础设施与配置
  utils.js                  数学 / DOM / 色彩 / 渐变缓存
  storage.js                localStorage 存档与深合并迁移
  audio.js                  WebAudio 合成引擎（音效 + 音乐调度）
  config.js                 25 炮塔 / 17 敌人 / 关卡 / 天赋 / 成就 / 无尽参数
  path.js                   48 地图变体 + 路径插值 + 种子化场景装饰
  router.js                 界面路由
assets/js/entity/           实体与波次
  particles.js              池化粒子系统（上限 1400，三档画质）
  entities.js               敌人 / 炮塔 / 弹丸实体与行为
  waves.js                  波次生成器
assets/js/render/render.js  Canvas 渲染（甲板 / 炮塔 / 特效 / HUD 覆盖层）
assets/js/game/game.js      主循环、状态机、输入、结算、自适应画质
assets/js/ui/               界面
  hud.js  sidepanel.js  buildbar.js  shop.js  levels.js
  progress.js  settings.js  setup.js  saves.js
```

更详细说明见 [`使用说明.md`](使用说明.md)。

## 许可

MIT

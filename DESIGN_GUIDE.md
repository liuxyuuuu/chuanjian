# 穿剑 — 设计指南

> v1.0 | 2026-06

## 色彩

| 用途 | 色值 |
|------|------|
| 桌面 | radial-gradient(#42B4E9, #1661A2, #0f4280) |
| 不出按钮 | #4a90d9 to #2563a8 |
| 提示按钮 | #e8c84a to #c4a230 |
| 出牌按钮 | #e8a030 to #c48020 |
| 计时器 | #f0d060 / #c8a030 |
| 庄家标 | #e8872e |
| 红花色 | #d32f2f |
| 黑花色 | #333 |

## 扑克牌

白底、圆角8px、阴影0 4px 8px rgba(0,0,0,0.25)。手牌52x74px，扇形重叠(margin-left 22-38px动态)，选中translateY(-18px)。左上角点数+花色，中央大花色(opacity 0.15)。

## 按钮

圆角10px，立体渐变+底部阴影。按下scale(0.95)。不出(蓝左)、提示(黄上中)、出牌(金右)。

## 字体

正文: Noto Serif SC / 标题: Ma Shan Zheng / 标签: ZCOOL XiaoWei

## 动画

passFade(1.2s)、bubbleUp(1.5s)、badge-pulse、cardFly(0.45s)、选中0.15s、按钮缩放0.15s

## 响应式

>=800px居中800px / 竖屏提示横屏 / <=360px手牌缩小

## 语音

简洁/武侠双版、特殊牌慢速沉稳、Web Speech API、中文优先

## 命名

CSS: kebab-case / JS: camelCase / 类: PascalCase / Socket: snake_case

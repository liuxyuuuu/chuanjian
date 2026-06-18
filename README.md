# 穿剑 (Chuan Jian) - 在线棋牌游戏

四人棋牌游戏，红桃四叫牌找队友，3最大4最小。

## 快速上手（免费部署到 Railway）

无需服务器，5分钟上线：

### 1. 准备代码

```bash
# 初始化 git 仓库
cd 穿剑
git init
git add .
git commit -m "初始提交"
```

### 2. 注册 Railway

1. 打开 https://railway.app/ 点 "Start a New Project"
2. 用 GitHub 账号登录（没有的话注册一个）
3. 点击 "Deploy from GitHub repo"
4. 授权后选择你刚上传的 `穿剑` 仓库
5. Railway 自动检测 Node.js，部署完成后会生成一个 `https://xxx.up.railway.app` 的 URL

### 3. 分享给朋友

把 Railway 给的 URL 发到微信群，朋友点开就能玩！

> **在微信里打开**：URL 直接发到微信聊天里，朋友点击就能在微信内置浏览器打开，无需下载任何东西。

---

## 本地开发运行

```bash
cd server
npm install
npm start
# 访问 http://localhost:3000
```

---

## 部署到国内云服务器（推荐，更快）

如果有腾讯云/阿里云服务器，部署更简单：

1. 把代码上传到服务器
2. 安装 Node.js
3. 运行 `cd server && npm install && npm start`
4. 用 Nginx 反向代理 + WebSocket 支持
5. 绑定域名，配置 HTTPS

---

## 部署到 Render（免费备选）

1. 注册 https://render.com（GitHub 登录）
2. 点击 "New +" → "Web Service"
3. 连接你的 GitHub 仓库
4. 选择 Node 环境，Start Command 填 `cd server && npm start`
5. 部署完成获得 `https://xxx.onrender.com`

---

## 游戏规则

- **发牌**：52张牌，4人各13张
- **牌大小**：3 > 2 > A > K > Q > J > 10 > 9 > 8 > 7 > 6 > 5 > 4
- **叫牌**：红桃4持有者叫一张自己没有的牌，持牌人为秘密队友
- **出牌类型**：单张、对子、连对（≥2对）、顺子（≥3张，到A）
- **特殊牌型**：44A（剑）< 666（小雷）< QQQ（大雷）< 炸弹
- **胜负**：队友揭晓于叫牌打出时，按名次计分

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 会话签名密钥：优先环境变量，否则在 data 目录持久化一个随机密钥（重启后令牌仍有效）
function loadOrCreateSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const p = path.join(DATA_DIR, '.secret');
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
  } catch (e) { /* ignore */ }
  const s = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(p, s, { mode: 0o600 }); } catch (e) { /* ignore */ }
  return s;
}

const truthy = (v, def) => {
  if (v === undefined || v === null || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v));
};

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  dataDir: DATA_DIR,
  dbPath: process.env.DB_PATH || path.join(DATA_DIR, 'chuanjian.db'),
  sessionSecret: loadOrCreateSecret(),
  sessionTtlMs: parseInt(process.env.SESSION_TTL_MS || String(30 * 24 * 3600 * 1000), 10),

  // 微信公众号网页授权（生产配置）。未配置 appId/secret 时 wechatEnabled=false。
  wechat: {
    appId: process.env.WECHAT_APPID || '',
    secret: process.env.WECHAT_SECRET || '',
    // 授权回调地址（公网 https 域名 + /api/auth/wechat/callback）
    redirectUri: process.env.WECHAT_REDIRECT_URI || '',
    get enabled() { return !!(this.appId && this.secret); },
  },

  // 本地开发用：允许"模拟登录"（无需微信）。生产可用 ALLOW_DEV_LOGIN=false 关闭。
  allowDevLogin: truthy(process.env.ALLOW_DEV_LOGIN, true),

  // 默认管理员（首次启动时若 admins 表为空则种入）
  defaultAdmin: {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASS || 'admin123',
  },

  // 经济数值（可调）
  economy: {
    newPlayerGold: 10000,
    newPlayerCounterSeconds: 7200, // 2 小时
    matchGoldPerScore: 100,        // 在线匹配：底分 100 金币/积分
    matchMinGold: 500,             // 进入匹配的最低金币
    bankruptcyRelief: 2000,        // 破产救济（每日）
    counterShop: [
      { id: 'c1h', seconds: 3600, gold: 1000, label: '1 小时' },
      { id: 'c6h', seconds: 21600, gold: 5000, label: '6 小时' },
      { id: 'c24h', seconds: 86400, gold: 18000, label: '24 小时' },
    ],
  },
};

module.exports = config;

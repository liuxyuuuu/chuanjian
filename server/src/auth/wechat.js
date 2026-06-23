'use strict';
const config = require('../config');

// 微信公众号网页授权（snsapi_userinfo）
// 文档流程：前端跳 authorize -> 微信回调 redirect_uri?code=xxx -> 用 code 换 access_token+openid -> 拉 userinfo

function buildAuthorizeUrl(state) {
  const appId = config.wechat.appId;
  const redirect = encodeURIComponent(config.wechat.redirectUri);
  return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appId}` +
    `&redirect_uri=${redirect}&response_type=code&scope=snsapi_userinfo&state=${encodeURIComponent(state || '')}#wechat_redirect`;
}

async function exchangeCode(code) {
  const url = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${config.wechat.appId}` +
    `&secret=${config.wechat.secret}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error('wechat oauth2 error: ' + data.errcode + ' ' + (data.errmsg || ''));
  return data; // { access_token, openid, refresh_token, unionid? , scope }
}

async function fetchUserInfo(accessToken, openid) {
  const url = `https://api.weixin.qq.com/sns/userinfo?access_token=${accessToken}&openid=${openid}&lang=zh_CN`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.errcode) throw new Error('wechat userinfo error: ' + data.errcode + ' ' + (data.errmsg || ''));
  return data; // { openid, nickname, headimgurl, unionid? ... }
}

// 用 code 完成完整登录，返回标准化 profile
async function loginWithCode(code) {
  if (!config.wechat.enabled) throw new Error('wechat not configured');
  const tok = await exchangeCode(code);
  let nickname = '微信玩家';
  let avatar = '';
  let unionid = tok.unionid || null;
  try {
    const info = await fetchUserInfo(tok.access_token, tok.openid);
    nickname = info.nickname || nickname;
    avatar = info.headimgurl || '';
    unionid = info.unionid || unionid;
  } catch (e) {
    // userinfo 失败不阻断登录（仍可用 openid 建号）
  }
  return { openid: tok.openid, unionid, nickname, avatar };
}

module.exports = { buildAuthorizeUrl, exchangeCode, fetchUserInfo, loginWithCode };

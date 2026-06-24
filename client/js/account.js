// 账号 / 钱包 / 登录 / 面板（公告·邮件·商店·任务）/ 记牌器开关 / 聊天
// 自注入 UI，尽量少改 index.html
(function () {
  const LS_TOKEN = 'chuanjian_token';
  const PHRASES = ['快点出牌！','好牌！','哈哈，赢定了','决战到天亮','队友给力！','这把稳了','失误失误','再来一局','你太强了','认输吧'];

  const Account = {
    token: '',
    player: null,        // { id, nickname, avatar, gold, counterSeconds, wins, games, unreadMail }
    config: { wechatEnabled: false, allowDevLogin: true },
    _walletCbs: [],

    getToken() { return this.token || ''; },
    isLoggedIn() { return !!(this.player && !this.player.isGuest); },
    isGuest() { return !!(this.player && this.player.isGuest); },
    hasSession() { return !!(this.player); },
    onWallet(cb) { this._walletCbs.push(cb); },
    _emitWallet() { this._walletCbs.forEach(cb => { try { cb(this.player); } catch (e) {} }); },

    async api(path, opts) {
      opts = opts || {};
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      if (this.token) opts.headers['Authorization'] = 'Bearer ' + this.token;
      const res = await fetch('/api' + path, opts);
      return res.json();
    },

    setPlayer(p) {
      if (!p) return;
      this.player = p;
      this.renderBar();
      this._emitWallet();
    },

    // 应用 wallet_update（服务端推送的钱包变化）
    applyWallet(w) {
      if (!this.player || !w) return;
      if (typeof w.gold === 'number') this.player.gold = w.gold;
      if (typeof w.counterSeconds === 'number') this.player.counterSeconds = w.counterSeconds;
      this.renderBar();
      this._emitWallet();
      if (typeof w.goldDelta === 'number' && w.goldDelta !== 0 && window.UI) {
        UI.showToast((w.goldDelta > 0 ? '🪙 +' : '🪙 ') + w.goldDelta + ' 金币');
      }
    },

    async init() {
      // 先确定 token，便于 socket 尽早带令牌握手
      const m = location.search.match(/[?&]token=([^&]+)/);
      if (m) {
        this.token = decodeURIComponent(m[1]);
        localStorage.setItem(LS_TOKEN, this.token);
        history.replaceState({}, '', location.pathname);
      } else {
        this.token = localStorage.getItem(LS_TOKEN) || '';
      }
      try { this.config = await this.api('/config'); } catch (e) { this.config = { registerMode: true }; }
      this.injectStyles();
      this.buildBar();
      this.buildLoginOverlay();
      if (this.token) {
        const me = await this.api('/me');
        if (me && me.success) { this.setPlayer(me.player); this.hideLogin(); this.reconnectSocket(); }
        else { this.token = ''; localStorage.removeItem(LS_TOKEN); this.showLogin(); }
      } else {
        this.showLogin();
      }
    },

    reconnectSocket() {
      try {
        if (window.socket) { socket.auth = { token: this.token }; socket.disconnect(); socket.connect(); }
      } catch (e) {}
    },

    async devLogin(nickname, avatar) {
      const r = await this.api('/auth/dev-login', { method: 'POST', body: JSON.stringify({ nickname, avatar }) });
      if (r && r.success) {
        this.token = r.token; localStorage.setItem(LS_TOKEN, this.token);
        this.setPlayer(r.player); this.hideLogin(); this.reconnectSocket();
        this.showError(''); if (window.UI) UI.showToast('登录成功');
      } else { this.showError((r && r.reason) || '登录失败'); }
    },

    wechatLogin() { location.href = '/api/auth/wechat'; },

    async logout() {
      try { await this.api('/logout', { method: 'POST' }); } catch (e) {}
      this.token = ''; this.player = null; localStorage.removeItem(LS_TOKEN);
      this.renderBar(); this.showLogin();
    },

    // ===== UI =====
    injectStyles() {
      if (document.getElementById('acc-styles')) return;
      const s = document.createElement('style'); s.id = 'acc-styles';
      s.textContent = `
      #acc-bar{position:fixed;top:20px;right:8px;z-index:120;display:flex;gap:6px;align-items:center;font-family:'ZCOOL XiaoWei',serif}
      #acc-bar .gold{background:rgba(0,0,0,0.45);color:#ffd34d;border:1px solid rgba(255,210,80,.4);border-radius:14px;padding:3px 10px;font-weight:700;font-size:.82rem}
      #acc-bar .ab{background:rgba(0,0,0,0.4);color:#ffe9b0;border:1px solid rgba(255,210,120,.3);border-radius:12px;padding:3px 8px;font-size:.8rem;cursor:pointer;position:relative}
      #acc-bar .ab .dot{position:absolute;top:-3px;right:-3px;width:9px;height:9px;border-radius:50%;background:#e74c3c}
      .acc-modal{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center}
      .acc-modal .box{background:#1f2a3a;color:#f0e6d2;border:1px solid rgba(201,168,76,.4);border-radius:12px;width:min(92vw,420px);max-height:80vh;overflow:auto;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
      .acc-modal h3{margin:0 0 10px;color:#ffd98a}
      .acc-row{border-bottom:1px solid rgba(255,255,255,.08);padding:8px 0}
      .acc-row b{color:#ffd98a}
      .acc-btn{background:linear-gradient(180deg,#e8a030,#c48020);border:none;color:#fff;border-radius:8px;padding:6px 12px;cursor:pointer;font-family:'ZCOOL XiaoWei',serif}
      .acc-btn.sm{padding:3px 10px;font-size:.8rem}
      .acc-btn.gray{background:#566;}
      .acc-close{float:right;cursor:pointer;color:#cbb}
      #login-overlay .box{width:min(92vw,360px);text-align:center}
      #login-overlay input{width:100%;padding:8px;margin:6px 0;border-radius:8px;border:1px solid #ccc}
      .acc-muted{color:#9fb0c3;font-size:.78rem}
      `;
      document.head.appendChild(s);
    },

    buildBar() {
      if (document.getElementById('acc-bar')) return;
      const bar = document.createElement('div'); bar.id = 'acc-bar';
      bar.innerHTML =
        '<span class="gold" id="acc-gold">🪙 --</span>' +
        '<span class="ab" onclick="Account.openAnnouncements()">公告</span>' +
        '<span class="ab" id="acc-mail-btn" onclick="Account.openMail()">邮件<span class="dot" id="acc-mail-dot" style="display:none"></span></span>' +
        '<span class="ab" onclick="Account.openShop()">商店</span>' +
        '<span class="ab" onclick="Account.openTasks()">任务</span>';
      document.body.appendChild(bar);
      this.renderBar();
    },

    renderBar() {
      const bar = document.getElementById('acc-bar'); if (!bar) return;
      const onLobby = !!(document.getElementById('lobby-page') && document.getElementById('lobby-page').classList.contains('active'));
      bar.style.display = (this.player && onLobby) ? 'flex' : 'none';
  const lobbyLogout = document.getElementById("lobby-logout-btn");
  const lobbyLogin = document.getElementById("lobby-login-btn");
  if (lobbyLogin) lobbyLogin.style.display = this.player ? "none" : "inline-flex";
  if (lobbyLogout) lobbyLogout.style.display = this.player ? "inline-flex" : "none";
      const g = document.getElementById('acc-gold'); if (g && this.player) g.textContent = '🪙 ' + this.player.gold;
      const dot = document.getElementById('acc-mail-dot'); if (dot && this.player) dot.style.display = this.player.unreadMail > 0 ? 'block' : 'none';
    },

    switchLoginTab(tab) {
      this._loginTab = tab;
      const isReg = tab === 'reg';
      const submit = document.getElementById('login-submit');
      const tl = document.getElementById('tab-login');
      const tr = document.getElementById('tab-reg');
      if (submit) submit.textContent = isReg ? '注册并登录' : '登录';
      const pwd2 = document.getElementById("login-pwd2");
      if (pwd2) pwd2.style.display = isReg ? "" : "none";
      if (tl) tl.className = 'acc-btn sm' + (isReg ? ' gray' : '');
      if (tr) tr.className = 'acc-btn sm' + (isReg ? '' : ' gray');
    },
    buildLoginOverlay() {
      if (document.getElementById('login-overlay')) return;
      const o = document.createElement('div'); o.id = 'login-overlay'; o.className = 'acc-modal'; o.style.display = 'none';
      o.innerHTML =
        '<div class="box">' +
        '<h3>' + String.fromCodePoint(0x7A7F, 0x5251) + '</h3>' +
        '<div id="login-tab" style="display:flex;gap:8px;justify-content:center;margin-bottom:10px">' +
          '<button class="acc-btn sm" id="tab-login" onclick="Account.switchLoginTab(' + String.fromCharCode(39) + 'login' + String.fromCharCode(39) + ')">' + String.fromCodePoint(0x767B, 0x5F55) + '</button>' +
          '<button class="acc-btn sm gray" id="tab-reg" onclick="Account.switchLoginTab(' + String.fromCharCode(39) + 'reg' + String.fromCharCode(39) + ')">' + String.fromCodePoint(0x6CE8, 0x5' + '</div>' +
        '<button class="acc-btn sm" onclick="Account.guestLogin()" style="width:100%;margin-top:8px;background:#566">' + String.fromCodePoint(0x6E38) + String.fromCodePoint(0x5BA2) + String.fromCodePoint(0x767B) + String.fromCodePoint(0x5F55) + '</button>' +
        
        '<div id="login-error" class="hidden" style="color:#e74c3c;font-size:.8rem;margin-top:6px;text-align:center"></div>' +
        '<div class="acc-muted"        '<input id="login-id" inputmode="numeric" maxlength="11" placeholder="ID' + String.fromCodePoint(0xFF08) + '8-11' + String.fromCodePoint(0x4F4D) + String.fromCodePoint(0x6570) + String.fromCodePoint(0x5B57) + String.fromCodePoint(0xFF09) + '">' +
        '<input id="login-pwd" type="password" maxlength="20" placeholder="' + String.fromCodePoint(0x5BC6) + String.fromCodePoint(0x7801) + String.fromCodePoint(0xFF08) + '6-20' + String.fromCodePoint(0x4F4D) + String.fromCodePoint(0xFF09) + '">' +
        '<input id="login-pwd2" type="password" maxlength="20" placeholder="' + String.fromCodePoint(0x786E) + String.fromCodePoint(0x8BA4) + String.fromCodePoint(0x5BC6) + String.fromCodePoint(0x7801) + '" style="display:none">' +
       '<button class="acc-btn" id="login-submit" style="width:100%" onclick="Account.submitAuth()">' + String.fromCodePoint(0x767B, 0x5F55) + '</button>' +
        '<div class="acc-muted" style="margin-top:8px">ID ' + String.fromCodePoint(0x4E3A) + ' 8-11 ' + String.fromCodePoint(0x4F4D) + String.fromCodePoint(0x7EAF) + String.fromCodePoint(0x6570) + String.fromCodePoint(0x5B57) + String.fromCodePoint(0xFF0C) + String.fromCodePoint(0x5BC6) + String.fromCodePoint(0x7801) + ' 6-20 ' + String.fromCodePoint(0x4F4D) + '</div>' +
        '</div>';
      document.body.appendChild(o);
      const idEl = o.querySelector('#login-id');
      idEl.addEventListener('input', () => { idEl.value = idEl.value.replace(/\D/g, '').slice(0, 11); });
      this._loginTab = 'login';
    },
    switchLoginTab(tab) {
      this._loginTab = tab;
      const isReg = tab === 'reg';
      const submit = document.getElementById('login-submit');
      const tl = document.getElementById('tab-login');
      const tr = document.getElementById('tab-reg');
      if (submit) submit.textContent = isReg ? '注册并登录' : '登录';
      const pwd2 = document.getElementById("login-pwd2");
      if (pwd2) pwd2.style.display = isReg ? "" : "none";
      if (tl) tl.className = 'acc-btn sm' + (isReg ? ' gray' : '');
      if (tr) tr.className = 'acc-btn sm' + (isReg ? '' : ' gray');
    },
    showLogin() { const o = document.getElementById('login-overlay'); if (o) o.style.display = 'flex'; },
    hideLogin() { const o = document.getElementById('login-overlay'); if (o) o.style.display = 'none'; },

    modal(title, innerHtml) {
      const o = document.createElement('div'); o.className = 'acc-modal';
      o.innerHTML = '<div class="box"><span class="acc-close">✕</span><h3>' + title + '</h3><div class="acc-body"></div></div>';
      o.querySelector('.acc-close').onclick = () => o.remove();
      o.onclick = (e) => { if (e.target === o) o.remove(); };
      o.querySelector('.acc-body').innerHTML = innerHtml;
      document.body.appendChild(o);
      return o;
    },

    async openAnnouncements() {
      const r = await this.api('/announcements');
      const list = (r && r.list) || [];
      const html = list.length ? list.map(a => '<div class="acc-row"><b>' + esc(a.title) + '</b><div>' + esc(a.body || '') + '</div></div>').join('') : '<div class="acc-muted">暂无公告</div>';
      this.modal('📢 公告', html);
    },

    async openMail() {
      const r = await this.api('/mail');
      const list = (r && r.list) || [];
      const html = list.length ? list.map(m => {
        const attach = m.hasAttach ? ('<div class="acc-muted">附件：' + (m.gold ? ('🪙' + m.gold + ' ') : '') + (m.counter ? ('记牌器' + Math.round(m.counter / 60) + '分钟') : '') + '</div>') : '';
        const btn = (m.hasAttach && !m.claimed) ? ('<button class="acc-btn sm" onclick="Account.claimMail(' + m.id + ',this)">领取</button>') : (m.claimed && m.hasAttach ? '<span class="acc-muted">已领取</span>' : '');
        return '<div class="acc-row"><b>' + esc(m.title) + '</b> ' + btn + '<div>' + esc(m.body || '') + '</div>' + attach + '</div>';
      }).join('') : '<div class="acc-muted">暂无邮件</div>';
      this._mailModal = this.modal('✉️ 邮件', html);
      // 标记已读
      list.forEach(m => { if (!m.read) this.api('/mail/' + m.id + '/read', { method: 'POST' }); });
      if (this.player) { this.player.unreadMail = 0; this.renderBar(); }
    },
    async claimMail(id, btn) {
      const r = await this.api('/mail/' + id + '/claim', { method: 'POST' });
      if (r && r.success) { if (r.player) this.setPlayer(r.player); if (btn) btn.outerHTML = '<span class="acc-muted">已领取</span>'; if (window.UI) UI.showToast('领取成功'); }
      else if (window.UI) UI.showToast((r && r.reason) || '领取失败');
    },

    async openShop() {
      const r = await this.api('/shop/counter');
      const items = (r && r.items) || [];
      const html = '<div class="acc-muted">用金币兑换记牌器时长</div>' + items.map(it =>
        '<div class="acc-row"><b>' + esc(it.label) + '</b> 记牌器 <button class="acc-btn sm" style="float:right" onclick="Account.buyCounter(\'' + it.id + '\')">🪙 ' + it.gold + '</button></div>'
      ).join('');
      this._shopModal = this.modal('🛒 商店', html);
    },
    async buyCounter(id) {
      const r = await this.api('/shop/counter/buy', { method: 'POST', body: JSON.stringify({ id }) });
      if (r && r.success) { if (r.player) this.setPlayer(r.player); if (window.UI) UI.showToast('购买成功'); }
      else if (window.UI) UI.showToast((r && r.reason) || '购买失败');
    },

    async openTasks() {
      const r = await this.api('/tasks');
      const list = (r && r.list) || [];
      const html = list.map(t => {
        const reward = (t.gold ? ('🪙' + t.gold + ' ') : '') + (t.counter ? ('记牌器' + Math.round(t.counter / 60) + '分钟') : '');
        let action;
        if (t.claimed) action = '<span class="acc-muted">已领取</span>';
        else if (t.done) action = '<button class="acc-btn sm" onclick="Account.claimTask(\'' + t.id + '\',this)">领取</button>';
        else action = '<span class="acc-muted">' + t.progress + '/' + t.goal + '</span>';
        return '<div class="acc-row"><b>' + esc(t.title) + '</b> <span style="float:right">' + action + '</span><div class="acc-muted">奖励：' + reward + '</div></div>';
      }).join('');
      this.modal('🎯 任务', html);
    },
    async claimTask(id, btn) {
      const r = await this.api('/tasks/' + id + '/claim', { method: 'POST' });
      if (r && r.success) { if (r.player) this.setPlayer(r.player); if (btn) btn.outerHTML = '<span class="acc-muted">已领取</span>'; if (window.UI) UI.showToast('领取成功'); }
      else if (window.UI) UI.showToast((r && r.reason) || '领取失败');
    },

    PHRASES,
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  window.Account = Account;
  document.addEventListener('DOMContentLoaded', () => { Account.init(); });
})();

class ExecStreamClient {
  constructor() {
    this.ws = null;
    this.terminal = document.getElementById('terminal');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.authContainer = document.getElementById('authContainer');
    this.authCode = document.getElementById('authCode');
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.deviceId = null;
    this.pollInterval = null;
    this.authInfo = null;
    this.historyLoaded = false;
    this.currentToken = null;
    this.encryptionKey = null;

    this.execOutputReceived = new Map();
    this.lang = localStorage.getItem('exec-stream-lang') || 'zh';
    this.theme = localStorage.getItem('exec-stream-theme') || 'dark';

    this.messages = {
      zh: {
        pageTitle: 'Exec Stream - OpenClaw 命令监控',
        title: '🖥️ Exec Stream',
        statusConnecting: '连接中...',
        statusConnected: '已连接',
        statusDisconnected: '已断开',
        statusWaitingAuth: '等待授权...',
        authTitle: '请授权访问',
        authHint: '将授权口令发送给 OpenClaw 完成授权',
        authCopy: '📋 复制授权口令',
        authCopied: '✅ 已复制！',
        authCopyFailed: '复制失败，请手动复制: ',
        authNotReady: '授权口令还未生成，请稍候',
        historyBtn: '📜 历史命令',
        historyLoaded: '加载 {count} 条历史命令',
        historyEmpty: '暂无历史命令',
        historyTag: '历史',
        loadHistoryFailed: '加载历史命令失败: {message}',
        commandEnded: '命令结束 {exitCode} {duration}',
        wsConnected: 'WebSocket 已连接',
        wsDisconnected: 'WebSocket 已断开，正在重连...',
        authSuccess: '授权成功！',
        fetchAuthCodeFailed: '获取授权码失败: {message}',
        connectError: '连接错误',
        connectFailed: '连接失败: {message}',
        authFailed: '鉴权失败: {reason}',
        expandAll: '展开全部 ({count} 行)',
        collapse: '折叠',
        themeDark: '浅色模式',
        themeLight: '深色模式'
      },
      en: {
        pageTitle: 'Exec Stream - OpenClaw Command Monitor',
        title: '🖥️ Exec Stream',
        statusConnecting: 'Connecting...',
        statusConnected: 'Connected',
        statusDisconnected: 'Disconnected',
        statusWaitingAuth: 'Waiting for authorization...',
        authTitle: 'Authorization Required',
        authHint: 'Send the authorization phrase to OpenClaw to complete authorization',
        authCopy: '📋 Copy Auth Phrase',
        authCopied: '✅ Copied!',
        authCopyFailed: 'Copy failed, please copy manually: ',
        authNotReady: 'Authorization phrase is not ready yet',
        historyBtn: '📜 History',
        historyLoaded: 'Loaded {count} historical commands',
        historyEmpty: 'No historical commands yet',
        historyTag: 'history',
        loadHistoryFailed: 'Failed to load history: {message}',
        commandEnded: 'Command finished {exitCode} {duration}',
        wsConnected: 'WebSocket connected',
        wsDisconnected: 'WebSocket disconnected, reconnecting...',
        authSuccess: 'Authorization successful!',
        fetchAuthCodeFailed: 'Failed to get auth code: {message}',
        connectError: 'Connection error',
        connectFailed: 'Connection failed: {message}',
        authFailed: 'Authentication failed: {reason}',
        expandAll: 'Expand all ({count} lines)',
        collapse: 'Collapse',
        themeDark: 'Light mode',
        themeLight: 'Dark mode'
      }
    };

    this.init();
  }

  t(key, vars = {}) {
    const dict = this.messages[this.lang] || this.messages.zh;
    const template = dict[key] || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
  }

  async init() {
    this.applyTheme();
    this.applyLang();

    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (token) {
      this.connect(token);
    } else {
      await this.showAuthCodeInterface();
    }
  }

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('exec-stream-theme', this.theme);
    this.applyTheme();
  }

  applyTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    btn.textContent = this.theme === 'light' ? '🌙' : '☀️';
    btn.title = this.theme === 'light' ? this.t('themeLight') : this.t('themeDark');
  }

  toggleLang() {
    this.lang = this.lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('exec-stream-lang', this.lang);
    this.applyLang();
  }

  applyLang() {
    document.documentElement.lang = this.lang === 'zh' ? 'zh-CN' : 'en';
    document.title = this.t('pageTitle');

    const title = document.querySelector('.header h1');
    if (title) title.textContent = this.t('title');

    const langBtn = document.getElementById('langBtn');
    if (langBtn) langBtn.textContent = this.lang === 'zh' ? 'EN' : '中文';

    const historyBtn = document.getElementById('historyBtn');
    if (historyBtn) historyBtn.textContent = this.t('historyBtn');

    const authTitle = document.getElementById('authTitle');
    if (authTitle) authTitle.textContent = this.t('authTitle');

    const authHint = document.getElementById('authHint');
    if (authHint) authHint.textContent = this.t('authHint');

    const copyBtn = document.querySelector('.copy-btn');
    if (copyBtn && !copyBtn.dataset.copied) {
      copyBtn.textContent = this.t('authCopy');
    }

    this.applyTheme();

    const currentStatus = this.statusText.dataset.statusKey;
    if (currentStatus) {
      this.statusText.textContent = this.t(currentStatus);
    }

    const toggleButtons = document.querySelectorAll('.toggle-btn[data-lines]');
    toggleButtons.forEach(btn => {
      const expanded = btn.dataset.expanded === 'true';
      const lineCount = Number(btn.dataset.lines || 0);
      btn.textContent = expanded ? this.t('collapse') : this.t('expandAll', { count: lineCount });
    });
  }

  async showAuthCodeInterface() {
    try {
      const response = await fetch('/exec-stream/auth/code');
      const data = await response.json();

      this.deviceId = data.deviceId;
      this.authCode.textContent = data.code;
      this.authContainer.style.display = 'flex';
      this.updateStatus('waiting', 'statusWaitingAuth');
      this.authInfo = `/exec-stream auth ${data.code}`;
      this.startPolling();
    } catch (e) {
      this.appendOutput(this.t('fetchAuthCodeFailed', { message: e.message }), 'error');
    }
  }

  startPolling() {
    this.pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/exec-stream/auth/status?deviceId=${this.deviceId}`);
        const data = await response.json();

        if (data.authorized && data.token) {
          clearInterval(this.pollInterval);
          this.authContainer.style.display = 'none';

          const url = new URL(window.location.href);
          url.searchParams.set('token', data.token);
          window.history.pushState({}, '', url);

          this.connect(data.token);
        }
      } catch (e) {
        console.error('Poll error:', e);
      }
    }, 2000);
  }

  connect(token) {
    this.currentToken = token;
    this.encryptionKey = this.extractEncryptionKeyFromToken(token);
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/exec-stream?token=${encodeURIComponent(token)}`;

    this.updateStatus('connecting', 'statusConnecting');

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.updateStatus('connected', 'statusConnected');
        this.reconnectDelay = 1000;
        this.appendMeta(this.t('wsConnected'));
      };

      this.ws.onmessage = async (event) => {
        try {
          if (typeof event.data !== 'string') return;
          const message = await this.parseIncomingMessage(event.data);
          this.handleMessage(message);
        } catch (e) {
          console.error('Parse message error:', e);
        }
      };

      this.ws.onclose = (event) => {
        this.updateStatus('disconnected', 'statusDisconnected');

        if (event.code === 1008) {
          this.appendOutput(this.t('authFailed', { reason: event.reason }), 'error');
        } else {
          this.appendMeta(this.t('wsDisconnected'));
          setTimeout(() => this.connect(token), this.reconnectDelay);
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.appendOutput(this.t('connectError'), 'error');
      };
    } catch (e) {
      this.appendOutput(this.t('connectFailed', { message: e.message }), 'error');
    }
  }

  async parseIncomingMessage(rawData) {
    const message = JSON.parse(rawData);

    if (message.type === 'compressed') {
      return JSON.parse(this.inflateBase64Payload(message.data));
    }

    if (message.type === 'encrypted') {
      if (!this.encryptionKey) {
        throw new Error('Missing encryption key');
      }

      const decrypted = await this.decrypt(message, this.encryptionKey);
      const envelope = JSON.parse(decrypted);
      return envelope.compressed
        ? JSON.parse(this.inflateBase64Payload(envelope.payload))
        : JSON.parse(envelope.payload);
    }

    return message;
  }

  inflateBase64Payload(base64) {
    if (!window.pako || typeof window.pako.inflate !== 'function') {
      throw new Error('pako inflate is not available');
    }

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return window.pako.inflate(bytes, { to: 'string' });
  }

  extractEncryptionKeyFromToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;

    try {
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const payload = JSON.parse(atob(padded));
      return typeof payload.encKey === 'string' ? payload.encKey : null;
    } catch {
      return null;
    }
  }

  async decrypt(message, keyBase64Url) {
    const cryptoApi = window.crypto && window.crypto.subtle;
    if (!cryptoApi) {
      throw new Error('Web Crypto API is not available');
    }

    const key = await cryptoApi.importKey(
      'raw',
      this.toArrayBuffer(this.base64UrlToBytes(keyBase64Url)),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );

    const encryptedBytes = this.base64ToBytes(message.data);
    const authTagBytes = this.base64ToBytes(message.authTag);
    const combined = new Uint8Array(encryptedBytes.length + authTagBytes.length);
    combined.set(encryptedBytes, 0);
    combined.set(authTagBytes, encryptedBytes.length);

    const decrypted = await cryptoApi.decrypt(
      {
        name: 'AES-GCM',
        iv: this.toArrayBuffer(this.base64ToBytes(message.iv)),
        tagLength: 128
      },
      key,
      this.toArrayBuffer(combined)
    );

    return new TextDecoder().decode(decrypted);
  }

  base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  base64UrlToBytes(value) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return this.base64ToBytes(padded);
  }

  toArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  handleMessage(message) {
    switch (message.type) {
      case 'exec_start':
        this.handleExecStart(message.data);
        break;
      case 'exec_output':
        this.handleExecOutput(message.data);
        break;
      case 'exec_end':
        this.handleExecEnd(message.data);
        break;
      case 'auth_success':
        this.handleAuthSuccess(message.data);
        break;
      case 'pong':
        break;
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  handleAuthSuccess(data) {
    this.appendMeta(data.message || this.t('authSuccess'));
  }

  handleExecStart(data) {
    const time = new Date(data.timestamp).toLocaleTimeString();
    this.appendCommand(`$ ${data.command}`, time, data.cwd);
    this.execOutputReceived.set(data.execId, false);
  }

  handleExecOutput(data) {
    if (data.execId) {
      this.execOutputReceived.set(data.execId, true);
    }

    if (data.stdout) {
      this.appendOutput(data.stdout);
    }
    if (data.stderr) {
      this.appendOutput(data.stderr, 'error');
    }
  }

  handleExecEnd(data) {
    const hasReceivedOutput = data.execId && this.execOutputReceived.get(data.execId);
    if (!hasReceivedOutput) {
      this.handleExecOutput(data);
    }

    if (data.execId) {
      this.execOutputReceived.delete(data.execId);
    }

    const duration = data.duration ? `(${data.duration}ms)` : '';
    const exitCode = data.exitCode !== undefined ? `exit ${data.exitCode}` : '';
    this.appendMeta(this.t('commandEnded', { exitCode, duration }).trim());
  }

  appendCommand(text, time, cwd) {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="meta">${time}${cwd ? ' • ' + this.escapeHtml(cwd) : ''}</div>
      <div class="command">${this.escapeHtml(text)}</div>
    `;
    this.terminal.appendChild(div);
    this.scrollToBottom();
  }

  appendOutput(text, className = '') {
    const normalized = String(text ?? '');
    const lineCount = normalized === '' ? 0 : normalized.split(/\r?\n/).length;
    const maxLines = 10;

    if (lineCount > maxLines) {
      const container = document.createElement('div');
      container.className = `output-container ${className}`.trim();

      const outputDiv = document.createElement('div');
      outputDiv.className = `output ${className} collapsible collapsed`.trim();
      outputDiv.textContent = normalized;
      outputDiv.style.maxHeight = `${maxLines * 1.6}em`;
      outputDiv.style.overflow = 'hidden';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'toggle-btn';
      toggleBtn.dataset.lines = String(lineCount);
      toggleBtn.dataset.expanded = 'false';
      toggleBtn.textContent = this.t('expandAll', { count: lineCount });
      toggleBtn.onclick = () => {
        const expanded = toggleBtn.dataset.expanded === 'true';
        if (expanded) {
          outputDiv.style.maxHeight = `${maxLines * 1.6}em`;
          outputDiv.classList.add('collapsed');
          toggleBtn.dataset.expanded = 'false';
          toggleBtn.textContent = this.t('expandAll', { count: lineCount });
        } else {
          outputDiv.style.maxHeight = 'none';
          outputDiv.classList.remove('collapsed');
          toggleBtn.dataset.expanded = 'true';
          toggleBtn.textContent = this.t('collapse');
        }
        this.scrollToBottom();
      };

      container.appendChild(outputDiv);
      container.appendChild(toggleBtn);
      this.terminal.appendChild(container);
    } else {
      const div = document.createElement('div');
      div.className = `output ${className}`.trim();
      div.textContent = normalized;
      this.terminal.appendChild(div);
    }

    this.scrollToBottom();
  }

  appendMeta(text) {
    const div = document.createElement('div');
    div.className = 'meta';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.terminal.appendChild(div);
    this.scrollToBottom();
  }

  updateStatus(status, key) {
    this.statusDot.className = 'status-dot';
    if (status === 'connected') {
      this.statusDot.classList.add('connected');
    } else if (status === 'waiting') {
      this.statusDot.classList.add('waiting');
    }

    this.statusText.dataset.statusKey = key;
    this.statusText.textContent = this.t(key);
  }

  scrollToBottom() {
    this.terminal.scrollTop = this.terminal.scrollHeight;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

function copyAuthCode() {
  const client = window.execStreamClient;
  if (!client || !client.authInfo) {
    alert(client ? client.t('authNotReady') : 'Authorization phrase is not ready yet');
    return;
  }

  const text = client.authInfo;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showCopySuccess();
    }).catch(err => {
      console.error('Clipboard API failed:', err);
      copyWithFallback(text);
    });
  } else {
    copyWithFallback(text);
  }
}

function copyWithFallback(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const successful = document.execCommand('copy');
    if (successful) {
      showCopySuccess();
    } else {
      const client = window.execStreamClient;
      alert((client ? client.t('authCopyFailed') : 'Copy failed, please copy manually: ') + text);
    }
  } catch (err) {
    console.error('execCommand failed:', err);
    const client = window.execStreamClient;
    alert((client ? client.t('authCopyFailed') : 'Copy failed, please copy manually: ') + text);
  }

  document.body.removeChild(textarea);
}

function showCopySuccess() {
  const client = window.execStreamClient;
  const btn = document.querySelector('.copy-btn');
  if (!btn || !client) return;

  const originalText = client.t('authCopy');
  btn.dataset.copied = 'true';
  btn.textContent = client.t('authCopied');
  btn.style.background = '#1177bb';
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = '';
    delete btn.dataset.copied;
  }, 2000);
}

function toggleTheme() {
  window.execStreamClient?.toggleTheme();
}

function toggleLang() {
  window.execStreamClient?.toggleLang();
}

async function loadHistory() {
  try {
    const response = await fetch('/exec-stream/commands');
    const data = await response.json();

    const client = window.execStreamClient;
    if (!client) {
      alert('Client is not initialized');
      return;
    }

    if (data.commands.length === 0) {
      client.appendMeta(client.t('historyEmpty'));
      return;
    }

    client.appendMeta(client.t('historyLoaded', { count: data.commands.length }));

    data.commands.forEach(cmd => {
      const time = new Date(cmd.timestamp).toLocaleTimeString();
      client.appendCommand(`$ ${cmd.command}`, time, cmd.cwd);

      if (cmd.stdout) {
        client.appendOutput(cmd.stdout);
      }
      if (cmd.stderr) {
        client.appendOutput(cmd.stderr, 'error');
      }

      const duration = cmd.duration ? `(${cmd.duration}ms)` : '';
      const exitCode = cmd.exitCode !== undefined ? `exit ${cmd.exitCode}` : '';
      client.appendMeta(`${client.t('commandEnded', { exitCode, duration }).trim()} [${client.t('historyTag')}]`);
    });
  } catch (e) {
    console.error('Load history error:', e);
    const client = window.execStreamClient;
    alert(client ? client.t('loadHistoryFailed', { message: e.message }) : `Failed to load history: ${e.message}`);
  }
}

window.execStreamClient = new ExecStreamClient();

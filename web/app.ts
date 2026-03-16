/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

interface ExecEvent {
  sessionId?: string;
  execId?: string;
  command: string;
  cwd?: string;
  timestamp: number;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  duration?: number;
}

interface AuthSuccessPayload {
  message?: string;
  token?: string;
}

interface CompressedWebSocketMessage {
  type: 'compressed';
  data: string;
}

interface EncryptedWebSocketMessage {
  type: 'encrypted';
  data: string;
  iv: string;
  authTag: string;
}

interface EncryptedPayloadEnvelope {
  compressed: boolean;
  payload: string;
}

type ExecMessageType = 'exec_start' | 'exec_output' | 'exec_end' | 'auth_success' | 'pong';

type ExecStreamMessage =
  | { type: 'exec_start'; data: ExecEvent }
  | { type: 'exec_output'; data: ExecEvent }
  | { type: 'exec_end'; data: ExecEvent }
  | { type: 'auth_success'; data: AuthSuccessPayload }
  | { type: 'pong' }
  | CompressedWebSocketMessage
  | EncryptedWebSocketMessage;

interface WindowPako {
  inflate(data: Uint8Array, options: { to: 'string' }): string;
}

interface Window {
  execStreamClient?: ExecStreamClient;
  pako?: WindowPako;
}

class ExecStreamClient {
  ws: WebSocket | null;
  terminal: HTMLDivElement;
  statusDot: HTMLDivElement;
  statusText: HTMLSpanElement;
  authContainer: HTMLDivElement;
  authCode: HTMLDivElement;
  reconnectDelay: number;
  maxReconnectDelay: number;
  deviceId: string | null;
  pollInterval: ReturnType<typeof setInterval> | null;
  authInfo: string | null;
  historyLoaded: boolean;
  currentToken: string | null;
  encryptionKey: string | null;
  execOutputReceived: Map<string, boolean>;
  lang: 'zh' | 'en';
  theme: 'dark' | 'light';
  messages: Record<string, Record<string, string>>;

  constructor() {
    this.ws = null;
    this.terminal = document.getElementById('terminal') as HTMLDivElement;
    this.statusDot = document.getElementById('statusDot') as HTMLDivElement;
    this.statusText = document.getElementById('statusText') as HTMLSpanElement;
    this.authContainer = document.getElementById('authContainer') as HTMLDivElement;
    this.authCode = document.getElementById('authCode') as HTMLDivElement;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.deviceId = null;
    this.pollInterval = null;
    this.authInfo = null;
    this.historyLoaded = false;
    this.currentToken = null;
    this.encryptionKey = null;

    this.execOutputReceived = new Map();
    this.lang = localStorage.getItem('exec-stream-lang') === 'en' ? 'en' : 'zh';
    this.theme = localStorage.getItem('exec-stream-theme') === 'light' ? 'light' : 'dark';

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

  t(key: string, vars: Record<string, string | number> = {}): string {
    const dict = this.messages[this.lang] || this.messages.zh;
    const template = dict[key] || key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
  }

  async init(): Promise<void> {
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

  toggleTheme(): void {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('exec-stream-theme', this.theme);
    this.applyTheme();
  }

  applyTheme(): void {
    document.documentElement.setAttribute('data-theme', this.theme);
    const btn = document.getElementById('themeBtn');
    if (!btn) return;
    btn.textContent = this.theme === 'light' ? '🌙' : '☀️';
    btn.title = this.theme === 'light' ? this.t('themeLight') : this.t('themeDark');
  }

  toggleLang(): void {
    this.lang = this.lang === 'zh' ? 'en' : 'zh';
    localStorage.setItem('exec-stream-lang', this.lang);
    this.applyLang();
  }

  applyLang(): void {
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
  }

  async showAuthCodeInterface(): Promise<void> {
    const response = await fetch('/exec-stream/auth/code');
    const data = await response.json() as { code: string; deviceId: string };

    this.deviceId = data.deviceId;
    this.authCode.textContent = data.code;
    this.authContainer.style.display = 'flex';
    this.updateStatus('waiting', 'statusWaitingAuth');
    this.authInfo = `/exec-stream auth ${data.code}`;
    this.startPolling();
  }

  startPolling(): void {
    this.pollInterval = setInterval(async () => {
      const response = await fetch(`/exec-stream/auth/status?deviceId=${this.deviceId}`);
      const data = await response.json() as { authorized: boolean; token?: string };

      if (data.authorized && data.token) {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.authContainer.style.display = 'none';

        const url = new URL(window.location.href);
        url.searchParams.set('token', data.token);
        window.history.pushState({}, '', url);

        this.connect(data.token);
      }
    }, 2000);
  }

  connect(token: string): void {
    this.currentToken = token;
    this.encryptionKey = this.extractEncryptionKeyFromToken(token);
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/exec-stream?token=${encodeURIComponent(token)}`;

    this.updateStatus('connecting', 'statusConnecting');
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.updateStatus('connected', 'statusConnected');
      this.reconnectDelay = 1000;
      this.appendMeta(this.t('wsConnected'));
    };

    this.ws.onmessage = async (event) => {
      if (typeof event.data !== 'string') return;
      const message = await this.parseIncomingMessage(event.data);
      this.handleMessage(message);
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
  }

  async parseIncomingMessage(rawData: string): Promise<any> {
    const message = JSON.parse(rawData) as ExecStreamMessage;

    if (message.type === 'compressed') {
      return JSON.parse(this.inflateBase64Payload(message.data));
    }

    if (message.type === 'encrypted') {
      if (!this.encryptionKey) {
        throw new Error('Missing encryption key');
      }
      const decrypted = await this.decrypt(message, this.encryptionKey);
      const envelope = JSON.parse(decrypted) as EncryptedPayloadEnvelope;
      return envelope.compressed
        ? JSON.parse(this.inflateBase64Payload(envelope.payload))
        : JSON.parse(envelope.payload);
    }

    return message;
  }

  inflateBase64Payload(base64: string): string {
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

  extractEncryptionKeyFromToken(token: string | null): string | null {
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

  async decrypt(message: EncryptedWebSocketMessage, keyBase64Url: string): Promise<string> {
    const cryptoApi = window.crypto?.subtle;
    if (!cryptoApi) throw new Error('Web Crypto API is not available');

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

  base64ToBytes(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  base64UrlToBytes(value: string): Uint8Array {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return this.base64ToBytes(padded);
  }

  toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }

  handleMessage(message: any): void {
    switch (message.type as ExecMessageType) {
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
      default:
        break;
    }
  }

  handleAuthSuccess(data: AuthSuccessPayload): void {
    this.appendMeta(data.message || this.t('authSuccess'));
  }

  handleExecStart(data: ExecEvent): void {
    const time = new Date(data.timestamp).toLocaleTimeString();
    this.appendCommand(`$ ${data.command}`, time, data.cwd || '');
    if (data.execId) this.execOutputReceived.set(data.execId, false);
  }

  handleExecOutput(data: ExecEvent): void {
    if (data.execId) this.execOutputReceived.set(data.execId, true);
    if (data.stdout) this.appendOutput(data.stdout);
    if (data.stderr) this.appendOutput(data.stderr, 'error');
  }

  handleExecEnd(data: ExecEvent): void {
    const hasReceivedOutput = data.execId && this.execOutputReceived.get(data.execId);
    if (!hasReceivedOutput) this.handleExecOutput(data);
    if (data.execId) this.execOutputReceived.delete(data.execId);

    const duration = data.duration ? `(${data.duration}ms)` : '';
    const exitCode = data.exitCode !== undefined ? `exit ${data.exitCode}` : '';
    this.appendMeta(this.t('commandEnded', { exitCode, duration }).trim());
  }

  appendCommand(text: string, time: string, cwd: string): void {
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="meta">${time}${cwd ? ' • ' + this.escapeHtml(cwd) : ''}</div>
      <div class="command">${this.escapeHtml(text)}</div>
    `;
    this.terminal.appendChild(div);
  }

  appendOutput(text: string, className = ''): void {
    const div = document.createElement('div');
    div.className = `output ${className}`.trim();
    div.textContent = text;
    this.terminal.appendChild(div);
  }

  appendMeta(text: string): void {
    const div = document.createElement('div');
    div.className = 'meta';
    div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    this.terminal.appendChild(div);
  }

  updateStatus(status: 'connecting' | 'connected' | 'disconnected' | 'waiting', key: string): void {
    this.statusDot.className = 'status-dot';
    if (status === 'connected') this.statusDot.classList.add('connected');
    if (status === 'waiting') this.statusDot.classList.add('waiting');
    this.statusText.dataset.statusKey = key;
    this.statusText.textContent = this.t(key);
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

window.execStreamClient = new ExecStreamClient();

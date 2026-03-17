/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
class ExecStreamClient {
    constructor() {
        this.terminal = document.getElementById('terminal');
        this.statusDot = document.getElementById('statusDot');
        this.statusText = document.getElementById('statusText');
        this.authContainer = document.getElementById('authContainer');
        this.authCode = document.getElementById('authCode');
        this.authTitle = document.getElementById('authTitle');
        this.authHint = document.getElementById('authHint');
        this.copyBtn = document.getElementById('copyBtn');
        this.tabList = document.getElementById('tabList');
        this.addTabBtn = document.getElementById('addTabBtn');
        this.historyBtn = document.getElementById('historyBtn');
        this.lang = localStorage.getItem('exec-stream-lang') === 'en' ? 'en' : 'zh';
        this.theme = localStorage.getItem('exec-stream-theme') === 'light' ? 'light' : 'dark';
        this.tabs = new Map();
        this.activeTabId = null;
        this.editingTabId = null;
        this.messages = {
            zh: {
                pageTitle: 'Exec Stream - OpenClaw 命令监控',
                title: '🖥️ Exec Stream',
                tabDefault: 'Session {index}',
                tabAdd: '+ 新建',
                tabClose: '关闭标签',
                tabRenamePlaceholder: '输入名称',
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
                themeLight: '深色模式',
                terminalEmpty: '这个 Session 还没有命令输出',
                cannotCloseLastTab: '至少保留一个 Session',
                renameEmptyFallback: 'Session {index}'
            },
            en: {
                pageTitle: 'Exec Stream - OpenClaw Command Monitor',
                title: '🖥️ Exec Stream',
                tabDefault: 'Session {index}',
                tabAdd: '+ New',
                tabClose: 'Close tab',
                tabRenamePlaceholder: 'Tab name',
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
                themeLight: 'Dark mode',
                terminalEmpty: 'This session has no command output yet',
                cannotCloseLastTab: 'Keep at least one session',
                renameEmptyFallback: 'Session {index}'
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
        this.bindEvents();
        this.applyTheme();
        this.restoreTabs();
        this.applyLang();
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        if (token && this.activeTabId) {
            const tab = this.getActiveTab();
            if (tab) {
                tab.token = token;
                this.persistTabs();
            }
        }
        this.renderTabs();
        this.renderActiveTab();
        for (const tab of this.tabs.values()) {
            if (tab.token) {
                this.connectTab(tab, tab.token, false);
            }
        }
        const activeTab = this.getActiveTab();
        if (activeTab && !activeTab.token) {
            await this.ensureAuthCode(activeTab);
        }
    }
    bindEvents() {
        this.addTabBtn.addEventListener('click', () => {
            const tab = this.createTab();
            this.switchTab(tab.id);
        });
        this.copyBtn.addEventListener('click', () => this.copyAuthCode());
    }
    restoreTabs() {
        let restored = [];
        try {
            const raw = localStorage.getItem(ExecStreamClient.STORAGE_KEY);
            if (raw)
                restored = JSON.parse(raw);
        }
        catch {
            restored = [];
        }
        if (restored.length === 0) {
            const tab = this.createTab(false);
            this.activeTabId = tab.id;
            this.persistTabs();
            return;
        }
        restored.forEach((item, index) => {
            const tab = {
                id: item.id,
                name: item.name || this.defaultTabName(index + 1),
                deviceId: item.deviceId,
                token: item.token,
                authCode: item.authCode,
                authInfo: item.authInfo,
                commands: Array.isArray(item.commands) ? item.commands.slice(-ExecStreamClient.MAX_COMMANDS) : [],
                ws: null,
                pollInterval: null,
                reconnectDelay: 1000,
                encryptionKey: item.token ? this.extractEncryptionKeyFromToken(item.token) : null,
                execOutputReceived: {},
                status: item.token ? 'connecting' : 'waiting',
                statusKey: item.token ? 'statusConnecting' : 'statusWaitingAuth'
            };
            this.tabs.set(tab.id, tab);
        });
        const savedActiveTabId = localStorage.getItem(ExecStreamClient.ACTIVE_TAB_STORAGE_KEY);
        this.activeTabId = savedActiveTabId && this.tabs.has(savedActiveTabId)
            ? savedActiveTabId
            : this.tabs.keys().next().value || null;
    }
    persistTabs() {
        const data = Array.from(this.tabs.values()).map((tab) => ({
            id: tab.id,
            name: tab.name,
            deviceId: tab.deviceId,
            token: tab.token,
            authCode: tab.authCode,
            authInfo: tab.authInfo,
            commands: tab.commands.slice(-ExecStreamClient.MAX_COMMANDS)
        }));
        localStorage.setItem(ExecStreamClient.STORAGE_KEY, JSON.stringify(data));
        if (this.activeTabId) {
            localStorage.setItem(ExecStreamClient.ACTIVE_TAB_STORAGE_KEY, this.activeTabId);
        }
    }
    generateTabId() {
        return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    defaultTabName(index) {
        return this.t('tabDefault', { index });
    }
    createTab(shouldPersist = true) {
        const tab = {
            id: this.generateTabId(),
            name: this.defaultTabName(this.tabs.size + 1),
            commands: [],
            ws: null,
            pollInterval: null,
            reconnectDelay: 1000,
            encryptionKey: null,
            execOutputReceived: {},
            status: 'waiting',
            statusKey: 'statusWaitingAuth'
        };
        this.tabs.set(tab.id, tab);
        if (!this.activeTabId)
            this.activeTabId = tab.id;
        if (shouldPersist) {
            this.persistTabs();
            this.renderTabs();
        }
        return tab;
    }
    getActiveTab() {
        return this.activeTabId ? this.tabs.get(this.activeTabId) || null : null;
    }
    async switchTab(tabId) {
        if (!this.tabs.has(tabId))
            return;
        this.activeTabId = tabId;
        this.persistTabs();
        this.renderTabs();
        this.renderActiveTab();
        const tab = this.getActiveTab();
        if (tab && !tab.token) {
            await this.ensureAuthCode(tab);
        }
    }
    closeTab(tabId) {
        if (this.tabs.size <= 1) {
            alert(this.t('cannotCloseLastTab'));
            return;
        }
        const tab = this.tabs.get(tabId);
        if (!tab)
            return;
        this.stopPolling(tab);
        this.cleanupSocket(tab, false);
        this.tabs.delete(tabId);
        if (this.activeTabId === tabId) {
            this.activeTabId = this.tabs.keys().next().value || null;
        }
        this.persistTabs();
        this.renderTabs();
        this.renderActiveTab();
        const activeTab = this.getActiveTab();
        if (activeTab && !activeTab.token) {
            this.ensureAuthCode(activeTab);
        }
    }
    startRenameTab(tabId) {
        this.editingTabId = tabId;
        this.renderTabs();
        const input = this.tabList.querySelector(`input[data-tab-id="${tabId}"]`);
        if (input) {
            input.focus();
            input.select();
        }
    }
    finishRenameTab(tabId, nextName) {
        const tab = this.tabs.get(tabId);
        if (!tab)
            return;
        const index = Array.from(this.tabs.keys()).indexOf(tabId) + 1;
        tab.name = nextName.trim() || this.t('renameEmptyFallback', { index });
        this.editingTabId = null;
        this.persistTabs();
        this.renderTabs();
    }
    renderTabs() {
        this.tabList.innerHTML = '';
        Array.from(this.tabs.values()).forEach((tab) => {
            const item = document.createElement('div');
            item.className = `tab-item${tab.id === this.activeTabId ? ' active' : ''}`;
            item.dataset.tabId = tab.id;
            const button = document.createElement('button');
            button.className = 'tab-button';
            button.type = 'button';
            button.addEventListener('click', () => {
                void this.switchTab(tab.id);
            });
            if (this.editingTabId === tab.id) {
                const input = document.createElement('input');
                input.className = 'tab-input';
                input.value = tab.name;
                input.dataset.tabId = tab.id;
                input.placeholder = this.t('tabRenamePlaceholder');
                input.addEventListener('click', (event) => event.stopPropagation());
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        this.finishRenameTab(tab.id, input.value);
                    }
                    else if (event.key === 'Escape') {
                        this.editingTabId = null;
                        this.renderTabs();
                    }
                });
                input.addEventListener('blur', () => this.finishRenameTab(tab.id, input.value));
                button.appendChild(input);
            }
            else {
                const name = document.createElement('span');
                name.className = 'tab-name';
                name.textContent = tab.name;
                name.title = tab.name;
                name.addEventListener('dblclick', (event) => {
                    event.stopPropagation();
                    this.startRenameTab(tab.id);
                });
                button.appendChild(name);
            }
            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.type = 'button';
            closeBtn.textContent = '×';
            closeBtn.title = this.t('tabClose');
            closeBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                this.closeTab(tab.id);
            });
            item.appendChild(button);
            item.appendChild(closeBtn);
            this.tabList.appendChild(item);
        });
    }
    renderActiveTab() {
        const tab = this.getActiveTab();
        this.terminal.innerHTML = '';
        if (!tab) {
            this.updateStatus('disconnected', 'statusDisconnected');
            this.authContainer.style.display = 'none';
            return;
        }
        this.updateStatus(tab.status, tab.statusKey);
        if (tab.token) {
            this.authContainer.style.display = 'none';
        }
        else {
            this.authContainer.style.display = 'flex';
            this.authCode.textContent = tab.authCode || '------';
        }
        if (tab.commands.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'meta empty-state';
            empty.textContent = this.t('terminalEmpty');
            this.terminal.appendChild(empty);
        }
        else {
            tab.commands.forEach((record) => this.renderCommandRecord(record));
            this.scrollToBottom();
        }
        this.syncUrlToken(tab.token || null);
    }
    renderCommandRecord(record) {
        if (record.type === 'command') {
            const div = document.createElement('div');
            div.innerHTML = `
        <div class="meta">${record.time || ''}${record.cwd ? ' • ' + this.escapeHtml(record.cwd) : ''}</div>
        <div class="command">${this.escapeHtml(record.text)}</div>
      `;
            this.terminal.appendChild(div);
            return;
        }
        if (record.type === 'meta') {
            const div = document.createElement('div');
            div.className = 'meta';
            div.textContent = record.text;
            this.terminal.appendChild(div);
            return;
        }
        const normalized = String(record.text ?? '');
        const lineCount = record.lineCount ?? (normalized === '' ? 0 : normalized.split(/\r?\n/).length);
        const maxLines = 10;
        if (lineCount > maxLines) {
            const container = document.createElement('div');
            container.className = `output-container ${record.className || ''}`.trim();
            const outputDiv = document.createElement('div');
            outputDiv.className = `output ${record.className || ''} collapsible${record.expanded ? '' : ' collapsed'}`.trim();
            outputDiv.textContent = normalized;
            outputDiv.style.maxHeight = record.expanded ? 'none' : `${maxLines * 1.6}em`;
            outputDiv.style.overflow = 'hidden';
            const toggleBtn = document.createElement('button');
            toggleBtn.className = 'toggle-btn';
            toggleBtn.dataset.lines = String(lineCount);
            toggleBtn.dataset.expanded = String(Boolean(record.expanded));
            toggleBtn.textContent = record.expanded ? this.t('collapse') : this.t('expandAll', { count: lineCount });
            toggleBtn.onclick = () => {
                record.expanded = toggleBtn.dataset.expanded !== 'true';
                if (record.expanded) {
                    outputDiv.style.maxHeight = 'none';
                    outputDiv.classList.remove('collapsed');
                }
                else {
                    outputDiv.style.maxHeight = `${maxLines * 1.6}em`;
                    outputDiv.classList.add('collapsed');
                }
                toggleBtn.dataset.expanded = String(Boolean(record.expanded));
                toggleBtn.textContent = record.expanded ? this.t('collapse') : this.t('expandAll', { count: lineCount });
                this.persistTabs();
                this.scrollToBottom();
            };
            container.appendChild(outputDiv);
            container.appendChild(toggleBtn);
            this.terminal.appendChild(container);
            return;
        }
        const div = document.createElement('div');
        div.className = `output ${record.className || ''}`.trim();
        div.textContent = normalized;
        this.terminal.appendChild(div);
    }
    async ensureAuthCode(tab) {
        if (tab.token || tab.authCode) {
            if (tab.id === this.activeTabId) {
                this.authCode.textContent = tab.authCode || '------';
                this.authContainer.style.display = 'flex';
            }
            return;
        }
        try {
            const response = await fetch('/exec-stream/auth/code');
            const data = await response.json();
            tab.deviceId = data.deviceId;
            tab.authCode = data.code;
            tab.authInfo = `/exec-stream auth ${data.code}`;
            tab.status = 'waiting';
            tab.statusKey = 'statusWaitingAuth';
            this.persistTabs();
            if (tab.id === this.activeTabId) {
                this.authCode.textContent = data.code;
                this.authContainer.style.display = 'flex';
                this.updateStatus('waiting', 'statusWaitingAuth');
            }
            this.startPolling(tab);
        }
        catch (error) {
            this.appendToTab(tab, {
                type: 'output',
                text: this.t('fetchAuthCodeFailed', { message: error.message }),
                className: 'error'
            });
        }
    }
    startPolling(tab) {
        if (tab.pollInterval || !tab.deviceId)
            return;
        tab.pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/exec-stream/auth/status?deviceId=${encodeURIComponent(tab.deviceId || '')}`);
                const data = await response.json();
                if (data.authorized && data.token) {
                    this.stopPolling(tab);
                    tab.token = data.token;
                    tab.authCode = undefined;
                    tab.authInfo = undefined;
                    tab.encryptionKey = this.extractEncryptionKeyFromToken(data.token);
                    this.persistTabs();
                    if (tab.id === this.activeTabId) {
                        this.authContainer.style.display = 'none';
                    }
                    this.connectTab(tab, data.token, true);
                }
            }
            catch (error) {
                console.error('Poll error:', error);
            }
        }, 2000);
    }
    stopPolling(tab) {
        if (tab.pollInterval) {
            clearInterval(tab.pollInterval);
            tab.pollInterval = null;
        }
    }
    connectTab(tab, token, announce = true) {
        this.cleanupSocket(tab, false);
        tab.token = token;
        tab.encryptionKey = this.extractEncryptionKeyFromToken(token);
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/exec-stream?token=${encodeURIComponent(token)}`;
        tab.status = 'connecting';
        tab.statusKey = 'statusConnecting';
        if (tab.id === this.activeTabId)
            this.updateStatus('connecting', 'statusConnecting');
        try {
            tab.ws = new WebSocket(wsUrl);
            tab.ws.onopen = () => {
                tab.status = 'connected';
                tab.statusKey = 'statusConnected';
                tab.reconnectDelay = 1000;
                if (announce) {
                    this.appendMetaToTab(tab, this.t('wsConnected'));
                }
                if (tab.id === this.activeTabId)
                    this.updateStatus('connected', 'statusConnected');
                this.persistTabs();
            };
            tab.ws.onmessage = async (event) => {
                try {
                    if (typeof event.data !== 'string')
                        return;
                    const message = await this.parseIncomingMessage(event.data, tab.encryptionKey || null);
                    this.handleMessage(tab, message);
                }
                catch (error) {
                    console.error('Parse message error:', error);
                }
            };
            tab.ws.onclose = (event) => {
                tab.ws = null;
                tab.status = 'disconnected';
                tab.statusKey = 'statusDisconnected';
                if (tab.id === this.activeTabId)
                    this.updateStatus('disconnected', 'statusDisconnected');
                if (event.code === 1008) {
                    this.appendOutputToTab(tab, this.t('authFailed', { reason: event.reason }), 'error');
                    tab.token = undefined;
                    tab.encryptionKey = null;
                    tab.deviceId = undefined;
                    tab.authCode = undefined;
                    tab.authInfo = undefined;
                    this.persistTabs();
                    void this.ensureAuthCode(tab);
                }
                else if (tab.token) {
                    this.appendMetaToTab(tab, this.t('wsDisconnected'));
                    window.setTimeout(() => {
                        if (!this.tabs.has(tab.id) || !tab.token || tab.ws)
                            return;
                        this.connectTab(tab, tab.token, false);
                    }, tab.reconnectDelay);
                    tab.reconnectDelay = Math.min(tab.reconnectDelay * 2, 30000);
                }
            };
            tab.ws.onerror = () => {
                this.appendOutputToTab(tab, this.t('connectError'), 'error');
            };
        }
        catch (error) {
            this.appendOutputToTab(tab, this.t('connectFailed', { message: error.message }), 'error');
        }
    }
    cleanupSocket(tab, preserveToken = true) {
        if (tab.ws) {
            tab.ws.onopen = null;
            tab.ws.onmessage = null;
            tab.ws.onclose = null;
            tab.ws.onerror = null;
            tab.ws.close();
            tab.ws = null;
        }
        if (!preserveToken) {
            tab.token = undefined;
            tab.encryptionKey = null;
        }
    }
    async parseIncomingMessage(rawData, encryptionKey) {
        const message = JSON.parse(rawData);
        if (message.type === 'compressed') {
            return JSON.parse(this.inflateBase64Payload(message.data));
        }
        if (message.type === 'encrypted') {
            if (!encryptionKey)
                throw new Error('Missing encryption key');
            const decrypted = await this.decrypt(message, encryptionKey);
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
        if (!token)
            return null;
        const parts = token.split('.');
        if (parts.length < 2)
            return null;
        try {
            const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
            const payload = JSON.parse(atob(padded));
            return typeof payload.encKey === 'string' ? payload.encKey : null;
        }
        catch {
            return null;
        }
    }
    async decrypt(message, keyBase64Url) {
        const cryptoApi = window.crypto?.subtle;
        if (!cryptoApi)
            throw new Error('Web Crypto API is not available');
        const key = await cryptoApi.importKey('raw', this.toArrayBuffer(this.base64UrlToBytes(keyBase64Url)), { name: 'AES-GCM' }, false, ['decrypt']);
        const encryptedBytes = this.base64ToBytes(message.data);
        const authTagBytes = this.base64ToBytes(message.authTag);
        const combined = new Uint8Array(encryptedBytes.length + authTagBytes.length);
        combined.set(encryptedBytes, 0);
        combined.set(authTagBytes, encryptedBytes.length);
        const decrypted = await cryptoApi.decrypt({
            name: 'AES-GCM',
            iv: this.toArrayBuffer(this.base64ToBytes(message.iv)),
            tagLength: 128
        }, key, this.toArrayBuffer(combined));
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
    handleMessage(tab, message) {
        switch (message.type) {
            case 'exec_start':
                this.handleExecStart(tab, message.data);
                break;
            case 'exec_output':
                this.handleExecOutput(tab, message.data);
                break;
            case 'exec_end':
                this.handleExecEnd(tab, message.data);
                break;
            case 'auth_success':
                this.handleAuthSuccess(tab, message.data);
                break;
            default:
                break;
        }
    }
    handleAuthSuccess(tab, data) {
        this.appendMetaToTab(tab, data.message || this.t('authSuccess'));
    }
    handleExecStart(tab, data) {
        const time = new Date(data.timestamp).toLocaleTimeString();
        this.appendCommandToTab(tab, `$ ${data.command}`, time, data.cwd || '');
        if (data.execId)
            tab.execOutputReceived[data.execId] = false;
    }
    handleExecOutput(tab, data) {
        if (data.execId)
            tab.execOutputReceived[data.execId] = true;
        if (data.stdout)
            this.appendOutputToTab(tab, data.stdout);
        if (data.stderr)
            this.appendOutputToTab(tab, data.stderr, 'error');
    }
    handleExecEnd(tab, data) {
        const hasReceivedOutput = data.execId ? tab.execOutputReceived[data.execId] : false;
        if (!hasReceivedOutput)
            this.handleExecOutput(tab, data);
        if (data.execId)
            delete tab.execOutputReceived[data.execId];
        const duration = data.duration ? `(${data.duration}ms)` : '';
        const exitCode = data.exitCode !== undefined ? `exit ${data.exitCode}` : '';
        this.appendMetaToTab(tab, this.t('commandEnded', { exitCode, duration }).trim());
    }
    appendToTab(tab, record) {
        tab.commands.push(record);
        if (tab.commands.length > ExecStreamClient.MAX_COMMANDS) {
            tab.commands = tab.commands.slice(-ExecStreamClient.MAX_COMMANDS);
        }
        this.persistTabs();
        if (tab.id === this.activeTabId) {
            if (this.terminal.querySelector('.empty-state')) {
                this.terminal.innerHTML = '';
            }
            this.renderCommandRecord(record);
            this.scrollToBottom();
        }
    }
    appendCommandToTab(tab, text, time, cwd) {
        this.appendToTab(tab, { type: 'command', text, time, cwd });
    }
    appendOutputToTab(tab, text, className = '') {
        const normalized = String(text ?? '');
        this.appendToTab(tab, {
            type: 'output',
            text: normalized,
            className,
            lineCount: normalized === '' ? 0 : normalized.split(/\r?\n/).length,
            expanded: false
        });
    }
    appendMetaToTab(tab, text) {
        this.appendToTab(tab, { type: 'meta', text: `[${new Date().toLocaleTimeString()}] ${text}` });
    }
    copyAuthCode() {
        const tab = this.getActiveTab();
        if (!tab || !tab.authInfo) {
            alert(this.t('authNotReady'));
            return;
        }
        const text = tab.authInfo;
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                this.showCopySuccess();
            }).catch(() => {
                this.copyWithFallback(text);
            });
            return;
        }
        this.copyWithFallback(text);
    }
    copyWithFallback(text) {
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
                this.showCopySuccess();
            }
            else {
                alert(this.t('authCopyFailed') + text);
            }
        }
        catch {
            alert(this.t('authCopyFailed') + text);
        }
        document.body.removeChild(textarea);
    }
    showCopySuccess() {
        const originalText = this.t('authCopy');
        this.copyBtn.dataset.copied = 'true';
        this.copyBtn.textContent = this.t('authCopied');
        this.copyBtn.style.background = '#1177bb';
        window.setTimeout(() => {
            this.copyBtn.textContent = originalText;
            this.copyBtn.style.background = '';
            delete this.copyBtn.dataset.copied;
        }, 2000);
    }
    async loadHistory() {
        try {
            const response = await fetch('/exec-stream/commands');
            const data = await response.json();
            const tab = this.getActiveTab();
            if (!tab)
                return;
            if (!data.commands.length) {
                this.appendMetaToTab(tab, this.t('historyEmpty'));
                return;
            }
            this.appendMetaToTab(tab, this.t('historyLoaded', { count: data.commands.length }));
            data.commands.forEach((cmd) => {
                const time = new Date(cmd.timestamp).toLocaleTimeString();
                this.appendCommandToTab(tab, `$ ${cmd.command}`, time, cmd.cwd || '');
                if (cmd.stdout)
                    this.appendOutputToTab(tab, cmd.stdout);
                if (cmd.stderr)
                    this.appendOutputToTab(tab, cmd.stderr, 'error');
                const duration = cmd.duration ? `(${cmd.duration}ms)` : '';
                const exitCode = cmd.exitCode !== undefined ? `exit ${cmd.exitCode}` : '';
                this.appendMetaToTab(tab, `${this.t('commandEnded', { exitCode, duration }).trim()} [${this.t('historyTag')}]`);
            });
        }
        catch (error) {
            alert(this.t('loadHistoryFailed', { message: error.message }));
        }
    }
    updateStatus(status, key) {
        this.statusDot.className = 'status-dot';
        if (status === 'connected')
            this.statusDot.classList.add('connected');
        if (status === 'waiting')
            this.statusDot.classList.add('waiting');
        this.statusText.dataset.statusKey = key;
        this.statusText.textContent = this.t(key);
    }
    syncUrlToken(token) {
        const url = new URL(window.location.href);
        if (token) {
            url.searchParams.set('token', token);
        }
        else {
            url.searchParams.delete('token');
        }
        window.history.replaceState({}, '', url);
    }
    toggleTheme() {
        this.theme = this.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem('exec-stream-theme', this.theme);
        this.applyTheme();
    }
    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.theme);
        const btn = document.getElementById('themeBtn');
        if (!btn)
            return;
        btn.textContent = this.theme === 'light' ? '🌙' : '☀️';
        btn.title = this.theme === 'light' ? this.t('themeLight') : this.t('themeDark');
    }
    toggleLang() {
        this.lang = this.lang === 'zh' ? 'en' : 'zh';
        localStorage.setItem('exec-stream-lang', this.lang);
        this.applyLang();
        this.renderTabs();
        this.renderActiveTab();
    }
    applyLang() {
        document.documentElement.lang = this.lang === 'zh' ? 'zh-CN' : 'en';
        document.title = this.t('pageTitle');
        const title = document.querySelector('.header h1');
        if (title)
            title.textContent = this.t('title');
        const langBtn = document.getElementById('langBtn');
        if (langBtn)
            langBtn.textContent = this.lang === 'zh' ? 'EN' : '中文';
        this.historyBtn.textContent = this.t('historyBtn');
        this.authTitle.textContent = this.t('authTitle');
        this.authHint.textContent = this.t('authHint');
        if (!this.copyBtn.dataset.copied) {
            this.copyBtn.textContent = this.t('authCopy');
        }
        this.addTabBtn.textContent = this.t('tabAdd');
        this.applyTheme();
        const currentStatus = this.statusText.dataset.statusKey;
        if (currentStatus)
            this.statusText.textContent = this.t(currentStatus);
        const toggleButtons = document.querySelectorAll('.toggle-btn[data-lines]');
        toggleButtons.forEach((btn) => {
            const expanded = btn.dataset.expanded === 'true';
            const lineCount = Number(btn.dataset.lines || 0);
            btn.textContent = expanded ? this.t('collapse') : this.t('expandAll', { count: lineCount });
        });
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
ExecStreamClient.STORAGE_KEY = 'exec-stream-tabs';
ExecStreamClient.ACTIVE_TAB_STORAGE_KEY = 'exec-stream-active-tab';
ExecStreamClient.MAX_COMMANDS = 120;
window.execStreamClient = new ExecStreamClient();
window.copyAuthCode = () => window.execStreamClient?.copyAuthCode();
window.toggleTheme = () => window.execStreamClient?.toggleTheme();
window.toggleLang = () => window.execStreamClient?.toggleLang();
window.loadHistory = async () => { await window.execStreamClient?.loadHistory(); };

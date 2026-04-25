let isConnected = false;
let isActive = false;
let currentTabId = null;

const statusIndicator = document.getElementById('statusIndicator');
const statusText = statusIndicator.querySelector('.status-text');
const enableBotCheckbox = document.getElementById('enableBot');
const autoAttackCheckbox = document.getElementById('autoAttack');
const autoLootCheckbox = document.getElementById('autoLoot');
const antiAFKCheckbox = document.getElementById('antiAFK');
const healthValue = document.getElementById('healthValue');
const monsterCount = document.getElementById('monsterCount');
const lootCount = document.getElementById('lootCount');
const killCount = document.getElementById('killCount');
const attackIntervalInput = document.getElementById('attackInterval');
const moveSpeedInput = document.getElementById('moveSpeed');
const moveSpeedValue = document.getElementById('moveSpeedValue');
const lootRadiusInput = document.getElementById('lootRadius');
const healthThresholdInput = document.getElementById('healthThreshold');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const resetStatsBtn = document.getElementById('resetStatsBtn');
const logContainer = document.getElementById('logContainer');

function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;

    if (logContainer.children.length > 100) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

function updateStatus(status) {
    statusIndicator.className = 'status-indicator';
    if (status === 'connected') {
        statusIndicator.classList.add('connected');
        statusText.textContent = '已连接';
        addLog('已连接到游戏页面', 'success');
    } else if (status === 'active') {
        statusIndicator.classList.add('active');
        statusText.textContent = '运行中';
        addLog('机器人已启动', 'success');
    } else if (status === 'error') {
        statusIndicator.classList.add('error');
        statusText.textContent = '错误';
        addLog('连接出错', 'error');
    } else {
        statusText.textContent = '未连接';
    }
}

function updateGameState(state) {
    if (state.health !== undefined) {
        healthValue.textContent = state.health + '%';
        healthValue.className = 'info-value';
        if (state.health < 30) {
            healthValue.classList.add('health-low');
        } else if (state.health < 60) {
            healthValue.classList.add('health-medium');
        } else {
            healthValue.classList.add('health-high');
        }
    }
    if (state.monsters !== undefined) {
        monsterCount.textContent = state.monsters;
    }
    if (state.loot !== undefined) {
        lootCount.textContent = state.loot;
    }
    if (state.kills !== undefined) {
        killCount.textContent = state.kills;
    }
}

function getSettings() {
    return {
        enabled: enableBotCheckbox.checked,
        autoAttack: autoAttackCheckbox.checked,
        autoLoot: autoLootCheckbox.checked,
        antiAFK: antiAFKCheckbox.checked,
        attackInterval: parseInt(attackIntervalInput.value) || 500,
        moveSpeed: parseInt(moveSpeedInput.value) || 5,
        lootRadius: parseInt(lootRadiusInput.value) || 100,
        healthThreshold: parseInt(healthThresholdInput.value) || 30
    };
}

async function sendMessageToContent(message) {
    if (currentTabId) {
        try {
            const response = await chrome.tabs.sendMessage(currentTabId, message);
            return response;
        } catch (e) {
            addLog('发送消息失败: ' + e.message, 'error');
            return null;
        }
    }
    return null;
}

async function checkCurrentTab() {
    try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]) {
            const url = tabs[0].url || '';
            if (url.includes('florr.io')) {
                currentTabId = tabs[0].id;
                isConnected = true;
                updateStatus('connected');
                addLog('检测到 Florr.io 游戏页面', 'info');

                const savedSettings = await chrome.storage.local.get(['florrBotSettings']);
                if (savedSettings.florrBotSettings) {
                    const settings = savedSettings.florrBotSettings;
                    enableBotCheckbox.checked = settings.enabled || false;
                    autoAttackCheckbox.checked = settings.autoAttack !== false;
                    autoLootCheckbox.checked = settings.autoLoot !== false;
                    antiAFKCheckbox.checked = settings.antiAFK !== false;
                    attackIntervalInput.value = settings.attackInterval || 500;
                    moveSpeedInput.value = settings.moveSpeed || 5;
                    moveSpeedValue.textContent = settings.moveSpeed || 5;
                    lootRadiusInput.value = settings.lootRadius || 100;
                    healthThresholdInput.value = settings.healthThreshold || 30;
                }

                const state = await sendMessageToContent({ type: 'GET_STATE' });
                if (state) {
                    updateGameState(state);
                }
            } else {
                isConnected = false;
                updateStatus('default');
                addLog('请打开 florr.io 页面', 'warning');
            }
        }
    } catch (e) {
        addLog('检查标签页失败: ' + e.message, 'error');
    }
}

async function startBot() {
    if (!isConnected) {
        addLog('未连接到游戏页面，无法启动', 'error');
        return;
    }

    const settings = getSettings();
    await chrome.storage.local.set({ florrBotSettings: settings });

    const response = await sendMessageToContent({
        type: 'START',
        settings: settings
    });

    if (response && response.success) {
        isActive = true;
        updateStatus('active');
        startBtn.disabled = true;
        stopBtn.disabled = false;
        addLog('机器人已启动', 'success');
    } else {
        addLog('启动失败: ' + (response?.error || '未知错误'), 'error');
    }
}

async function stopBot() {
    const response = await sendMessageToContent({ type: 'STOP' });

    if (response && response.success) {
        isActive = false;
        updateStatus('connected');
        startBtn.disabled = false;
        stopBtn.disabled = true;
        addLog('机器人已停止', 'info');
    }
}

async function resetStats() {
    const response = await sendMessageToContent({ type: 'RESET_STATS' });
    if (response && response.success) {
        killCount.textContent = '0';
        addLog('统计数据已重置', 'info');
    }
}

moveSpeedInput.addEventListener('input', async () => {
    moveSpeedValue.textContent = moveSpeedInput.value;
    const settings = getSettings();
    await chrome.storage.local.set({ florrBotSettings: settings });
    if (isActive) {
        await sendMessageToContent({ type: 'UPDATE_SETTINGS', settings: settings });
    }
});

[enableBotCheckbox, autoAttackCheckbox, autoLootCheckbox, antiAFKCheckbox,
 attackIntervalInput, lootRadiusInput, healthThresholdInput].forEach(el => {
    el.addEventListener('change', async () => {
        const settings = getSettings();
        await chrome.storage.local.set({ florrBotSettings: settings });
        if (isActive) {
            await sendMessageToContent({ type: 'UPDATE_SETTINGS', settings: settings });
        }
    });
});

startBtn.addEventListener('click', startBot);
stopBtn.addEventListener('click', stopBot);
resetStatsBtn.addEventListener('click', resetStats);

document.getElementById('viewGuideBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.florr.io' });
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'GAME_STATE_UPDATE') {
        updateGameState(message.state);
    } else if (message.type === 'LOG') {
        addLog(message.message, message.level || 'info');
    }
});

checkCurrentTab();

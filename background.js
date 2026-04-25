let activeTabId = null;
let lastActivityTime = Date.now();
let isFlorrIOPage = false;

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({
        florrBotSettings: {
            enabled: false,
            autoAttack: true,
            autoLoot: true,
            antiAFK: true,
            attackInterval: 500,
            moveSpeed: 5,
            lootRadius: 100,
            healthThreshold: 30
        }
    });
    console.log('[Florr Bot] Extension installed');
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        const url = tab.url;
        if (url.includes('florr.io')) {
            isFlorrIOPage = true;
            activeTabId = tabId;
            console.log('[Florr Bot] Florr.io page detected, tab:', tabId);
            chrome.runtime.sendMessage({
                type: 'LOG',
                message: '检测到 Florr.io 游戏页面',
                level: 'info'
            });
        } else {
            if (activeTabId === tabId) {
                isFlorrIOPage = false;
                activeTabId = null;
            }
        }
    }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab.url && tab.url.includes('florr.io')) {
            isFlorrIOPage = true;
            activeTabId = activeInfo.tabId;
        } else {
            isFlorrIOPage = false;
        }
    } catch (e) {
        console.error('[Florr Bot] Error checking tab:', e);
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'LOG') {
        console.log(`[Florr Bot ${message.level || 'info'}] ${message.message}`);
    } else if (message.type === 'ACTIVITY') {
        lastActivityTime = Date.now();
    } else if (message.type === 'GET_STATUS') {
        sendResponse({
            isActive: isFlorrIOPage,
            tabId: activeTabId,
            lastActivity: lastActivityTime
        });
    }
    return true;
});

console.log('[Florr Bot] Background service worker started');

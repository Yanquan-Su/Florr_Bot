(function() {
    'use strict';

    const CONFIG = {
        attackInterval: 500,
        moveSpeed: 5,
        lootRadius: 100,
        healthThreshold: 30,
        afkCheckInterval: 30000,
        imageScanInterval: 100,
        maxRetries: 3
    };

    let state = {
        enabled: false,
        autoAttack: true,
        autoLoot: true,
        antiAFK: true,
        isRunning: false,
        health: 100,
        monsterCount: 0,
        lootCount: 0,
        killCount: 0,
        lastAction: Date.now(),
        afkDetected: false,
        gameCanvas: null,
        gameContext: null,
        playerPos: { x: 0, y: 0 },
        monstersTracked: [],
        lootTracked: [],
        lastMonsterCheck: 0,
        lastLootCheck: 0
    };

    let animationFrameId = null;
    let scanIntervalId = null;

    function log(message, level = 'info') {
        console.log(`[Florr Bot ${level}] ${message}`);
        try {
            chrome.runtime.sendMessage({
                type: 'LOG',
                message: message,
                level: level
            });
        } catch (e) {
            // Extension context may not be available
        }
    }

    function findGameCanvas() {
        const canvas = document.querySelector('canvas');
        if (canvas) {
            state.gameCanvas = canvas;
            state.gameContext = canvas.getContext('2d');
            log('Game canvas found', 'success');
            return true;
        }
        return false;
    }

    function getCanvasImageData() {
        if (!state.gameCanvas || !state.gameContext) return null;
        try {
            return state.gameContext.getImageData(0, 0, state.gameCanvas.width, state.gameCanvas.height);
        } catch (e) {
            return null;
        }
    }

    function detectColorMatches(imageData, targetColor, threshold = 30) {
        if (!imageData) return [];
        const matches = [];
        const data = imageData.data;
        const width = imageData.width;
        const height = imageData.height;

        for (let y = 0; y < height; y += 4) {
            for (let x = 0; x < width; x += 4) {
                const idx = (y * width + x) * 4;
                const r = data[idx];
                const g = data[idx + 1];
                const b = data[idx + 2];

                if (Math.abs(r - targetColor.r) < threshold &&
                    Math.abs(g - targetColor.g) < threshold &&
                    Math.abs(b - targetColor.b) < threshold) {
                    matches.push({ x, y, r, g, b });
                }
            }
        }
        return matches;
    }

    function findMonsters(imageData) {
        const monsterColors = [
            { r: 139, g: 69, b: 19 },
            { r: 255, g: 0, b: 0 },
            { r: 128, g: 0, b: 128 },
            { r: 0, g: 128, b: 0 }
        ];

        let allMonsters = [];
        for (const color of monsterColors) {
            const matches = detectColorMatches(imageData, color, 40);
            allMonsters = allMonsters.concat(matches);
        }

        return clusterPoints(allMonsters, 30);
    }

    function findLoot(imageData) {
        const lootColors = [
            { r: 255, g: 215, b: 0 },
            { r: 255, g: 255, b: 0 },
            { r: 192, g: 192, b: 192 },
            { r: 218, g: 165, b: 32 }
        ];

        let allLoot = [];
        for (const color of lootColors) {
            const matches = detectColorMatches(imageData, color, 35);
            allLoot = allLoot.concat(matches);
        }

        return clusterPoints(allLoot, 20);
    }

    function findPlayer(imageData) {
        const playerColor = { r: 255, g: 105, b: 180 };
        const matches = detectColorMatches(imageData, playerColor, 30);
        if (matches.length > 0) {
            const cluster = clusterPoints(matches, 15);
            if (cluster.length > 0) {
                return cluster[0];
            }
        }
        return { x: state.gameCanvas?.width / 2 || 0, y: state.gameCanvas?.height / 2 || 0 };
    }

    function detectHealthBar(imageData) {
        const healthBarColor = { r: 255, g: 0, b: 0 };
        const matches = detectColorMatches(imageData, healthBarColor, 20);

        if (matches.length > 0) {
            const healthPixels = matches.length;
            state.health = Math.min(100, Math.round(healthPixels / 10));
        }

        return state.health;
    }

    function clusterPoints(points, minDistance) {
        if (points.length === 0) return [];

        const clusters = [];
        const used = new Set();

        for (let i = 0; i < points.length; i++) {
            if (used.has(i)) continue;

            const cluster = [points[i]];
            used.add(i);

            for (let j = i + 1; j < points.length; j++) {
                if (used.has(j)) continue;

                const dist = Math.sqrt(
                    Math.pow(points[j].x - points[i].x, 2) +
                    Math.pow(points[j].y - points[i].y, 2)
                );

                if (dist < minDistance * 5) {
                    cluster.push(points[j]);
                    used.add(j);
                }
            }

            const centerX = cluster.reduce((sum, p) => sum + p.x, 0) / cluster.length;
            const centerY = cluster.reduce((sum, p) => sum + p.y, 0) / cluster.length;
            clusters.push({ x: centerX, y: centerY, count: cluster.length });
        }

        return clusters;
    }

    function trackMonsters(currentMonsters) {
        const now = Date.now();
        
        if (now - state.lastMonsterCheck < 1000) {
            return;
        }

        const aliveMonsters = [];
        let newKills = 0;

        state.monstersTracked.forEach(trackedMonster => {
            const stillAlive = currentMonsters.some(currentMonster => {
                const dist = Math.sqrt(
                    Math.pow(currentMonster.x - trackedMonster.x, 2) +
                    Math.pow(currentMonster.y - trackedMonster.y, 2)
                );
                return dist < 50;
            });

            if (stillAlive) {
                aliveMonsters.push(trackedMonster);
            } else {
                newKills++;
            }
        });

        currentMonsters.forEach(monster => {
            const isNew = !aliveMonsters.some(tracked => {
                const dist = Math.sqrt(
                    Math.pow(monster.x - tracked.x, 2) +
                    Math.pow(monster.y - tracked.y, 2)
                );
                return dist < 50;
            });

            if (isNew) {
                aliveMonsters.push(monster);
            }
        });

        if (newKills > 0) {
            state.killCount += newKills;
            updateGameState();
            log(`检测到 ${newKills} 个怪物被击杀`, 'success');
        }

        state.monstersTracked = aliveMonsters;
        state.lastMonsterCheck = now;
    }

    function trackLoot(currentLoot) {
        const now = Date.now();
        
        if (now - state.lastLootCheck < 1000) {
            return;
        }

        const remainingLoot = [];

        state.lootTracked.forEach(trackedLoot => {
            const stillExists = currentLoot.some(currentLootItem => {
                const dist = Math.sqrt(
                    Math.pow(currentLootItem.x - trackedLoot.x, 2) +
                    Math.pow(currentLootItem.y - trackedLoot.y, 2)
                );
                return dist < 30;
            });

            if (stillExists) {
                remainingLoot.push(trackedLoot);
            }
        });

        currentLoot.forEach(lootItem => {
            const isNew = !remainingLoot.some(tracked => {
                const dist = Math.sqrt(
                    Math.pow(lootItem.x - tracked.x, 2) +
                    Math.pow(lootItem.y - tracked.y, 2)
                );
                return dist < 30;
            });

            if (isNew) {
                remainingLoot.push(lootItem);
            }
        });

        state.lootTracked = remainingLoot;
        state.lastLootCheck = now;
    }

    function moveMouse(x, y) {
        const canvas = state.gameCanvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const targetX = rect.left + (x / scaleX);
        const targetY = rect.top + (y / scaleY);

        dispatchMouseEvent('mousemove', targetX, targetY);
        dispatchMouseEvent('mousemove', targetX, targetY, true);
        state.playerPos = { x, y };
        state.lastAction = Date.now();
    }

    function clickAt(x, y) {
        const canvas = state.gameCanvas;
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        const targetX = rect.left + x / scaleX;
        const targetY = rect.top + y / scaleY;

        dispatchMouseEvent('mousedown', targetX, targetY);
        setTimeout(() => {
            dispatchMouseEvent('mouseup', targetX, targetY);
        }, 50);
        state.lastAction = Date.now();
    }

    function dispatchMouseEvent(type, clientX, clientY, force = false) {
        const event = new MouseEvent(type, {
            clientX: clientX,
            clientY: clientY,
            bubbles: true,
            cancelable: true,
            view: window,
            force: force
        });
        if (state.gameCanvas) {
            state.gameCanvas.dispatchEvent(event);
        }
        document.dispatchEvent(event);
    }

    function simulateHumanMovement(targetX, targetY) {
        const currentX = state.playerPos.x || state.gameCanvas?.width / 2;
        const currentY = state.playerPos.y || state.gameCanvas?.height / 2;

        const distance = Math.sqrt(
            Math.pow(targetX - currentX, 2) +
            Math.pow(targetY - currentY, 2)
        );

        const steps = Math.max(2, Math.min(5, Math.ceil(distance / 100)));
        let step = 0;

        const moveStep = () => {
            if (step >= steps) {
                moveMouse(targetX, targetY);
                return;
            }

            const progress = step / steps;
            const easeProgress = 1 - Math.pow(1 - progress, 3);

            const intermediateX = currentX + (targetX - currentX) * easeProgress + (Math.random() - 0.5) * 5;
            const intermediateY = currentY + (targetY - currentY) * easeProgress + (Math.random() - 0.5) * 5;

            moveMouse(intermediateX, intermediateY);
            step++;

            setTimeout(moveStep, 20 + Math.random() * 30);
        };

        moveStep();
    }

    function attackMonster(monster) {
        if (!state.autoAttack) return;
        if (state.health < CONFIG.healthThreshold) {
            log('生命值过低，暂停攻击', 'warning');
            return;
        }

        simulateHumanMovement(monster.x, monster.y);
        setTimeout(() => {
            clickAt(monster.x, monster.y);
            log(`攻击怪物 at (${Math.round(monster.x)}, ${Math.round(monster.y)})`);
        }, 300);
    }

    function collectLoot(loot) {
        if (!state.autoLoot) return;

        simulateHumanMovement(loot.x, loot.y);
        setTimeout(() => {
            clickAt(loot.x, loot.y);
            state.lootCount++;
            updateGameState();
            log(`拾取掉落物 at (${Math.round(loot.x)}, ${Math.round(loot.y)})`);
        }, 200);
    }

    function detectAFKChallenge() {
        const afkIndicators = [
            '验证',
            '验证',
            '人机验证',
            '点击圆圈',
            '拖动',
            '滑动',
            '完成验证'
        ];

        for (const indicator of afkIndicators) {
            const elements = document.querySelectorAll('*');
            for (const el of elements) {
                if (el.childNodes.length === 1 && el.textContent.includes(indicator)) {
                    return true;
                }
            }
        }

        const canvas = state.gameCanvas;
        if (canvas) {
            const imageData = getCanvasImageData();
            if (imageData) {
                const grayPixels = detectColorMatches(imageData, { r: 200, g: 200, b: 200 }, 50);
                if (grayPixels.length > 500) {
                    return true;
                }
            }
        }

        return false;
    }

    function solveAFKChallenge() {
        log('检测到挂机验证，开始解决...', 'warning');

        const dragIndicators = document.querySelectorAll('*');
        for (const el of dragIndicators) {
            const style = window.getComputedStyle(el);
            if (style.cursor === 'grab' || el.textContent.includes('拖动')) {
                const rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    performDragPuzzle(rect);
                    return true;
                }
            }
        }

        const canvas = state.gameCanvas;
        if (canvas) {
            const imageData = getCanvasImageData();
            if (imageData) {
                const grayAreas = detectColorMatches(imageData, { r: 180, g: 180, b: 180 }, 40);
                if (grayAreas.length > 100) {
                    const centerX = grayAreas.reduce((sum, p) => sum + p.x, 0) / grayAreas.length;
                    const centerY = grayAreas.reduce((sum, p) => sum + p.y, 0) / grayAreas.length;

                    simulateHumanMovement(centerX, centerY);
                    setTimeout(() => {
                        clickAt(centerX, centerY);
                        log('点击验证区域中心', 'info');
                    }, 500);
                    return true;
                }
            }
        }

        randomHumanAction();
        return false;
    }

    function performDragPuzzle(startRect) {
        const startX = startRect.left + startRect.width / 2;
        const startY = startRect.top + startRect.height / 2;

        const endX = startX + 100 + Math.random() * 50;
        const endY = startY + (Math.random() - 0.5) * 50;

        const dragEvent = new MouseEvent('mousedown', {
            clientX: startX,
            clientY: startY,
            bubbles: true,
            cancelable: true
        });
        document.dispatchEvent(dragEvent);

        let step = 0;
        const totalSteps = 10;

        const moveStep = () => {
            if (step >= totalSteps) {
                const upEvent = new MouseEvent('mouseup', {
                    clientX: endX,
                    clientY: endY,
                    bubbles: true,
                    cancelable: true
                });
                document.dispatchEvent(upEvent);
                log('拖拽验证完成', 'success');
                state.afkDetected = false;
                return;
            }

            const progress = step / totalSteps;
            const currentX = startX + (endX - startX) * progress + (Math.random() - 0.5) * 5;
            const currentY = startY + (endY - startY) * progress + (Math.random() - 0.5) * 5;

            const moveEvent = new MouseEvent('mousemove', {
                clientX: currentX,
                clientY: currentY,
                bubbles: true,
                cancelable: true
            });
            document.dispatchEvent(moveEvent);
            step++;

            setTimeout(moveStep, 50 + Math.random() * 30);
        };

        setTimeout(moveStep, 100);
    }

    function randomHumanAction() {
        const actions = ['move', 'click', 'wait'];
        const action = actions[Math.floor(Math.random() * actions.length)];

        if (state.gameCanvas) {
            const canvas = state.gameCanvas;
            const x = Math.random() * canvas.width;
            const y = Math.random() * canvas.height;

            switch (action) {
                case 'move':
                    simulateHumanMovement(x, y);
                    break;
                case 'click':
                    clickAt(x, y);
                    break;
                case 'wait':
                    log('执行随机等待动作', 'debug');
                    break;
            }
        }

        state.lastAction = Date.now();
    }

    function updateGameState() {
        try {
            chrome.runtime.sendMessage({
                type: 'GAME_STATE_UPDATE',
                state: {
                    health: state.health,
                    monsters: state.monsterCount,
                    loot: state.lootCount,
                    kills: state.killCount
                }
            });
        } catch (e) {
            // Extension context may not be available
        }
    }

    function gameLoop() {
        if (!state.isRunning) return;

        if (!findGameCanvas()) {
            log('未找到游戏画布', 'error');
            return;
        }

        const imageData = getCanvasImageData();
        if (!imageData) {
            animationFrameId = requestAnimationFrame(gameLoop);
            return;
        }

        const player = findPlayer(imageData);
        state.playerPos = player;

        detectHealthBar(imageData);

        if (state.antiAFK && detectAFKChallenge()) {
            if (!state.afkDetected) {
                state.afkDetected = true;
                solveAFKChallenge();
            }
        }

        const monsters = findMonsters(imageData);
        state.monsterCount = monsters.length;

        trackMonsters(monsters);

        const loot = findLoot(imageData);
        state.lootCount = loot.length;
        
        trackLoot(loot);

        if (state.enabled && state.autoAttack && monsters.length > 0) {
            const closestMonster = monsters.reduce((closest, monster) => {
                const dist = Math.sqrt(
                    Math.pow(monster.x - player.x, 2) +
                    Math.pow(monster.y - player.y, 2)
                );
                const closestDist = closest ?
                    Math.sqrt(
                        Math.pow(closest.x - player.x, 2) +
                        Math.pow(closest.y - player.y, 2)
                    ) : Infinity;
                return dist < closestDist ? monster : closest;
            }, null);

            if (closestMonster) {
                attackMonster(closestMonster);
            }
        }

        if (state.enabled && state.autoLoot && loot.length > 0) {
            const nearbyLoot = loot.filter(l => {
                const dist = Math.sqrt(
                    Math.pow(l.x - player.x, 2) +
                    Math.pow(l.y - player.y, 2)
                );
                return dist < CONFIG.lootRadius;
            });

            if (nearbyLoot.length > 0) {
                const closestLoot = nearbyLoot.reduce((closest, l) => {
                    const dist = Math.sqrt(
                        Math.pow(l.x - player.x, 2) +
                        Math.pow(l.y - player.y, 2)
                    );
                    const closestDist = closest ?
                        Math.sqrt(
                            Math.pow(closest.x - player.x, 2) +
                            Math.pow(closest.y - player.y, 2)
                        ) : Infinity;
                    return dist < closestDist ? l : closest;
                }, null);

                if (closestLoot) {
                    collectLoot(closestLoot);
                }
            }
        }

        if (Date.now() - state.lastAction > CONFIG.afkCheckInterval) {
            randomHumanAction();
        }

        updateGameState();

        animationFrameId = requestAnimationFrame(gameLoop);
    }

    function startBot(settings) {
        if (state.isRunning) {
            log('机器人已在运行', 'warning');
            return { success: true };
        }

        if (!findGameCanvas()) {
            log('未找到游戏画布，无法启动', 'error');
            return { success: false, error: 'Game canvas not found' };
        }

        Object.assign(CONFIG, {
            attackInterval: settings.attackInterval || 500,
            moveSpeed: settings.moveSpeed || 5,
            lootRadius: settings.lootRadius || 100,
            healthThreshold: settings.healthThreshold || 30
        });

        state.enabled = settings.enabled;
        state.autoAttack = settings.autoAttack;
        state.autoLoot = settings.autoLoot;
        state.antiAFK = settings.antiAFK;
        state.isRunning = true;
        state.lastAction = Date.now();

        log('Florr.io Bot 已启动', 'success');
        gameLoop();

        return { success: true };
    }

    function stopBot() {
        state.isRunning = false;
        state.enabled = false;
        state.afkDetected = false;

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        if (scanIntervalId) {
            clearInterval(scanIntervalId);
            scanIntervalId = null;
        }

        log('Florr.io Bot 已停止', 'info');
        return { success: true };
    }

    function resetStats() {
        state.killCount = 0;
        state.lootCount = 0;
        state.health = 100;
        state.monstersTracked = [];
        state.lootTracked = [];
        state.lastMonsterCheck = 0;
        state.lastLootCheck = 0;
        log('统计数据已重置', 'info');
        return { success: true };
    }

    function getState() {
        return {
            health: state.health,
            monsters: state.monsterCount,
            loot: state.lootCount,
            kills: state.killCount,
            isRunning: state.isRunning,
            enabled: state.enabled
        };
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.type) {
            case 'START':
                const startResult = startBot(message.settings);
                sendResponse(startResult);
                break;

            case 'STOP':
                const stopResult = stopBot();
                sendResponse(stopResult);
                break;

            case 'RESET_STATS':
                const resetResult = resetStats();
                sendResponse(resetResult);
                break;

            case 'GET_STATE':
                sendResponse(getState());
                break;

            case 'UPDATE_SETTINGS':
                Object.assign(CONFIG, {
                    attackInterval: message.settings.attackInterval || CONFIG.attackInterval,
                    moveSpeed: message.settings.moveSpeed || CONFIG.moveSpeed,
                    lootRadius: message.settings.lootRadius || CONFIG.lootRadius,
                    healthThreshold: message.settings.healthThreshold || CONFIG.healthThreshold
                });
                state.enabled = message.settings.enabled;
                state.autoAttack = message.settings.autoAttack;
                state.autoLoot = message.settings.autoLoot;
                state.antiAFK = message.settings.antiAFK;
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ error: 'Unknown message type' });
        }
        return true;
    });

    log('Florr.io Bot content script loaded', 'success');

})();

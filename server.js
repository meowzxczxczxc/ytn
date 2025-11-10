const WebSocket = require('ws');
const http = require('http');
const express = require('express');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Статичные файлы
app.use(express.static('public'));

const players = new Map();
const bullets = [];
const powerUps = [];
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;

// Генерация бонусов
function generatePowerUp() {
    if (Math.random() < 0.02) {
        powerUps.push({
            id: Math.random().toString(36).substr(2, 9),
            x: Math.random() * (GAME_WIDTH - 30),
            y: -30,
            type: Math.random() < 0.5 ? 'health' : 'score',
            width: 30,
            height: 30
        });
    }
}

// Обновление игры
function gameLoop() {
    // Обновление пуль
    for (let i = bullets.length - 1; i >= 0; i--) {
        bullets[i].y += bullets[i].speed;
        
        // Проверка выхода за границы
        if (bullets[i].y < 0 || bullets[i].y > GAME_HEIGHT) {
            bullets.splice(i, 1);
            continue;
        }
        
        // Проверка столкновений с игроками
        players.forEach((player, playerId) => {
            if (player.id !== bullets[i].playerId && checkCollision(bullets[i], player)) {
                player.health -= 10;
                bullets.splice(i, 1);
                
                // Отправка обновления здоровья
                broadcast({
                    type: 'playerHit',
                    playerId: player.id,
                    health: player.health
                });
                
                if (player.health <= 0) {
                    // Увеличение счета убийце
                    const killer = players.get(bullets[i].playerId);
                    if (killer) {
                        killer.score += 100;
                        broadcast({
                            type: 'playerKilled',
                            killer: bullets[i].playerId,
                            victim: player.id,
                            killerScore: killer.score
                        });
                    }
                    
                    // Респавн игрока
                    setTimeout(() => {
                        player.health = 100;
                        player.x = Math.random() * (GAME_WIDTH - 50);
                        player.y = GAME_HEIGHT - 100;
                        broadcast({
                            type: 'playerRespawn',
                            playerId: player.id,
                            x: player.x,
                            y: player.y,
                            health: player.health
                        });
                    }, 3000);
                }
            }
        });
    }
    
    // Обновление бонусов
    for (let i = powerUps.length - 1; i >= 0; i--) {
        powerUps[i].y += 2;
        
        if (powerUps[i].y > GAME_HEIGHT) {
            powerUps.splice(i, 1);
            continue;
        }
        
        // Проверка сбора бонусов
        players.forEach((player) => {
            if (checkCollision(player, powerUps[i])) {
                if (powerUps[i].type === 'health') {
                    player.health = Math.min(100, player.health + 20);
                } else {
                    player.score += 50;
                }
                
                broadcast({
                    type: 'powerUpCollected',
                    playerId: player.id,
                    powerUpId: powerUps[i].id,
                    health: player.health,
                    score: player.score
                });
                
                powerUps.splice(i, 1);
            }
        });
    }
    
    generatePowerUp();
    
    // Рассылка состояния игры
    broadcast({
        type: 'gameState',
        players: Array.from(players.values()),
        bullets: bullets,
        powerUps: powerUps
    });
}

function checkCollision(obj1, obj2) {
    return obj1.x < obj2.x + obj2.width &&
           obj1.x + obj1.width > obj2.x &&
           obj1.y < obj2.y + obj2.height &&
           obj1.y + obj1.height > obj2.y;
}

function broadcast(data) {
    const message = JSON.stringify(data);
    players.forEach((player, playerId) => {
        if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    const playerId = Math.random().toString(36).substr(2, 9);
    
    const player = {
        id: playerId,
        ws: ws,
        x: Math.random() * (GAME_WIDTH - 50),
        y: GAME_HEIGHT - 100,
        width: 50,
        height: 70,
        health: 100,
        score: 0,
        color: `hsl(${Math.random() * 360}, 70%, 60%)`,
        name: `Игрок${players.size + 1}`
    };
    
    players.set(playerId, player);
    
    console.log(`Игрок ${playerId} подключился. Всего игроков: ${players.size}`);
    
    // Отправка приветственного сообщения
    ws.send(JSON.stringify({
        type: 'welcome',
        playerId: playerId,
        gameWidth: GAME_WIDTH,
        gameHeight: GAME_HEIGHT
    }));
    
    // Уведомление всех о новом игроке
    broadcast({
        type: 'playerJoined',
        player: player
    });
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'move':
                    if (players.has(playerId)) {
                        const player = players.get(playerId);
                        player.x = Math.max(0, Math.min(GAME_WIDTH - player.width, data.x));
                        player.y = Math.max(0, Math.min(GAME_HEIGHT - player.height, data.y));
                    }
                    break;
                    
                case 'shoot':
                    if (players.has(playerId)) {
                        const player = players.get(playerId);
                        bullets.push({
                            id: Math.random().toString(36).substr(2, 9),
                            playerId: playerId,
                            x: player.x + player.width / 2 - 2,
                            y: player.y,
                            width: 4,
                            height: 10,
                            speed: -8,
                            color: player.color
                        });
                    }
                    break;
                    
                case 'chat':
                    broadcast({
                        type: 'chat',
                        playerId: playerId,
                        playerName: players.get(playerId).name,
                        message: data.message,
                        timestamp: Date.now()
                    });
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    });
    
    ws.on('close', () => {
        players.delete(playerId);
        console.log(`Игрок ${playerId} отключился. Всего игроков: ${players.size}`);
        
        broadcast({
            type: 'playerLeft',
            playerId: playerId
        });
    });
});

// Запуск игрового цикла
setInterval(gameLoop, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});

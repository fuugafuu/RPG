import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static('public'));

const players = new Map(); // socketId -> { id, name, x, y, hp, color }

const randomColor = () => {
  const h = Math.floor(Math.random() * 360);
  return `hsl(${h} 70% 50%)`;
};

io.on('connection', (socket) => {
  const spawn = { x: 5 * 32, y: 5 * 32 };
  const player = {
    id: socket.id,
    name: 'Player-' + (Math.random().toString(36).slice(2, 6)),
    x: spawn.x,
    y: spawn.y,
    hp: 20,
    color: randomColor()
  };
  players.set(socket.id, player);
  socket.emit('init', { id: socket.id, players: Array.from(players.values()) });
  socket.broadcast.emit('playerJoined', player);

  socket.on('move', (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    // 簡易バリデーション
    if (typeof data.x === 'number' && typeof data.y === 'number') {
      p.x = data.x;
      p.y = data.y;
      io.emit('playerMoved', { id: p.id, x: p.x, y: p.y });
    }
  });

  socket.on('setName', (name) => {
    const p = players.get(socket.id);
    if (!p) return;
    if (typeof name === 'string' && name.length <= 20) {
      p.name = name;
      io.emit('playerUpdated', { id: p.id, name: p.name });
    }
  });

  socket.on('chat', (msg) => {
    const p = players.get(socket.id);
    if (!p) return;
    const text = String(msg || '').slice(0, 200);
    io.emit('chat', { from: p.name, text });
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.id);
    players.delete(socket.id);
    io.emit('playerLeft', { id: socket.id, name: p?.name || '' });
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log('Server listening on http://localhost:' + PORT);
});

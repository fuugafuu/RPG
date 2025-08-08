(() => {
  // ====== WebSocket/Socket.IO 接続先の決定 ======
  // 優先順: 1) window.WS_URL  2) URLパラメータ ?ws=  3) 同一オリジン（localhost開発）
  const qs = new URLSearchParams(location.search);
  const WS_URL = (typeof window !== 'undefined' && window.WS_URL) || qs.get('ws') || '';
  // transports 指定でポーリングフォールバック可
  const socket = WS_URL ? io(WS_URL, { transports: ['websocket', 'polling'] }) : io();

  // ====== ユーティリティ ======
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const now = () => performance.now();
  const keymap = {};
  window.addEventListener('keydown', e => { keymap[e.key.toLowerCase()] = true; });
  window.addEventListener('keyup', e => { keymap[e.key.toLowerCase()] = false; });

  // ====== DOM ======
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const chatlog = document.getElementById('chatlog');
  const chatInput = document.getElementById('chatInput');
  const nameInput = document.getElementById('nameInput');
  const setNameBtn = document.getElementById('setNameBtn');

  setNameBtn.onclick = () => {
    socket.emit('setName', nameInput.value.trim());
  };
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const msg = chatInput.value.trim();
      if (msg) socket.emit('chat', msg);
      chatInput.value = '';
    }
  });

  const logLine = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    chatlog.appendChild(div);
    chatlog.scrollTop = chatlog.scrollHeight;
  };

  // ====== ネットワーク ======
  const players = new Map(); // id -> { id, name, x, y, hp, color }
  let myId = null;

  socket.on('connect_error', (err) => {
    logLine('[ERROR] 接続失敗: ' + (err?.message || err));
  });

  socket.on('init', (payload) => {
    myId = payload.id;
    payload.players.forEach(p => players.set(p.id, p));
    logLine('[OK] サーバー接続');
  });

  socket.on('playerJoined', (p) => { players.set(p.id, p); logLine(`[JOIN] ${p.name}`); });
  socket.on('playerLeft', (p) => { players.delete(p.id); logLine(`[LEAVE] ${p.name || p.id}`); });
  socket.on('playerMoved', (p) => { const old = players.get(p.id); if (old) { old.x=p.x; old.y=p.y; } });
  socket.on('playerUpdated', (p) => { const old = players.get(p.id); if (old) old.name = p.name ?? old.name; });
  socket.on('chat', ({from, text}) => logLine(`${from}: ${text}`));

  // ====== 以下はゲーム本体（元と同じ） ======
  const TILE = 32;
  const mapW = 30, mapH = 20;
  const map = Array.from({length: mapH}, (_, y) =>
    Array.from({length: mapW}, (_, x) => (x === 0 || y === 0 || x === mapW-1 || y === mapH-1) ? 1 : 0)
  );
  for (let i=0;i<20;i++){ const x=2+Math.floor(Math.random()*(mapW-4)); const y=2+Math.floor(Math.random()*(mapH-4)); map[y][x]=1; }

  const spawn = { x: 5*TILE, y: 5*TILE };
  const me = { x: spawn.x, y: spawn.y, w: 26, h: 26, speed: 3.0, hp: 20, maxhp: 20, name: 'me' };

  const slime = { x: 10*TILE, y: 8*TILE, w: 28, h: 24, alive: true };

  const rectInter = (a,b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const solidAt = (px, py) => {
    const gx = Math.floor(px / TILE), gy = Math.floor(py / TILE);
    if (gx < 0 || gy < 0 || gx >= mapW || gy >= mapH) return true;
    return map[gy][gx] === 1;
  };

  let scene = 'overworld';
  let battle = null;

  const startBattle = () => { scene = 'battle'; battle = createBattle(); };

  const createBattle = () => {
    return {
      phase: 'command',
      enemy: { name: 'スライム', hp: 30, maxhp: 30, mood: 0 },
      commandIndex: 0,
      atk: { t:0, dir:1, pos:0.5, speed:1.2, on:false, damage:0 },
      box: { x: 280, y: 400, w: 400, h: 120 },
      soul: { x: 280+200-6, y: 400+60-6, w: 12, h: 12, speed: 3.2, iframes: 0 },
      bullets: [],
      turnTimer: 0,
    };
  };

  const commands = ['こうげき', 'はなす', 'アイテム', 'にげる'];

  const handleCommand = (idx) => {
    const b = battle;
    switch (idx) {
      case 0:
        b.phase = 'attack';
        b.atk.t = 0; b.atk.pos = 0; b.atk.dir = 1; b.atk.on = true; b.atk.damage = 0;
        break;
      case 1:
        b.enemy.mood = Math.max(-5, b.enemy.mood - 1);
        logLine('あなたは優しく話しかけた。スライムは落ち着いた。');
        b.phase = 'defend'; setupBullets(); break;
      case 2:
        if (me.hp < me.maxhp) { me.hp = Math.min(me.maxhp, me.hp + 8); logLine('ポーションを使った！ HPが回復した。'); }
        else { logLine('HPは満タンだ。'); }
        b.phase = 'defend'; setupBullets(); break;
      case 3:
        if (Math.random() < 0.35) { logLine('あなたはうまく逃げ切れた！'); battle.phase = 'win'; }
        else { logLine('逃げられなかった！'); b.phase = 'defend'; setupBullets(); }
        break;
    }
  };

  const setupBullets = () => {
    const N = 14 + Math.max(0, 5 + battle.enemy.mood);
    battle.bullets.length = 0;
    for (let i=0;i<N;i++){
      const side = Math.floor(Math.random()*4);
      let x,y,vx,vy; const speed = rand(1.2, 2.2);
      if (side===0){ x=battle.box.x-6; y=rand(battle.box.y, battle.box.y+battle.box.h); vx=speed; vy=rand(-0.6,0.6); }
      else if (side===1){ x=battle.box.x+battle.box.w+6; y=rand(battle.box.y, battle.box.y+battle.box.h); vx=-speed; vy=rand(-0.6,0.6); }
      else if (side===2){ x=rand(battle.box.x, battle.box.x+battle.box.w); y=battle.box.y-6; vx=rand(-0.6,0.6); vy=speed; }
      else { x=rand(battle.box.x, battle.box.x+battle.box.w); y=battle.box.y+battle.box.h+6; vx=rand(-0.6,0.6); vy=-speed; }
      battle.bullets.push({x,y,vx,vy,r:5});
    }
    battle.turnTimer = 3000;
  };

  const attackBarUpdate = (dt) => {
    const a = battle.atk; if (!a.on) return;
    a.t += dt/1000 * a.speed; a.pos += a.dir * dt/1000 * a.speed;
    if (a.pos >= 1) { a.pos = 1; a.dir = -1; }
    if (a.pos <= 0) { a.pos = 0; a.dir = 1; }
    if (pressed('z') || pressed('enter') || pressed(' ')) {
      a.on = false;
      const d = 1 - Math.abs(a.pos - 0.5) * 2;
      a.damage = Math.floor(4 + d * 10);
      battle.enemy.hp = Math.max(0, battle.enemy.hp - a.damage);
      if (battle.enemy.hp <= 0) { battle.phase = 'win'; }
      else { battle.phase = 'defend'; setupBullets(); }
      inputLatch();
    }
  };

  const pressedState = {};
  const pressed = (key) => {
    key = key.toLowerCase(); if (key === ' ') key = ' ';
    const k = (key === 'z' || key === 'enter' || key === ' ') ? (keymap['z'] || keymap['enter'] || keymap[' ']) : keymap[key];
    if (k && !pressedState[key]) { pressedState[key] = true; return true; }
    return false;
  };
  const inputLatch = () => setTimeout(() => { for (const k in pressedState) pressedState[k]=false; }, 120);

  let last = now(); let moveSendAccum = 0;
  function loop(){ const t=now(); const dt=t-last; last=t; update(dt); render(); requestAnimationFrame(loop); }
  function update(dt){
    if (scene === 'overworld') {
      const sp = me.speed; let dx=0,dy=0;
      if (keymap['arrowleft'] || keymap['a']) dx -= 1;
      if (keymap['arrowright'] || keymap['d']) dx += 1;
      if (keymap['arrowup'] || keymap['w']) dy -= 1;
      if (keymap['arrowdown'] || keymap['s']) dy += 1;
      if (dx && dy) { dx*=Math.SQRT1_2; dy*=Math.SQRT1_2; }
      const next = { x: me.x + dx*sp, y: me.y + dy*sp, w: me.w, h: me.h };
      const cx = next.x + next.w/2, cy = next.y + next.h/2;
      if (!solidAt(cx, next.y) && !solidAt(cx, next.y + next.h) && !solidAt(next.x, cy) && !solidAt(next.x + next.w, cy)) {
        me.x = next.x; me.y = next.y;
      }
      if (slime.alive && rectInter(me, slime)) { startBattle(); }
      moveSendAccum += dt;
      if (moveSendAccum >= 50) { moveSendAccum = 0; socket.emit('move', { x: me.x, y: me.y }); }
    } else if (scene === 'battle') {
      const b = battle;
      switch (b.phase) {
        case 'command':
          if (pressed('arrowleft')) b.commandIndex = (b.commandIndex + commands.length - 1) % commands.length;
          if (pressed('arrowright')) b.commandIndex = (b.commandIndex + 1) % commands.length;
          if (pressed('z') || pressed('enter') || pressed(' ')) { handleCommand(b.commandIndex); inputLatch(); }
          break;
        case 'attack':
          attackBarUpdate(dt); break;
        case 'defend':
          b.turnTimer -= dt;
          const s = b.soul;
          let dx=0,dy=0;
          if (keymap['arrowleft'] || keymap['a']) dx -= 1;
          if (keymap['arrowright'] || keymap['d']) dx += 1;
          if (keymap['arrowup'] || keymap['w']) dy -= 1;
          if (keymap['arrowdown'] || keymap['s']) dy += 1;
          if (dx && dy) { dx*=Math.SQRT1_2; dy*=Math.SQRT1_2; }
          s.x = clamp(s.x + dx*s.speed, battle.box.x, battle.box.x + battle.box.w - s.w);
          s.y = clamp(s.y + dy*s.speed, battle.box.y, battle.box.y + battle.box.h - s.h);
          for (const bu of b.bullets) {
            bu.x += bu.vx; bu.y += bu.vy;
            if (s.iframes <= 0) {
              if (bu.x+bu.r > s.x && bu.x-bu.r < s.x+s.w && bu.y+bu.r > s.y && bu.y-bu.r < s.y+s.h) {
                me.hp = Math.max(0, me.hp - 2);
                s.iframes = 600;
                if (me.hp <= 0) { b.phase = 'lose'; }
              }
            }
          }
          if (s.iframes > 0) s.iframes -= dt;
          if (b.turnTimer <= 0 && b.phase === 'defend' && me.hp > 0) { b.phase = 'command'; }
          break;
        case 'win':
          slime.alive = false; me.hp = me.maxhp; scene = 'overworld'; break;
        case 'lose':
          if (pressed('z') || pressed('enter') || pressed(' ')) { me.hp = me.maxhp; me.x=5*32; me.y=5*32; scene='overworld'; inputLatch(); }
          break;
      }
    }
  }
  function render(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if (scene === 'overworld') {
      for (let y=0;y<mapH;y++){ for (let x=0;x<mapW;x++){ ctx.fillStyle=(map[y][x]===1)?'#1f2937':'#111827'; ctx.fillRect(x*32, y*32, 32, 32); ctx.strokeStyle='#0b1220'; ctx.strokeRect(x*32+0.5, y*32+0.5, 31, 31);} }
      if (slime.alive) { ctx.fillStyle='#34d399'; ctx.fillRect(slime.x, slime.y, slime.w, slime.h); }
      for (const [id,p] of players){ if (id===myId) continue; ctx.fillStyle=p.color||'#60a5fa'; ctx.fillRect(p.x,p.y,22,22); ctx.fillStyle='#eee'; ctx.font='12px sans-serif'; ctx.fillText(p.name||'???', p.x, p.y-4); }
      ctx.fillStyle='#fca5a5'; ctx.fillRect(me.x, me.y, me.w, me.h);
      ctx.fillStyle='#eee'; ctx.font='14px sans-serif'; ctx.fillText(`HP ${me.hp}/${me.maxhp}`, 10, 20);
    } else if (scene === 'battle') {
      const b = battle;
      ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle='#eee'; ctx.font='20px sans-serif'; ctx.fillText(`${b.enemy.name}  HP ${b.enemy.hp}/${b.enemy.maxhp}`, 20, 40);
      if (b.phase === 'command') {
        ctx.font='18px sans-serif';
        const commands=['こうげき','はなす','アイテム','にげる'];
        for (let i=0;i<commands.length;i++){ const x=140+i*160,y=540; if (i===b.commandIndex){ ctx.fillStyle='#fff'; ctx.fillText(`> ${commands[i]} <`, x, y);} else { ctx.fillStyle='#bbb'; ctx.fillText(commands[i], x+12, y);} }
        ctx.font='16px sans-serif'; ctx.fillStyle='#bbb'; ctx.fillText('← → で選択 / Zで決定', 20, 600);
      }
      if (b.phase === 'attack') {
        ctx.fillStyle='#222'; ctx.fillRect(180, 420, 600, 24);
        ctx.fillStyle='#444'; ctx.fillRect(180+300-2, 420, 4, 24);
        const x = 180 + Math.floor(b.atk.pos * 600);
        ctx.fillStyle='#f59e0b'; ctx.fillRect(x-4, 416, 8, 32);
        ctx.fillStyle='#bbb'; ctx.fillText('Zで止める（中央が高ダメージ）', 20, 600);
      }
      if (b.phase === 'defend') {
        ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.strokeRect(b.box.x, b.box.y, b.box.w, b.box.h);
        ctx.fillStyle=(b.soul.iframes>0)?'#f87171aa':'#ef4444'; ctx.fillRect(b.soul.x, b.soul.y, b.soul.w, b.soul.h);
        for (const bu of b.bullets){ ctx.beginPath(); ctx.arc(bu.x, bu.y, bu.r, 0, Math.PI*2); ctx.fillStyle='#60a5fa'; ctx.fill(); }
        ctx.fillStyle='#bbb'; ctx.fillText(`敵の攻撃: ${Math.max(0,(b.turnTimer/1000)).toFixed(1)}s`, 20, 600);
      }
      if (b.phase === 'win'){ ctx.fillStyle='#10b981'; ctx.font='28px sans-serif'; ctx.fillText('WIN! Zで戻る', 360, 340); }
      if (b.phase === 'lose'){ ctx.fillStyle='#ef4444'; ctx.font='28px sans-serif'; ctx.fillText('YOU DIED... Zで再開（復活）', 300, 340); }
      ctx.fillStyle='#eee'; ctx.font='16px sans-serif'; ctx.fillText(`HP ${me.hp}/${me.maxhp}`, 20, 70);
    }
  }
  loop();
})();

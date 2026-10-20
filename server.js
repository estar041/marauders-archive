const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const OPERATOR_CODE = process.env.OPERATOR_CODE;
const publicDir = path.join(__dirname, "public");
const rooms = new Map();
const operatorTokens = new Set();

const starterLessons = [
  { id: "charms", label: "주문학", icon: "✦", level: 1 },
  { id: "defense", label: "방어술", icon: "◈", level: 1 },
  { id: "potions", label: "마법약", icon: "◉", level: 1 },
  { id: "care", label: "신비한 동물 돌보기", icon: "❋", level: 0 }
];

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function body(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on("error", reject);
  });
}

function code() {
  let result;
  do { result = crypto.randomBytes(3).toString("hex").toUpperCase(); } while (rooms.has(result));
  return result;
}

function operator(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") && operatorTokens.has(header.slice(7));
}

function publicRoom(room) {
  return {
    code: room.code,
    name: room.name,
    term: room.term,
    phase: room.phase,
    members: room.members.map(({ id, name, role, character, stats, hp, maxHp, xp, level }) => ({ id, name, role, character, stats, hp, maxHp, xp, level })),
    messages: room.messages,
    lessons: room.lessons,
    game: room.game
  };
}

function broadcast(room) {
  const payload = `event: room\ndata: ${JSON.stringify(publicRoom(room))}\n\n`;
  room.clients.forEach((client) => client.write(payload));
}

function addMessage(room, message) {
  room.messages.push({ id: crypto.randomUUID(), ...message, at: new Date().toISOString() });
  if (room.messages.length > 100) room.messages.shift();
  broadcast(room);
}

function aliveMembers(room, combat) {
  return combat.turnOrder
    .map((id) => room.members.find((member) => member.id === id))
    .filter((member) => member && member.hp > 0);
}

function combatLog(combat, text) {
  combat.log.push({ text, round: combat.round, at: new Date().toISOString() });
  if (combat.log.length > 30) combat.log.shift();
}

function enemyTurn(room, combat) {
  const targets = aliveMembers(room, combat);
  if (!targets.length) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  const roll = Math.floor(Math.random() * 6) + 1;
  const damage = Math.max(1, roll + combat.enemy.power - (target.guarding ? 3 : 0));
  target.hp = Math.max(0, target.hp - damage);
  target.guarding = false;
  combatLog(combat, `${combat.enemy.name}이(가) ${target.name}에게 ${damage} 피해를 입혔습니다. (적 주사위 ${roll})`);
  if (!aliveMembers(room, combat).length) {
    combat.status = "defeat";
    combat.phase = "finished";
    room.game.notice = "모두 쓰러졌습니다. 연회장으로 후퇴했습니다.";
    return;
  }
  combat.round += 1;
  combat.phase = "players";
  combat.activeIndex = 0;
  combat.turnOrder = room.members.filter((member) => member.hp > 0).map((member) => member.id);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "POST" && url.pathname === "/api/operator/login") {
      const data = await body(req);
      if (!OPERATOR_CODE || String(data.code || "") !== OPERATOR_CODE) {
        return json(res, 401, { error: "운영자 코드를 확인해 주세요." });
      }
      const token = crypto.randomBytes(24).toString("hex");
      operatorTokens.add(token);
      return json(res, 200, { token });
    }

    if (req.method === "GET" && url.pathname === "/api/admin/rooms") {
      if (!operator(req)) return json(res, 401, { error: "운영자 인증이 필요합니다." });
      return json(res, 200, [...rooms.values()].map(publicRoom));
    }

    if (req.method === "POST" && url.pathname === "/api/rooms") {
      if (!operator(req)) return json(res, 401, { error: "기록실 생성은 운영자만 할 수 있습니다." });
      const data = await body(req);
      const room = {
        code: code(),
        name: String(data.name || "호그와트 기록실").slice(0, 40),
        term: "1학년 · 1991년 가을",
        phase: "프롤로그",
        members: [],
        messages: [{
          id: crypto.randomUUID(), system: true, text: "기록실이 열렸습니다. 서로의 캐릭터를 소개해 주세요.", at: new Date().toISOString()
        }],
        lessons: starterLessons.map((lesson) => ({ ...lesson })),
        game: {
          location: "banquet",
          locationLabel: "대연회장",
          combat: null,
          notice: "새 학기의 첫 저녁입니다. 연회장 곳곳에서 모험의 소문이 들려옵니다."
        },
        clients: new Set()
      };
      rooms.set(room.code, room);
      return json(res, 201, publicRoom(room));
    }

    const match = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)(?:\/(events|messages|members))?$/);
    if (match) {
      const room = rooms.get(match[1]);
      if (!room) return json(res, 404, { error: "기록실을 찾을 수 없습니다." });
      const action = match[2];
      if (req.method === "GET" && !action) return json(res, 200, publicRoom(room));
      if (req.method === "GET" && action === "events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        res.write(`event: room\ndata: ${JSON.stringify(publicRoom(room))}\n\n`);
        room.clients.add(res);
        req.on("close", () => room.clients.delete(res));
        return;
      }
      if (req.method === "POST" && action === "members") {
        const data = await body(req);
        const member = {
          id: crypto.randomUUID(),
          name: String(data.name || "익명의 마법사").slice(0, 24),
          role: "player",
          character: data.character || null,
          stats: { courage: 2, wit: 2, focus: 2 },
          hp: 20,
          maxHp: 20,
          xp: 0,
          level: 1
        };
        room.members.push(member);
        addMessage(room, { system: true, text: `${member.name}님이 기록실에 들어왔습니다.` });
        return json(res, 201, member);
      }
      if (req.method === "POST" && action === "messages") {
        const data = await body(req);
        if (!String(data.text || "").trim()) return json(res, 400, { error: "메시지를 입력해 주세요." });
        addMessage(room, {
          author: String(data.author || "익명의 마법사").slice(0, 24),
          authorId: data.authorId,
          kind: data.kind || "rp",
          text: String(data.text).slice(0, 600)
        });
        return json(res, 201, { ok: true });
      }

    }

    const gameMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)\/game$/);
    if (gameMatch && req.method === "POST") {
        const room = rooms.get(gameMatch[1]);
        if (!room) return json(res, 404, { error: "기록실을 찾을 수 없습니다." });
        const data = await body(req);
        const member = room.members.find((item) => item.id === data.memberId);
        if (!member) return json(res, 403, { error: "참가자 세션을 확인할 수 없습니다." });
        if (data.action === "location") {
          const locations = {
            banquet: "대연회장",
            lobby: "현관 로비",
            library: "도서관",
            classroom: "주문학 교실",
            grounds: "성 바깥뜰"
          };
          if (!locations[data.location]) return json(res, 400, { error: "알 수 없는 장소입니다." });
          room.game.location = data.location;
          room.game.locationLabel = locations[data.location];
          room.game.notice = `${member.name}님이 ${locations[data.location]}으로 이동했습니다.`;
          addMessage(room, { system: true, text: room.game.notice });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "start-combat") {
          if (room.game.combat) return json(res, 409, { error: "이미 진행 중인 전투가 있습니다." });
          if (!room.members.length) return json(res, 409, { error: "전투에 참가할 플레이어가 없습니다." });
          room.members.forEach((player) => {
            player.hp = player.maxHp;
            player.guarding = false;
          });
          room.game.combat = {
            enemy: { name: "그림자 망령", power: 2 },
            enemyHp: 42,
            enemyMaxHp: 42,
            phase: "players",
            status: "active",
            round: 1,
            activeIndex: 0,
            turnOrder: room.members.map((player) => player.id),
            log: ["그림자 망령이 나타났습니다. 파티의 첫 번째 플레이어부터 행동합니다."]
          };
          room.game.location = "grounds";
          room.game.locationLabel = "성 바깥뜰";
          room.game.notice = `${member.name}님이 어둠 속의 적을 발견했습니다. 모두가 주문을 준비합니다.`;
          addMessage(room, { system: true, text: room.game.notice });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "combat") {
          const combat = room.game.combat;
          if (!combat) return json(res, 409, { error: "진행 중인 전투가 없습니다." });
          if (combat.status !== "active") return json(res, 409, { error: "이미 끝난 전투입니다." });
          if (combat.phase !== "players") return json(res, 409, { error: "적의 차례를 기다리는 중입니다." });
          const activeId = combat.turnOrder[combat.activeIndex];
          if (activeId !== member.id) return json(res, 409, { error: "아직 당신의 차례가 아닙니다." });
          const spell = {
            stupefy: { label: "기절 주문", power: 7, stat: "focus" },
            lumos: { label: "빛의 주문", power: 4, stat: "wit" },
            shield: { label: "방패 주문", power: 0, stat: "courage" },
            focus: { label: "집중", power: 0, stat: "focus" }
          }[data.spell];
          if (!spell) return json(res, 400, { error: "사용할 수 없는 주문입니다." });
          const roll = Math.floor(Math.random() * 6) + 1;
          const power = spell.power + roll + member.stats[spell.stat];
          let text = `${member.name}님이 ${spell.label}을 사용했습니다. (주사위 ${roll})`;
          if (data.spell === "shield") {
            member.guarding = true;
            member.hp = Math.min(member.maxHp, member.hp + 3);
            text += " 방패가 몸을 감싸고 3 체력을 회복합니다.";
          } else if (data.spell === "focus") {
            member.focused = true;
            text += " 다음 주문의 판정에 집중합니다.";
          } else {
            const focusedBonus = member.focused ? 3 : 0;
            member.focused = false;
            const totalPower = power + focusedBonus;
            combat.enemyHp = Math.max(0, combat.enemyHp - totalPower);
            text += ` ${totalPower} 피해!`;
          }
          combatLog(combat, text);
          if (combat.enemyHp <= 0) {
            combat.status = "victory";
            combat.phase = "finished";
            room.game.notice = "전투에서 승리했습니다. 파티가 새로운 단서를 손에 넣었습니다.";
            room.members.forEach((player) => { player.xp += 30; });
          } else {
            combat.activeIndex += 1;
            if (combat.activeIndex >= combat.turnOrder.length) {
              combat.phase = "enemy";
              enemyTurn(room, combat);
            }
          }
          addMessage(room, { system: true, text });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "reset-combat") {
          if (!room.game.combat || room.game.combat.status === "active") {
            return json(res, 409, { error: "종료된 전투만 다시 시작할 수 있습니다." });
          }
          room.game.combat = null;
          room.game.notice = "성 바깥뜰에 다시 정적이 내려앉았습니다.";
          return json(res, 200, publicRoom(room));
        }
    }

    const file = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(publicDir, file));
    if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) return json(res, 404, { error: "Not found" });
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": `${types[path.extname(filePath)] || "text/plain"}; charset=utf-8` });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, 400, { error: error.message });
  }
});

server.listen(PORT, () => console.log(`Marauders Archive is running at http://localhost:${PORT}`));

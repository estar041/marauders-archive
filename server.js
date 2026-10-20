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

const itemCatalog = {
  "달빛 약초": { weight: 0.5, use: "마법약 재료" },
  "회복 물약": { weight: 1, use: "사용 시 체력 8 회복" },
  "학교 지도": { weight: 0.2, use: "마을에서 얻는 영구 소지품" }
};
const inventoryRules = { carryCapacity: 10, storageCapacity: 20 };
const lessonRewards = {
  charms: { xp: 12, stat: "intelligence", coins: 3, text: "지능" },
  defense: { xp: 12, stat: "willpower", coins: 3, text: "정신력" },
  potions: { xp: 15, stat: "education", coins: 4, text: "교육" },
  care: { xp: 10, stat: "charisma", coins: 2, text: "매력" }
};
const defaultStats = { strength: 2, willpower: 2, agility: 2, charisma: 2, education: 2, intelligence: 2 };
const criticalRecoveryMs = 2 * 60 * 1000;

const locations = {
  banquet: { label: "대연회장", description: "새 학기의 소문과 파티가 시작되는 중앙 허브", icon: "♜", type: "hub" },
  lobby: { label: "현관 로비", description: "약속과 만남이 모이는 넓은 홀", icon: "⌂", type: "social" },
  classroom: { label: "주문학 교실", description: "기초 주문과 실전 판정을 익히는 교실", icon: "✦", type: "lesson" },
  library: { label: "도서관", description: "단서와 오래된 기록을 조사하는 곳", icon: "▤", type: "investigation" },
  grounds: { label: "성 바깥뜰", description: "위험한 조우가 발생하는 탐험 구역", icon: "⚔", type: "combat" },
  greenhouse: { label: "온실", description: "약초와 마법 식물을 돌보는 온실", icon: "❋", type: "lesson" },
  potions: { label: "마법약 실험실", description: "재료를 조합해 소모품을 만드는 실험실", icon: "◉", type: "lesson" },
  tower: { label: "천문탑", description: "밤하늘에서 사건의 징조를 읽는 탑", icon: "✧", type: "investigation" },
  infirmary: { label: "치유실", description: "부상과 상태 이상을 회복하는 장소", icon: "+", type: "recovery" },
  dueling: { label: "결투장", description: "안전한 규칙 아래 주문을 겨루는 경기장", icon: "◇", type: "combat" },
  lake: { label: "검은 호수 선착장", description: "호수와 숲으로 이어지는 외곽 길목", icon: "≈", type: "explore" },
  village: { label: "마을 거리", description: "상점과 소문을 만날 수 있는 외부 지역", icon: "⌘", type: "social" }
};

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
    members: room.members.map(({ id, name, role, character, characterSheet, stats, hp, maxHp, xp, level, inventory, storage, coins, lessonProgress }) => ({ id, name, role, character, characterSheet, stats, hp, maxHp, xp, level, inventory, storage, coins, lessonProgress })),
    messages: room.messages,
    lessons: room.lessons,
    game: room.game,
    locations
  };
}

function itemWeight(items = []) {
  return items.reduce((total, item) => total + (itemCatalog[item]?.weight || 1), 0);
}

function addItem(member, item, destination = "inventory") {
  const list = member[destination] || (member[destination] = []);
  const limit = destination === "storage" ? inventoryRules.storageCapacity : inventoryRules.carryCapacity;
  if (destination === "storage" && list.length >= limit) return false;
  if (destination === "inventory" && itemWeight([...list, item]) > limit) return false;
  list.push(item);
  return true;
}

function removeItem(member, item, source = "inventory") {
  const list = member[source] || [];
  const index = list.indexOf(item);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}

function awardXp(member, amount) {
  member.xp += amount;
  while (member.xp >= 100) {
    member.xp -= 100;
    member.level += 1;
    member.maxHp += 2;
    member.hp = member.maxHp;
  }
}

function refreshCriticalState(room) {
    const now = Date.now();
    room.members.forEach((member) => {
      if (member.hp > 0) return;
      if (!member.incapacitatedAt) member.incapacitatedAt = new Date(now).toISOString();
      if (now - Date.parse(member.incapacitatedAt) >= criticalRecoveryMs) {
        member.hp = 1;
        member.incapacitatedAt = null;
        member.status = "hospitalized";
        room.game.location = "infirmary";
        room.game.locationLabel = locations.infirmary.label;
        room.game.notice = `${member.name}님이 구조되어 치유실로 옮겨졌습니다.`;
        addMessage(room, { system: true, text: room.game.notice });
      }
    });
}

function markDamage(member, amount) {
    member.hp = Math.max(0, member.hp - amount);
    if (member.hp === 0 && !member.incapacitatedAt) {
      member.incapacitatedAt = new Date().toISOString();
      member.status = "critical";
    }
}

function skillRoll(member, stat, difficulty) {
    const roll = Math.floor(Math.random() * 6) + 1;
    return { roll, total: roll + (member.stats[stat] || 0), success: roll + (member.stats[stat] || 0) >= difficulty };
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

function advanceCombatTurn(room, combat) {
  while (combat.activeIndex < combat.turnOrder.length) {
    const member = room.members.find((candidate) => candidate.id === combat.turnOrder[combat.activeIndex]);
    if (member && member.hp > 0) return true;
    combat.activeIndex += 1;
  }
  combat.phase = "enemy";
  enemyTurn(room, combat);
  return false;
}

function combatLog(combat, text) {
  combat.log.push({ text, round: combat.round, at: new Date().toISOString() });
  if (combat.log.length > 30) combat.log.shift();
}

function interactAtLocation(room, member, action, targetId) {
  const location = locations[room.game.location];
  if (!location) return "현재 장소를 확인할 수 없습니다.";
  if (action === "recover") {
    member.hp = member.maxHp;
    member.incapacitatedAt = null;
    member.status = "healthy";
    room.game.notice = `${member.name}님이 치유실에서 완전히 회복했습니다.`;
    return room.game.notice;
  }
  if (action === "study") {
    const stat = room.game.location === "library" ? "intelligence" : "education";
    member.stats[stat] += 1;
    awardXp(member, 10);
    room.game.notice = `${member.name}님이 ${location.label}에서 공부해 ${stat === "intelligence" ? "지능" : "교육"}이 1 올랐습니다.`;
    return room.game.notice;
  }
  if (action === "gather") {
    if (!addItem(member, "달빛 약초")) return "소지 한도가 가득 찼습니다. 창고에 물건을 보관해 주세요.";
    awardXp(member, 5);
    room.game.notice = `${member.name}님이 온실에서 달빛 약초를 채집했습니다.`;
    return room.game.notice;
  }
  if (action === "brew") {
    if (!removeItem(member, "달빛 약초")) return "달빛 약초가 필요합니다. 온실에서 먼저 채집해 주세요.";
    if (!addItem(member, "회복 물약")) {
      addItem(member, "달빛 약초");
      return "소지 한도가 가득 차 회복 물약을 만들 수 없습니다.";
    }
    awardXp(member, 8);
    room.game.notice = `${member.name}님이 회복 물약을 만들었습니다.`;
    return room.game.notice;
  }
  if (action === "shop") {
    if (member.inventory.includes("학교 지도")) return "이미 학교 지도를 가지고 있습니다.";
    if (!addItem(member, "학교 지도")) return "소지 한도가 가득 찼습니다.";
    room.game.notice = `${member.name}님이 마을 거리에서 학교 지도를 얻었습니다.`;
    return room.game.notice;
  }
  if (action === "buy-potion") {
    if (member.coins < 8) return "회복 물약은 8갈레온입니다.";
    if (!addItem(member, "회복 물약")) return "소지 한도가 가득 찼습니다.";
    member.coins -= 8;
    room.game.notice = `${member.name}님이 8갈레온을 내고 회복 물약을 샀습니다.`;
    return room.game.notice;
  }
  if (action === "negotiate") {
    const check = skillRoll(member, "charisma", 5);
    if (!check.success) return `${member.name}님이 상인과 흥정했지만 통하지 않았습니다. (주사위 ${check.roll})`;
    member.coins += 5;
    room.game.notice = `${member.name}님이 상인을 설득해 5갈레온을 아꼈습니다.`;
    return room.game.notice;
  }
  if (action === "investigate") {
    awardXp(member, 8);
    room.game.notice = `${member.name}님이 ${location.label}에서 새로운 사건의 단서를 발견했습니다.`;
    return room.game.notice;
  }
  if (action === "rescue") {
    const target = room.members.find((candidate) => candidate.id === targetId);
    if (!target || target.hp > 0) return "구조할 캐릭터를 찾을 수 없습니다.";
    target.hp = 5;
    target.incapacitatedAt = null;
    target.status = "healthy";
    room.game.notice = `${member.name}님이 ${target.name}님을 응급 처치해 일으켰습니다.`;
    return room.game.notice;
  }
  return "이 장소에서 할 수 없는 행동입니다.";
}

function enemyTurn(room, combat) {
  const targets = aliveMembers(room, combat);
  if (!targets.length) return;
  const target = targets[Math.floor(Math.random() * targets.length)];
  const roll = Math.floor(Math.random() * 6) + 1;
  if (target.evading) {
    target.evading = false;
    combatLog(combat, `${target.name}이(가) 적의 공격을 회피했습니다.`);
  } else {
    const damage = Math.max(1, roll + combat.enemy.power - (target.guarding ? 3 : 0));
    markDamage(target, damage);
    target.guarding = false;
    if (target.countering && target.hp > 0) {
      combat.enemyHp = Math.max(0, combat.enemyHp - target.stats.strength - 3);
      combatLog(combat, `${target.name}이(가) 반격해 ${target.stats.strength + 3} 피해를 입혔습니다.`);
    }
    target.countering = false;
    combatLog(combat, `${combat.enemy.name}이(가) ${target.name}에게 ${damage} 피해를 입혔습니다. (적 주사위 ${roll})`);
  }
  if (!aliveMembers(room, combat).length) {
    combat.status = "defeat";
    combat.phase = "finished";
    room.game.notice = "모두 쓰러졌습니다. 연회장으로 후퇴했습니다.";
    return;
  }
  if (combat.enemyHp <= 0) {
    combat.status = "victory";
    combat.phase = "finished";
    room.game.notice = "반격으로 적을 쓰러뜨렸습니다.";
    room.members.forEach((player) => { awardXp(player, 30); player.coins += 12; });
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
          notice: "새 학기의 첫 저녁입니다. 연회장 곳곳에서 모험의 소문이 들려옵니다.",
          characterDrafts: {}
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
          characterSheet: {
            alias: "",
            house: "",
            origin: "",
            wand: "",
            temperament: "",
            fear: "",
            background: ""
          },
          stats: { ...defaultStats },
          hp: 20,
          maxHp: 20,
          xp: 0,
          level: 1,
          inventory: [],
          storage: [],
          coins: 30,
          lessonProgress: {},
          incapacitatedAt: null,
          status: "healthy"
        };
        room.members.push(member);
        addMessage(room, { system: true, text: `${member.name}님이 기록실에 들어왔습니다.` });
        return json(res, 201, member);
      }
      if (req.method === "PATCH" && action === "members") {
        const data = await body(req);
        const member = room.members.find((item) => item.id === data.memberId);
        if (!member) return json(res, 404, { error: "캐릭터를 찾을 수 없습니다." });
        member.name = String(data.name || member.name).slice(0, 24);
        member.characterSheet = {
          ...member.characterSheet,
          alias: String(data.characterSheet?.alias || "").slice(0, 30),
          house: String(data.characterSheet?.house || "").slice(0, 20),
          origin: String(data.characterSheet?.origin || "").slice(0, 30),
          wand: String(data.characterSheet?.wand || "").slice(0, 60),
          temperament: String(data.characterSheet?.temperament || "").slice(0, 80),
          fear: String(data.characterSheet?.fear || "").slice(0, 80),
          background: String(data.characterSheet?.background || "").slice(0, 300)
        };
        addMessage(room, { system: true, text: `${member.name}님의 캐릭터 시트가 갱신되었습니다.` });
        return json(res, 200, member);
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
        refreshCriticalState(room);
        const data = await body(req);
        const member = room.members.find((item) => item.id === data.memberId);
        if (!member) return json(res, 403, { error: "참가자 세션을 확인할 수 없습니다." });
        if (data.action === "location") {
          if (!locations[data.location]) return json(res, 400, { error: "알 수 없는 장소입니다." });
          room.game.location = data.location;
          room.game.locationLabel = locations[data.location].label;
          room.game.notice = `${member.name}님이 ${locations[data.location].label}으로 이동했습니다.`;
          addMessage(room, { system: true, text: room.game.notice });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "interact") {
          const allowed = {
            infirmary: ["recover", "rescue"],
            classroom: ["study"],
            library: ["investigate", "study"],
            tower: ["investigate", "study"],
            greenhouse: ["gather"],
            potions: ["brew"],
            village: ["shop", "buy-potion", "negotiate"],
            lake: ["investigate"],
            lobby: ["investigate"],
            banquet: ["investigate"],
            dueling: ["investigate"],
            grounds: ["investigate"]
          };
          if (!allowed[room.game.location]?.includes(data.interaction)) {
            return json(res, 400, { error: "현재 장소에서는 할 수 없는 행동입니다." });
          }
          const message = interactAtLocation(room, member, data.interaction, data.targetId);
          if (message.includes("필요합니다") || message.includes("한도") || message.includes("갈레온") || message.includes("이미")) return json(res, 409, { error: message });
          addMessage(room, { system: true, text: message });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "lesson") {
          const reward = lessonRewards[data.lesson];
          if (!reward) return json(res, 400, { error: "알 수 없는 수업입니다." });
          member.lessonProgress = member.lessonProgress || {};
          member.lessonProgress[data.lesson] = (member.lessonProgress[data.lesson] || 0) + 1;
          member.stats[reward.stat] += 1;
          member.coins += reward.coins;
          awardXp(member, reward.xp);
          const message = `${member.name}님이 ${data.lesson} 수업을 완료했습니다. 경험치 +${reward.xp}, ${reward.text} +1, ${reward.coins}갈레온을 얻었습니다.`;
          addMessage(room, { system: true, text: message });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "item") {
          member.inventory = member.inventory || [];
          member.storage = member.storage || [];
          const item = String(data.item || "");
          if (!itemCatalog[item]) return json(res, 400, { error: "알 수 없는 아이템입니다." });
          if (data.itemAction === "store") {
            if (!removeItem(member, item)) return json(res, 409, { error: "소지품에 해당 아이템이 없습니다." });
            if (!addItem(member, item, "storage")) {
              addItem(member, item);
              return json(res, 409, { error: "개인 창고가 가득 찼습니다." });
            }
          } else if (data.itemAction === "take") {
            if (!removeItem(member, item, "storage")) return json(res, 409, { error: "개인 창고에 해당 아이템이 없습니다." });
            if (!addItem(member, item)) {
              addItem(member, item, "storage");
              return json(res, 409, { error: "들 수 있는 무게를 초과합니다." });
            }
          } else if (data.itemAction === "use") {
            if (item !== "회복 물약" || !removeItem(member, item)) return json(res, 409, { error: "지금 사용할 수 없는 아이템입니다." });
            member.hp = Math.min(member.maxHp, member.hp + 8);
          } else {
            return json(res, 400, { error: "알 수 없는 아이템 행동입니다." });
          }
          const message = data.itemAction === "use"
            ? `${member.name}님이 회복 물약을 사용해 체력을 회복했습니다.`
            : `${member.name}님이 ${item}을 ${data.itemAction === "store" ? "개인 창고에 보관했습니다" : "꺼냈습니다"}.`;
          addMessage(room, { system: true, text: message });
          return json(res, 200, publicRoom(room));
        }
        if (data.action === "start-combat") {
          if (room.game.combat) return json(res, 409, { error: "이미 진행 중인 전투가 있습니다." });
          if (!room.members.length) return json(res, 409, { error: "전투에 참가할 플레이어가 없습니다." });
          room.members.forEach((player) => {
            player.hp = player.maxHp;
            player.guarding = false;
            player.evading = false;
            player.countering = false;
            player.incapacitatedAt = null;
            player.status = "healthy";
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
          if (!advanceCombatTurn(room, combat)) return json(res, 200, publicRoom(room));
          const activeId = combat.turnOrder[combat.activeIndex];
          if (activeId !== member.id) return json(res, 409, { error: "아직 당신의 차례가 아닙니다." });
          const spell = {
            stupefy: { label: "기절 주문", power: 7, stat: "willpower" },
            lumos: { label: "빛의 주문", power: 4, stat: "intelligence" },
            shield: { label: "방패 주문", power: 0, stat: "strength" },
            focus: { label: "집중", power: 0, stat: "education" }
          }[data.spell];
          const tactical = ["evade", "counter", "flee", "aid"].includes(data.spell);
          if (tactical) {
            if (data.spell === "evade") {
              const check = skillRoll(member, "agility", combat.enemy.power + 4);
              member.evading = check.success;
              combatLog(combat, `${member.name}이(가) 회피를 시도했습니다. (주사위 ${check.roll}) ${check.success ? "성공" : "실패"}`);
            } else if (data.spell === "counter") {
              member.countering = true;
              combatLog(combat, `${member.name}이(가) 반격 자세를 취했습니다.`);
            } else if (data.spell === "flee") {
              const check = skillRoll(member, "agility", combat.enemy.power + 5);
              combatLog(combat, `${member.name}이(가) 도주를 시도했습니다. (주사위 ${check.roll})`);
              if (check.success) {
                combat.status = "escaped";
                combat.phase = "finished";
                room.game.notice = `${member.name}님이 민첩하게 전투에서 벗어났습니다.`;
              }
            } else {
              const target = room.members.find((candidate) => candidate.id === data.targetId);
              if (!target || target.hp > 0) return json(res, 409, { error: "쓰러진 동료를 선택해 주세요." });
              target.hp = 5;
              target.incapacitatedAt = null;
              target.status = "healthy";
              combatLog(combat, `${member.name}이(가) ${target.name}을(를) 전투 중 일으켰습니다.`);
            }
            if (combat.status !== "active") {
              addMessage(room, { system: true, text: room.game.notice });
              return json(res, 200, publicRoom(room));
            }
            combat.activeIndex += 1;
            if (combat.activeIndex >= combat.turnOrder.length) advanceCombatTurn(room, combat);
            addMessage(room, { system: true, text: combat.log[combat.log.length - 1].text });
            return json(res, 200, publicRoom(room));
          }
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
            room.members.forEach((player) => { awardXp(player, 30); player.coins += 12; });
          } else {
            combat.activeIndex += 1;
            if (combat.activeIndex >= combat.turnOrder.length) advanceCombatTurn(room, combat);
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
    res.writeHead(200, {
      "Content-Type": `${types[path.extname(filePath)] || "text/plain"}; charset=utf-8`,
      "Cache-Control": "no-cache, must-revalidate",
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    json(res, 400, { error: error.message });
  }
});

server.listen(PORT, () => console.log(`Marauders Archive is running at http://localhost:${PORT}`));

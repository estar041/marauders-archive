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
    members: room.members.map(({ id, name, role, character }) => ({ id, name, role, character })),
    messages: room.messages,
    lessons: room.lessons
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
          character: data.character || null
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

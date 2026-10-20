const state = { room: null, member: null, stream: null, operatorToken: sessionStorage.getItem("operatorToken") };
const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function landing(error = "") {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">private text roleplaying game · 001</div><h1>마법학교의 기록실</h1><p>운영자가 공유한 링크와 입장 코드로 들어와, 한 학기씩 성장하며 캐릭터의 이야기를 함께 남깁니다.</p><div class="card"><h2>기록실 입장</h2><p class="hint">운영자에게 받은 초대 코드를 입력해 주세요.</p><div class="join"><input class="input" id="room-code" placeholder="초대 코드"><button class="primary" id="join">입장하기</button></div><p class="hint error">${escapeHtml(error)}</p></div><button class="text-button" id="operator">운영자 로그인</button></div></div>`;
  document.querySelector("#join").onclick = async () => {
    const roomCode = document.querySelector("#room-code").value.trim().toUpperCase();
    const response = await fetch(`/api/rooms/${roomCode}`);
    if (!response.ok) return landing("코드를 확인해 주세요.");
    state.room = await response.json();
    identify(false);
  };
  document.querySelector("#operator").onclick = operatorLogin;
}

function operatorLogin(error = "") {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">operator access</div><h1>운영자 전용<br>기록 관리</h1><p>운영 코드가 있어야 기록실을 만들고 진행을 관리할 수 있습니다.</p><div class="card create"><input class="input" id="operator-code" type="password" placeholder="운영 코드"><button class="primary" id="operator-enter">확인</button></div><p class="hint error">${escapeHtml(error)}</p></div></div>`;
  document.querySelector("#operator-enter").onclick = async () => {
    const response = await fetch("/api/operator/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: document.querySelector("#operator-code").value }) });
    const result = await response.json();
    if (!response.ok) return operatorLogin(result.error);
    state.operatorToken = result.token;
    sessionStorage.setItem("operatorToken", result.token);
    operatorPanel();
  };
}

async function operatorPanel() {
  const response = await fetch("/api/admin/rooms", { headers: { Authorization: `Bearer ${state.operatorToken}` } });
  if (!response.ok) return operatorLogin("운영자 세션이 만료되었습니다.");
  const rooms = await response.json();
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">operator dashboard</div><h1>기록실 관리</h1><p>참가자에게는 생성 권한이 없고, 이 화면에서만 기록실을 열 수 있습니다.</p><div class="card"><h2>새 기록실 열기</h2><div class="create"><input class="input" id="room-name" value="별관의 첫 번째 학기" maxlength="40"><button class="primary" id="create">열기</button></div><div class="room-list">${rooms.length ? rooms.map((room) => `<div class="room-row"><span>${escapeHtml(room.name)}</span><strong>${room.code}</strong></div>`).join("") : "<p class='hint'>아직 열린 기록실이 없습니다.</p>"}</div></div><button class="text-button" id="logout">운영자 로그아웃</button></div></div>`;
  document.querySelector("#create").onclick = async () => {
    const result = await fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${state.operatorToken}` }, body: JSON.stringify({ name: document.querySelector("#room-name").value }) });
    if (!result.ok) return operatorPanel();
    const room = await result.json();
    await navigator.clipboard?.writeText(room.code);
    operatorPanel();
  };
  document.querySelector("#logout").onclick = () => { sessionStorage.removeItem("operatorToken"); state.operatorToken = null; landing(); };
}

function identify() {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">enter the archive</div><h1>당신의 이름을<br>기록해 주세요.</h1><p>실제 이름 대신 이 기록실에서 사용할 플레이어 이름을 입력합니다.</p><div class="card create"><input class="input" id="name" placeholder="예: 은빛 잉크"><button class="primary" id="enter">입장</button></div></div></div>`;
  document.querySelector("#enter").onclick = async () => {
    const name = document.querySelector("#name").value.trim() || "익명의 마법사";
    const response = await fetch(`/api/rooms/${state.room.code}/members`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    state.member = await response.json();
    render();
    connect();
  };
}

function render() {
  const room = state.room;
  app.innerHTML = `<div class="layout"><aside class="panel side"><div class="brand">✦ 기록실</div><div class="room-code"><small>INVITE CODE</small><div class="code">${room.code}</div></div><div class="nav-title">현재 기록</div><div class="nav-item active">◉ 실시간 장면</div><div class="nav-item">◇ 캐릭터 시트</div><div class="nav-item">▧ 사건 기록</div><div class="nav-title">플레이 가이드</div><p class="hint">메시지 앞의 형식을 바꾸어 서술, 대사, 메타 발언을 구분해 보세요.</p></aside><section class="panel content"><header class="topbar"><div><h2>${escapeHtml(room.name)}</h2><div class="term">${escapeHtml(room.term)} · ${room.members.length}명 접속 중</div></div><div class="phase">${escapeHtml(room.phase)}</div></header><div class="feed" id="feed"></div><form class="composer" id="composer"><select id="kind"><option value="rp">서술</option><option value="dialogue">대사</option><option value="ooc">메타</option></select><input class="input" id="message" placeholder="장면에 이어서 기록하기..." maxlength="600"><button class="primary">전송</button></form></section><aside class="panel right"><div class="section"><div class="section-title">현재 장면</div><h2>별관 복도의 첫 만남</h2><p class="hint">낡은 초상화들이 새 학기의 방문자들을 바라보고 있습니다.</p></div><div class="section"><div class="section-title">참여자</div><div id="members"></div></div><div class="section"><div class="section-title">성장 트랙 · 1학년</div><div class="mini-stat"><span>다음 사건까지</span><strong>25%</strong></div><div class="bar"><i style="width:25%"></i></div><div id="lessons"></div></div><div class="section"><div class="section-title">내 캐릭터</div><div class="character-empty">캐릭터 시트에서 기숙사, 지팡이, 두려움과 첫 능력치를 정해 보세요.</div></div></aside></div>`;
  document.querySelector("#composer").onsubmit = async (event) => {
    event.preventDefault();
    const input = document.querySelector("#message");
    if (!input.value.trim()) return;
    await fetch(`/api/rooms/${room.code}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ author: state.member.name, authorId: state.member.id, kind: document.querySelector("#kind").value, text: input.value }) });
    input.value = "";
  };
  updateRoom(room);
}

function updateRoom(room) {
  state.room = room;
  const feed = document.querySelector("#feed");
  if (!feed) return;
  feed.innerHTML = `<div class="date">1991년 9월 1일 · 기록 시작</div>` + room.messages.map((message) => {
    if (message.system) return `<div class="system">${escapeHtml(message.text)}</div>`;
    const mine = message.authorId === state.member.id;
    const label = message.kind === "dialogue" ? "대사" : message.kind === "ooc" ? "메타" : "서술";
    return `<div class="message ${mine ? "mine" : ""}"><div class="avatar">${escapeHtml(message.author.slice(0, 1))}</div><div class="bubble"><div class="meta">${escapeHtml(message.author)} · ${label}</div><div class="text">${escapeHtml(message.text)}</div></div></div>`;
  }).join("");
  feed.scrollTop = feed.scrollHeight;
  document.querySelector("#members").innerHTML = room.members.map((member) => `<div class="member"><div class="avatar">${escapeHtml(member.name.slice(0, 1))}</div><span>${escapeHtml(member.name)}${member.role === "guide" ? " · 가이드" : ""}</span><i class="dot"></i></div>`).join("");
  document.querySelector("#lessons").innerHTML = room.lessons.map((lesson) => `<div class="lesson"><span>${lesson.icon} ${lesson.label}</span><strong>${lesson.level ? `Lv.${lesson.level}` : "잠김"}</strong></div>`).join("");
}

function connect() {
  state.stream = new EventSource(`/api/rooms/${state.room.code}/events`);
  state.stream.addEventListener("room", (event) => updateRoom(JSON.parse(event.data)));
}

landing();

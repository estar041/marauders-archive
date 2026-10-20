const state = { room: null, member: null, stream: null, operatorToken: sessionStorage.getItem("operatorToken"), view: "lobby" };
const app = document.querySelector("#app");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
function api(path, options = {}) {
  return fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
    return data;
  });
}
function landing(error = "") {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">private text roleplaying game · 001</div><h1>마법학교의 기록실</h1><p>연회장에서 소문을 듣고, 수업에서 주문을 익히고, 성 바깥의 적과 맞서는 작은 온라인 RPG.</p><div class="card"><h2>기록실 입장</h2><p class="hint">운영자에게 받은 초대 코드를 입력해 주세요.</p><div class="join"><input class="input" id="room-code" placeholder="초대 코드"><button class="primary" id="join">입장하기</button></div><p class="hint error">${escapeHtml(error)}</p></div><button class="text-button" id="operator">운영자 로그인</button></div></div>`;
  document.querySelector("#join").onclick = async () => {
    try { state.room = await api(`/api/rooms/${document.querySelector("#room-code").value.trim().toUpperCase()}`); identify(); } catch (err) { landing(err.message); }
  };
  document.querySelector("#operator").onclick = operatorLogin;
}
function identify() {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">enter the archive</div><h1>플레이어 이름을<br>기록해 주세요.</h1><p>이름은 게임 안에서 사용할 호칭입니다.</p><div class="card create"><input class="input" id="name" placeholder="예: 은빛 잉크"><button class="primary" id="enter">입장</button></div></div></div>`;
  document.querySelector("#enter").onclick = async () => {
    try { state.member = await api(`/api/rooms/${state.room.code}/members`, { method: "POST", body: JSON.stringify({ name: document.querySelector("#name").value.trim() || "익명의 마법사" }) }); render(); connect(); } catch (err) { identify(); }
  };
}
function operatorLogin(error = "") {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">operator access</div><h1>운영자 전용<br>기록 관리</h1><div class="card create"><input class="input" id="operator-code" type="password" placeholder="운영 코드"><button class="primary" id="operator-enter">확인</button></div><p class="hint error">${escapeHtml(error)}</p></div></div>`;
  document.querySelector("#operator-enter").onclick = async () => {
    try { const result = await api("/api/operator/login", { method: "POST", body: JSON.stringify({ code: document.querySelector("#operator-code").value }) }); state.operatorToken = result.token; sessionStorage.setItem("operatorToken", result.token); operatorPanel(); } catch (err) { operatorLogin(err.message); }
  };
}
async function operatorPanel() {
  try {
    const rooms = await api("/api/admin/rooms", { headers: { Authorization: `Bearer ${state.operatorToken}` } });
    app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">operator dashboard</div><h1>기록실 관리</h1><div class="card"><h2>새 기록실 열기</h2><div class="create"><input class="input" id="room-name" value="별관의 첫 번째 학기" maxlength="40"><button class="primary" id="create">열기</button></div><div class="room-list">${rooms.map((room) => `<div class="room-row"><span>${escapeHtml(room.name)}</span><strong>${room.code}</strong></div>`).join("") || "<p class='hint'>아직 열린 기록실이 없습니다.</p>"}</div></div><button class="text-button" id="logout">운영자 로그아웃</button></div></div>`;
    document.querySelector("#create").onclick = async () => { await api("/api/rooms", { method: "POST", headers: { Authorization: `Bearer ${state.operatorToken}` }, body: JSON.stringify({ name: document.querySelector("#room-name").value }) }); operatorPanel(); };
    document.querySelector("#logout").onclick = () => { sessionStorage.removeItem("operatorToken"); state.operatorToken = null; landing(); };
  } catch (err) { operatorLogin(err.message); }
}
function render() {
  const room = state.room;
  const game = room.game || {};
  app.innerHTML = `<div class="game-shell"><aside class="game-side"><div class="brand">✦ 기록실</div><div class="room-code"><small>INVITE CODE</small><div class="code">${room.code}</div></div><div class="profile"><div class="avatar">${escapeHtml(state.member.name.slice(0, 1))}</div><div><strong>${escapeHtml(state.member.name)}</strong><small>1학년 · 견습 마법사</small></div></div><div class="nav-title">학교</div><button class="nav-item ${state.view === "lobby" ? "active" : ""}" data-view="lobby">⌂ 연회장 로비</button><button class="nav-item ${state.view === "class" ? "active" : ""}" data-view="class">✦ 수업과 주문</button><button class="nav-item ${state.view === "explore" ? "active" : ""}" data-view="explore">⚔ 탐험과 전투</button><button class="nav-item ${state.view === "character" ? "active" : ""}" data-view="character">◇ 캐릭터 시트</button></aside><main class="game-main"><header class="game-top"><div><small>${escapeHtml(room.term)}</small><h2>${escapeHtml(room.name)}</h2></div><span class="phase">${escapeHtml(room.phase)}</span></header><div class="game-content" id="game-content"></div></main><aside class="game-right"><div class="section"><div class="section-title">현재 파티</div><div id="members"></div></div><div class="section"><div class="section-title">오늘의 목표</div><div class="quest"><strong>첫 번째 밤</strong><p>학교 주변에 나타난 그림자에 관한 소문을 확인하세요.</p><span>보상 · 경험치 30</span></div></div><div class="section"><div class="section-title">게임 알림</div><p class="hint">${escapeHtml(game.notice || "연회장에 새로운 소문이 도착했습니다.")}</p></div></aside></div>`;
  document.querySelectorAll("[data-view]").forEach((button) => { button.onclick = () => { state.view = button.dataset.view; render(); }; });
  document.querySelector("#members").innerHTML = room.members.map((member) => `<div class="member"><div class="avatar">${escapeHtml(member.name.slice(0, 1))}</div><span>${escapeHtml(member.name)}</span><i class="dot"></i></div>`).join("");
  renderView();
}
function renderView() {
  const root = document.querySelector("#game-content");
  const game = state.room.game;
  if (state.view === "lobby") root.innerHTML = `<div class="welcome"><div class="eyebrow">main hub · ${escapeHtml(game.locationLabel || "대연회장")}</div><h1>새 학기의 첫 저녁</h1><p>촛불이 떠 있는 대연회장. 네 기숙사의 테이블 사이로 수업, 소문, 그리고 성 밖의 위험에 관한 이야기가 흐릅니다.</p><div class="hub-grid"><button class="hub-card" data-location="classroom"><span>✦</span><strong>수업 게시판</strong><small>주문을 배우고 능력을 단련한다</small></button><button class="hub-card" data-location="library"><span>▤</span><strong>도서관</strong><small>단서와 마법 생물의 기록을 찾는다</small></button><button class="hub-card" data-location="grounds"><span>⚔</span><strong>성 바깥뜰</strong><small>적과 마주치고 전투를 시작한다</small></button><button class="hub-card" data-location="lobby"><span>⌂</span><strong>현관 로비</strong><small>다른 플레이어와 장면을 연다</small></button></div><div class="feed compact">${state.room.messages.slice(-5).map((m) => m.system ? `<div class="system">${escapeHtml(m.text)}</div>` : `<div class="log"><b>${escapeHtml(m.author)}</b> ${escapeHtml(m.text)}</div>`).join("")}</div></div>`;
  if (state.view === "class") root.innerHTML = `<div class="welcome"><div class="eyebrow">academy systems</div><h1>수업과 주문</h1><p>수업을 통해 캐릭터의 능력을 키우고, 전투에서 선택할 주문을 준비합니다.</p><div class="lesson-grid">${state.room.lessons.map((lesson) => `<div class="lesson-card"><span>${lesson.icon}</span><strong>${lesson.label}</strong><small>${lesson.level ? `숙련도 Lv.${lesson.level} · 다음 수업 가능` : "아직 잠겨 있습니다"}</small><button class="ghost">수업 기록 보기</button></div>`).join("")}</div></div>`;
  if (state.view === "explore") root.innerHTML = `<div class="welcome"><div class="eyebrow">encounter zone · ${escapeHtml(game.locationLabel || "성 바깥뜰")}</div><h1>탐험과 전투</h1><p>파티와 함께 위험한 장소를 조사합니다. 전투는 순서대로 한 명씩 행동하고, 전원이 행동하면 적이 반격합니다.</p>${game.combat ? combatView(game.combat) : `<div class="encounter-card"><span class="enemy-icon">☽</span><h2>어둠 속의 흔적</h2><p>바깥뜰의 오래된 석상 뒤에서 검은 연기가 피어오릅니다.</p><button class="primary" id="start-combat">전투 시작</button></div>`}</div>`;
  if (state.view === "character") {
    const member = state.room.members.find((item) => item.id === state.member.id) || state.member;
    root.innerHTML = `<div class="welcome"><div class="eyebrow">character sheet</div><h1>${escapeHtml(member.name)}</h1><p>1학년 견습 마법사 · 아직 이름 붙지 않은 모험의 시작</p><div class="character-card"><div class="stat-head"><strong>생명력</strong><b>${member.hp || 20} / ${member.maxHp || 20}</b></div><div class="bar"><i style="width:${((member.hp || 20) / (member.maxHp || 20)) * 100}%"></i></div>${Object.entries(member.stats || { courage: 2, wit: 2, focus: 2 }).map(([key, value]) => `<div class="stat-row"><span>${({ courage: "용기", wit: "지혜", focus: "집중" })[key]}</span><strong>${value}</strong></div>`).join("")}<div class="xp">경험치 <strong>${member.xp || 0} / 100</strong></div></div></div>`;
  }
  document.querySelectorAll("[data-location]").forEach((button) => button.onclick = () => {
    if (button.dataset.location === "grounds") {
      gameAction("start-combat");
    } else {
      gameAction("location", { location: button.dataset.location });
    }
  });
  document.querySelector("#start-combat")?.addEventListener("click", () => gameAction("start-combat"));
  document.querySelectorAll("[data-spell]").forEach((button) => button.onclick = () => gameAction("combat", { spell: button.dataset.spell }));
  document.querySelector("#reset-combat")?.addEventListener("click", () => gameAction("reset-combat"));
}
function combatView(combat) {
  const activeId = combat.turnOrder[combat.activeIndex];
  const active = state.room.members.find((member) => member.id === activeId);
  const canAct = combat.status === "active" && activeId === state.member.id;
  const result = combat.status === "victory" ? "승리 · 파티 전원 경험치 +30" : combat.status === "defeat" ? "패배 · 연회장으로 후퇴" : `${combat.phase === "players" ? "플레이어 차례" : "적 차례"} · 라운드 ${combat.round}`;
  return `<div class="combat-card"><div class="combat-head"><span class="phase">${escapeHtml(result)}</span><span class="round-badge">ROUND ${combat.round}</span></div><div class="combat-enemy"><span class="enemy-icon">☽</span><div><h2>${escapeHtml(combat.enemy.name)}</h2><small>그림자 계열 · ${combat.enemyHp} / ${combat.enemyMaxHp} HP</small><div class="bar enemy-bar"><i style="width:${combat.enemyHp / combat.enemyMaxHp * 100}%"></i></div></div></div><div class="initiative"><strong>행동 순서</strong>${combat.turnOrder.map((id, index) => { const player = state.room.members.find((member) => member.id === id); return `<span class="${index === combat.activeIndex && combat.status === "active" ? "turn-active" : ""}">${index + 1}. ${escapeHtml(player?.name || "플레이어")}</span>`; }).join("")}</div><div class="combat-log">${combat.log.slice(-5).reverse().map((entry) => `<div><small>R${entry.round}</small>${escapeHtml(entry.text)}</div>`).join("")}</div><div class="turn-callout">${combat.status === "active" ? `${escapeHtml(active?.name || "플레이어")}의 차례입니다.${canAct ? " 행동을 선택하세요." : " 다른 플레이어의 행동을 기다리세요."}` : result}</div><div class="spell-actions"><button class="primary" data-spell="stupefy" ${canAct ? "" : "disabled"}>기절 주문 <small>집중 · 공격</small></button><button class="ghost" data-spell="lumos" ${canAct ? "" : "disabled"}>빛의 주문 <small>지혜 · 공격</small></button><button class="ghost" data-spell="shield" ${canAct ? "" : "disabled"}>방패 주문 <small>용기 · 방어/회복</small></button><button class="ghost" data-spell="focus" ${canAct ? "" : "disabled"}>집중 <small>다음 공격 강화</small></button></div>${combat.status !== "active" ? `<button class="text-button reset-combat" id="reset-combat">전투 기록 닫기</button>` : ""}</div>`;
}
async function gameAction(action, extra = {}) {
  try {
    state.room = await api(`/api/rooms/${state.room.code}/game`, { method: "POST", body: JSON.stringify({ action, memberId: state.member.id, ...extra }) });
    if (action === "start-combat") state.view = "explore";
    render();
  } catch (err) { alert(err.message); }
}
function connect() {
  state.stream = new EventSource(`/api/rooms/${state.room.code}/events`);
  state.stream.addEventListener("room", (event) => { state.room = JSON.parse(event.data); render(); });
}
landing();

const state = { room: null, member: null, stream: null, operatorToken: sessionStorage.getItem("operatorToken"), view: "map" };
const app = document.querySelector("#app");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청을 처리하지 못했습니다.");
  return data;
}
function landing(error = "") {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">private text roleplaying game · 001</div><h1>마법학교의 기록실</h1><p>넓은 학교 맵을 탐험하고, 수업과 사건을 거쳐, 다른 캐릭터와 장면을 만들어 가는 텍스트 RPG.</p><div class="card"><h2>기록실 입장</h2><p class="hint">운영자에게 받은 초대 코드를 입력하세요.</p><div class="join"><input class="input" id="room-code" placeholder="초대 코드"><button class="primary" id="join">입장하기</button></div><p class="hint error">${esc(error)}</p></div><button class="text-button" id="operator">운영자 로그인</button></div></div>`;
  document.querySelector("#join").onclick = async () => { try { state.room = await api(`/api/rooms/${document.querySelector("#room-code").value.trim().toUpperCase()}`); identify(); } catch (e) { landing(e.message); } };
  document.querySelector("#operator").onclick = operatorLogin;
}
function identify() {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">enter the archive</div><h1>플레이어 이름을<br>기록해 주세요.</h1><div class="card create"><input class="input" id="name" placeholder="예: 은빛 잉크"><button class="primary" id="enter">입장</button></div></div></div>`;
  document.querySelector("#enter").onclick = async () => { try { state.member = await api(`/api/rooms/${state.room.code}/members`, { method: "POST", body: JSON.stringify({ name: document.querySelector("#name").value.trim() || "익명의 마법사" }) }); render(); connect(); } catch (e) { identify(); } };
}
function operatorLogin(error = "") {
  app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">operator access</div><h1>운영자 전용<br>기록 관리</h1><div class="card create"><input class="input" id="operator-code" type="password" placeholder="운영 코드"><button class="primary" id="operator-enter">확인</button></div><p class="hint error">${esc(error)}</p></div></div>`;
  document.querySelector("#operator-enter").onclick = async () => { try { const result = await api("/api/operator/login", { method: "POST", body: JSON.stringify({ code: document.querySelector("#operator-code").value }) }); state.operatorToken = result.token; sessionStorage.setItem("operatorToken", result.token); operatorPanel(); } catch (e) { operatorLogin(e.message); } };
}
async function operatorPanel() {
  try {
    const rooms = await api("/api/admin/rooms", { headers: { Authorization: `Bearer ${state.operatorToken}` } });
    app.innerHTML = `<div class="shell"><div class="hero"><div class="eyebrow">operator dashboard</div><h1>기록실 관리</h1><div class="card"><h2>새 기록실 열기</h2><div class="create"><input class="input" id="room-name" value="별관의 첫 번째 학기"><button class="primary" id="create">열기</button></div><div class="room-list">${rooms.map((room) => `<div class="room-row"><span>${esc(room.name)}</span><strong>${room.code}</strong></div>`).join("") || "<p class='hint'>아직 열린 기록실이 없습니다.</p>"}</div></div><button class="text-button" id="logout">운영자 로그아웃</button></div></div>`;
    document.querySelector("#create").onclick = async () => { await api("/api/rooms", { method: "POST", headers: { Authorization: `Bearer ${state.operatorToken}` }, body: JSON.stringify({ name: document.querySelector("#room-name").value }) }); operatorPanel(); };
    document.querySelector("#logout").onclick = () => { sessionStorage.removeItem("operatorToken"); state.operatorToken = null; landing(); };
  } catch (e) { operatorLogin(e.message); }
}
function render() {
  const room = state.room;
  app.innerHTML = `<div class="rpg-shell"><aside class="rpg-left"><div class="brand">✦ 기록실</div><div class="room-code"><small>INVITE CODE</small><div class="code">${room.code}</div></div><div class="profile"><div class="avatar">${esc(state.member.name.slice(0, 1))}</div><div><strong>${esc(state.member.name)}</strong><small>1학년 · 견습 마법사</small></div></div><div class="nav-title">게임 메뉴</div><button class="nav-item ${state.view === "map" ? "active" : ""}" data-view="map">▦ 학교 맵</button><button class="nav-item ${state.view === "character" ? "active" : ""}" data-view="character">◇ 캐릭터 설정</button><button class="nav-item ${state.view === "class" ? "active" : ""}" data-view="class">✦ 수업과 주문</button><button class="nav-item ${state.view === "combat" ? "active" : ""}" data-view="combat">⚔ 탐험과 전투</button></aside><main class="rpg-main"><header class="rpg-top"><div><small>${esc(room.term)}</small><h2>${esc(room.name)}</h2></div><span class="phase">${esc(room.phase)}</span></header><div class="rpg-body" id="rpg-body"></div></main><aside class="rpg-chat"><div class="chat-head"><div><small>LIVE RP</small><h3>장면 기록</h3></div><span class="live-dot">●</span></div><div class="chat-feed" id="chat-feed"></div><form id="chat-form" class="chat-form"><select id="chat-kind"><option value="rp">서술</option><option value="dialogue">대사</option><option value="ooc">메타</option></select><input class="input" id="chat-text" placeholder="이 장면을 기록하기..."><button class="primary">↑</button></form></aside></div>`;
  document.querySelectorAll("[data-view]").forEach((button) => button.onclick = () => { state.view = button.dataset.view; render(); });
  document.querySelector("#chat-form").onsubmit = async (event) => { event.preventDefault(); const input = document.querySelector("#chat-text"); if (!input.value.trim()) return; await api(`/api/rooms/${room.code}/messages`, { method: "POST", body: JSON.stringify({ author: state.member.name, authorId: state.member.id, kind: document.querySelector("#chat-kind").value, text: input.value }) }); input.value = ""; };
  updateChat();
  renderView();
}
function updateChat() {
  const feed = document.querySelector("#chat-feed");
  if (!feed) return;
  feed.innerHTML = state.room.messages.slice(-30).map((m) => m.system ? `<div class="chat-system">${esc(m.text)}</div>` : `<div class="chat-message"><b>${esc(m.author)}</b><small>${m.kind === "dialogue" ? "대사" : m.kind === "ooc" ? "메타" : "서술"}</small><p>${esc(m.text)}</p></div>`).join("");
  feed.scrollTop = feed.scrollHeight;
}
function renderView() {
  const root = document.querySelector("#rpg-body");
  const locations = state.room.locations || {};
  if (state.view === "map") {
    const tiles = ["tower", "library", "classroom", "greenhouse", "banquet", "lobby", "potions", "infirmary", "dueling", "grounds", "lake", "village"];
    root.innerHTML = `<div class="view-intro"><div class="eyebrow">school atlas · ${esc(state.room.game.locationLabel)}</div><h1>학교 지도</h1><p>타일을 선택해 장소를 이동하세요. 장소마다 수업, 조사, 회복, 사회 장면, 전투가 기다리고 있습니다.</p></div><div class="map-grid">${tiles.map((id) => { const spot = locations[id]; return `<button class="map-tile ${id === state.room.game.location ? "current" : ""} type-${spot.type}" data-location="${id}"><span class="tile-icon">${spot.icon}</span><strong>${esc(spot.label)}</strong><small>${esc(spot.description)}</small><em>${id === state.room.game.location ? "현재 위치" : spot.type === "combat" ? "위험 지역" : "이동하기"}</em></button>`; }).join("")}</div>`;
  } else if (state.view === "character") renderCharacter(root);
  else if (state.view === "class") root.innerHTML = `<div class="view-intro"><div class="eyebrow">academy systems</div><h1>수업과 주문</h1><p>수업을 선택하면 능력치와 전투 선택지가 확장됩니다.</p><div class="lesson-grid">${state.room.lessons.map((lesson) => `<div class="lesson-card"><span>${lesson.icon}</span><strong>${esc(lesson.label)}</strong><small>${lesson.level ? `숙련도 Lv.${lesson.level}` : "잠겨 있음"}</small><button class="ghost" data-lesson="${lesson.id}">수업 기록 보기</button></div>`).join("")}</div>`;
  else renderCombat(root);
  document.querySelectorAll("[data-location]").forEach((tile) => tile.onclick = () => gameAction("location", { location: tile.dataset.location }));
  document.querySelectorAll("[data-spell]").forEach((button) => button.onclick = () => gameAction("combat", { spell: button.dataset.spell }));
  document.querySelector("#start-combat")?.addEventListener("click", () => gameAction("start-combat"));
  document.querySelector("#reset-combat")?.addEventListener("click", () => gameAction("reset-combat"));
}
function renderCharacter(root) {
  const member = state.room.members.find((item) => item.id === state.member.id) || state.member;
  const sheet = member.characterSheet || {};
  root.innerHTML = `<div class="view-intro"><div class="eyebrow">character dossier</div><h1>캐릭터 설정</h1><p>이 기록은 장면과 판정의 재료가 됩니다. 공개하고 싶은 만큼만 작성하세요.</p></div><form id="character-form" class="character-form"><div class="form-section"><h3>기본 정보</h3><div class="form-grid"><label>캐릭터 이름<input class="input" name="name" value="${esc(member.name)}"></label><label>호칭 / 별명<input class="input" name="alias" value="${esc(sheet.alias)}"></label><label>기숙사 또는 소속<input class="input" name="house" value="${esc(sheet.house)}" placeholder="예: 북쪽 탑"></label><label>출신 배경<input class="input" name="origin" value="${esc(sheet.origin)}" placeholder="예: 마법사 가문"></label></div></div><div class="form-section"><h3>마법과 성향</h3><div class="form-grid"><label>지팡이 / 도구<input class="input" name="wand" value="${esc(sheet.wand)}"></label><label>성격 키워드<input class="input" name="temperament" value="${esc(sheet.temperament)}" placeholder="예: 호기심, 신중함"></label><label>가장 두려운 것<input class="input" name="fear" value="${esc(sheet.fear)}"></label><label class="wide">캐릭터 배경<textarea class="input" name="background" rows="4">${esc(sheet.background)}</textarea></label></div></div><div class="character-stats"><div><span>용기</span><strong>${member.stats.courage}</strong></div><div><span>지혜</span><strong>${member.stats.wit}</strong></div><div><span>집중</span><strong>${member.stats.focus}</strong></div><div><span>경험치</span><strong>${member.xp} / 100</strong></div></div><button class="primary save-character">캐릭터 시트 저장</button><p id="character-status" class="hint"></p></form>`;
  document.querySelector("#character-form").onsubmit = async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { state.member = await api(`/api/rooms/${state.room.code}/members`, { method: "PATCH", body: JSON.stringify({ memberId: state.member.id, name: data.name, characterSheet: data }) }); document.querySelector("#character-status").textContent = "저장되었습니다."; } catch (e) { document.querySelector("#character-status").textContent = e.message; } };
}
function renderCombat(root) {
  const combat = state.room.game.combat;
  root.innerHTML = `<div class="view-intro"><div class="eyebrow">encounter zone</div><h1>탐험과 전투</h1><p>성 바깥뜰과 결투장에서 파티의 선택으로 전투를 진행합니다.</p></div>${combat ? combatPanel(combat) : `<div class="encounter-card"><span class="enemy-icon">☽</span><h2>성 바깥뜰의 흔적</h2><p>어둠 속에서 무언가가 움직입니다. 파티를 준비하고 전투를 시작하세요.</p><button class="primary" id="start-combat">전투 시작</button></div>`}`;
}
function combatPanel(combat) {
  const activeId = combat.turnOrder[combat.activeIndex];
  const active = state.room.members.find((member) => member.id === activeId);
  const canAct = combat.status === "active" && activeId === state.member.id;
  return `<div class="combat-card"><div class="combat-head"><span class="phase">${combat.status === "victory" ? "승리 · 경험치 +30" : combat.status === "defeat" ? "패배" : `ROUND ${combat.round} · ${combat.phase === "players" ? "플레이어 차례" : "적 차례"}`}</span><strong>${esc(combat.enemy.name)} · ${combat.enemyHp}/${combat.enemyMaxHp}</strong></div><div class="bar enemy-bar"><i style="width:${combat.enemyHp / combat.enemyMaxHp * 100}%"></i></div><div class="initiative">${combat.turnOrder.map((id, i) => { const player = state.room.members.find((m) => m.id === id); return `<span class="${i === combat.activeIndex && combat.status === "active" ? "turn-active" : ""}">${i + 1}. ${esc(player?.name || "플레이어")}</span>`; }).join("")}</div><div class="combat-log">${combat.log.slice(-6).reverse().map((line) => `<div>${esc(line.text)}</div>`).join("")}</div><div class="turn-callout">${combat.status === "active" ? `${esc(active?.name || "플레이어")}의 차례입니다.${canAct ? " 행동을 선택하세요." : " 다른 플레이어를 기다리는 중입니다."}` : "전투가 종료되었습니다."}</div><div class="spell-actions"><button class="primary" data-spell="stupefy" ${canAct ? "" : "disabled"}>기절 주문<small>집중 · 공격</small></button><button class="ghost" data-spell="lumos" ${canAct ? "" : "disabled"}>빛의 주문<small>지혜 · 공격</small></button><button class="ghost" data-spell="shield" ${canAct ? "" : "disabled"}>방패 주문<small>용기 · 방어</small></button><button class="ghost" data-spell="focus" ${canAct ? "" : "disabled"}>집중<small>다음 공격 강화</small></button></div>${combat.status !== "active" ? `<button class="text-button" id="reset-combat">전투 기록 닫기</button>` : ""}</div>`;
}
async function gameAction(action, extra = {}) { try { state.room = await api(`/api/rooms/${state.room.code}/game`, { method: "POST", body: JSON.stringify({ action, memberId: state.member.id, ...extra }) }); if (action === "start-combat") state.view = "combat"; render(); } catch (e) { alert(e.message); } }
function connect() { state.stream = new EventSource(`/api/rooms/${state.room.code}/events`); state.stream.addEventListener("room", (event) => { state.room = JSON.parse(event.data); updateChat(); if (state.view === "combat") renderView(); }); }
landing();

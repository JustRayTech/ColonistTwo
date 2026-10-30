
/* ============================================================================
   COLONISTS — GAME LOGIC
   ============================================================================ */

// ---------------------------------------------------------------------------
// FIREBASE CONFIGURATION
// ---------------------------------------------------------------------------

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA4G46NAn-RFWz0l6sx-o2e3RzeUkKjtMg",
  authDomain: "kolonisten-df6cb.firebaseapp.com",
  databaseURL: "https://kolonisten-df6cb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kolonisten-df6cb",
  storageBucket: "kolonisten-df6cb.firebasestorage.app",
  messagingSenderId: "372541702579",
  appId: "1:372541702579:web:e48be1d520cabb85a70bc6",
  measurementId: "G-SEWN7CKHXX"
};

// ---------------------------------------------------------------------------
// GAME CONSTANTS
// ---------------------------------------------------------------------------

const RESOURCE_TYPES = ["wood", "brick", "wool", "grain", "ore"];

const RESOURCE_DETAILS = {
  wood: ["🪵", "Wood"],
  brick: ["🧱", "Brick"],
  wool: ["🐑", "Wool"],
  grain: ["🌾", "Grain"],
  ore: ["🪨", "Ore"]
};

const BUILDING_COSTS = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, grain: 1, wool: 1 },
  city: { ore: 3, grain: 2 },
  port: { wood: 2, brick: 2, ore: 1 },
  dev: { grain: 1, wool: 1, ore: 1 }
};

const PLAYER_COLORS = [
  "#e06b5c",
  "#5ca9e0",
  "#e5b84f",
  "#8dce8c",
  "#bd8be0",
  "#e08bb0"
];

const TERRAIN_LAYOUT = [
  ["wood", "#78a96b"], ["wood", "#78a96b"], ["wood", "#78a96b"],
  ["brick", "#c87962"], ["brick", "#c87962"],
  ["wool", "#8cc5a0"], ["wool", "#8cc5a0"], ["wool", "#8cc5a0"],
  ["grain", "#dfc875"], ["grain", "#dfc875"], ["grain", "#dfc875"],
  ["ore", "#8f9eac"], ["ore", "#8f9eac"],
  ["desert", "#d6bd8a"], ["wood", "#78a96b"],
  ["wool", "#8cc5a0"], ["grain", "#dfc875"], ["ore", "#8f9eac"],
  ["brick", "#c87962"]
];

const TOAST_DURATION = 6500;

var localplayerName = "Unknown";

const getElementById = elementId => document.getElementById(elementId);

let state = null;
let currentPlayerId = null;
let mode = "select";
let isOnlineGame = false;
let database = null;
let roomDatabaseReference = null;
let globalToastDatabaseReference = null;
let unsubscribeFromRoom = null;
let unsubscribeFromGlobalToasts = null;
let isLocalGame = false;
let firebaseTools = null;
let syncQueue = Promise.resolve();

// -- // Independent toast state
let localToastTimer = null;
let globalToastTimer = null;
let lastGlobalToastId = null;

// ---------------------------------------------------------------------------
// ROOM UTILITIES
// ---------------------------------------------------------------------------

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

window.addEventListener("DOMContentLoaded", () => {
  const nameElement = getElementById("lobbyCreatorName");
  if (!nameElement) return;

  const playerName =
    sessionStorage.getItem("lobbyCreatorName") || "Name not found";

  nameElement.textContent = `Your name: ${playerName}`;
});

// ---------------------------------------------------------------------------
// SLIDER INITIALIZATION
// ---------------------------------------------------------------------------

document.querySelectorAll('input[type="range"]').forEach(slider => {
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const step = Number(slider.step) || 1;
  const container = slider.parentElement.querySelector(".slider-labels");

  function updateSlider() {
    const value = Number(slider.value);
    const progress = max > min
      ? ((value - min) / (max - min)) * 100
      : 0;

    slider.style.setProperty("--slider-progress", `${progress}%`);
  }

  slider.addEventListener("input", updateSlider);
  updateSlider();

  if (!container || max <= min || step <= 0) return;

  container.replaceChildren();

  let customLabels = {};

  try {
    customLabels = JSON.parse(slider.dataset.labels || "{}");
  } catch {
    console.warn(`Invalid data-labels JSON on slider "${slider.id}"`);
  }

  const values = [];

  for (let value = min; value < max; value += step) {
    values.push(value);
  }

  if (values[values.length - 1] !== max) {
    values.push(max);
  }

  values.forEach(value => {
    const label = document.createElement("span");
    label.textContent = customLabels[value] ?? value;

    const progress = ((value - min) / (max - min)) * 100;
    label.style.left = `${progress}%`;

    if (progress === 0) {
      label.style.transform = "translateX(0)";
    } else if (progress === 100) {
      label.style.transform = "translateX(-100%)";
    } else {
      label.style.transform = "translateX(-50%)";
    }

    container.appendChild(label);
  });
});

// ---------------------------------------------------------------------------
// TOAST SYSTEM
// ---------------------------------------------------------------------------

// -- // Automatically determine toast type

function noticeKind(message, explicit = null) {
  if (explicit) return explicit;

  if (/not enough|already occupied|already used|occupied|must|needs?|cannot|can't|wait for|not your turn|choose two|roll the dice before|ports can only|upgrade one|at least two players|settlements need|road edge is already|opening order|costs? \d|port needs/i.test(message)) {
    return "error";
  }

  if (/received|built|placed|upgraded|traded|bought|wins|resource distribution complete|opening placement complete/i.test(message)) {
    return "success";
  }

  return "info";
}

// -- // Local toast
// Never accesses Firebase or game synchronization.

function SendLocalToast(message, type = null) {
  const box = getElementById("gameNoticeLocal");

  if (!box) return;

  clearTimeout(localToastTimer);

  box.textContent = message;
  box.className = `game-notice ${noticeKind(message, type)}`;

  localToastTimer = setTimeout(() => {
    box.classList.add("hidden");
    localToastTimer = null;
  }, TOAST_DURATION);
}

// -- // Global toast
// Sends exclusively to other players through a separate Firebase path.

async function SendGlobalToast(message, type = null, specificTargetOnlyId = 0) {
  if (!isOnlineGame || !globalToastDatabaseReference || !firebaseTools) {
    return;
  }

  const toast = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    message,
    kind: noticeKind(message, type),
    senderId: currentPlayerId,
    specificTarget: specificTargetOnlyId,
    timestamp: Date.now()
  };

  try {
    await firebaseTools.set(globalToastDatabaseReference, toast);
  } catch (error) {
    console.error("Failed to send global toast:", error);
  }
}

// -- // Display incoming global toast
// The sender is always ignored.

function handleGlobalToast(toast) {
  if (!toast?.id) return;

  if (toast.senderId === currentPlayerId) return; // Ignore something that we sent ourselves.
  if (toast.specificTarget != 0) { // Is there a specific target?
    if (toast.specificTarget != currentPlayerId) {
      return;
    }else{} // Toast intended only for us
  }

  if (toast.id === lastGlobalToastId) return;

  // -- // Ignore expired notifications
  if (Date.now() - toast.timestamp > TOAST_DURATION) return;

  const box = getElementById("gameNoticeGlobal");

  if (!box) return;

  lastGlobalToastId = toast.id;

  clearTimeout(globalToastTimer);

  box.textContent = toast.message;
  box.className = `game-notice ${toast.kind || "info"}`;

  globalToastTimer = setTimeout(() => {
    if (lastGlobalToastId === toast.id) {
      box.classList.add("hidden");
      lastGlobalToastId = null;
    }
  }, TOAST_DURATION);

}

// -- // Subscribe to the independent global toast channel

function subscribeToGlobalToasts(roomCode) {
  if (unsubscribeFromGlobalToasts) {
    unsubscribeFromGlobalToasts();
    unsubscribeFromGlobalToasts = null;
  }

  globalToastDatabaseReference = firebaseTools.ref(
    database,
    `roomToasts/${roomCode}`
  );

  lastGlobalToastId = null;

  unsubscribeFromGlobalToasts = firebaseTools.onValue(
    globalToastDatabaseReference,
    snapshot => {
      if (!snapshot.exists()) return;

      handleGlobalToast(snapshot.val());
    }
  );
}

// ---------------------------------------------------------------------------
// BOARD GENERATION
// ---------------------------------------------------------------------------

function createBoard(mapSize = 2) {
  const cells = [];
  const vertices = {};
  const roadEdges = {};

  const radius = {
    1: 1,
    2: 2,
    3: 3
  }[Number(mapSize)] || 1;

  const baseTerrain = {};
  let terrainIndex = 0;

  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      if (Math.abs(s) > 2) continue;

      baseTerrain[`${q},${r}`] = TERRAIN_LAYOUT[terrainIndex++];
    }
  }

  const terrainColors = {
    wood: "#78a96b",
    brick: "#c87962",
    wool: "#8cc5a0",
    grain: "#dfc875",
    ore: "#8f9eac",
    desert: "#d6bd8a"
  };

  const numberOptions = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const s = -q - r;
      if (Math.abs(s) > radius) continue;

      let terrain = baseTerrain[`${q},${r}`];

      if (!terrain) {
        const type = RESOURCE_TYPES[
          Math.floor(Math.random() * RESOURCE_TYPES.length)
        ];

        terrain = [type, terrainColors[type]];
      }

      const number = terrain[0] === "desert"
        ? 0
        : numberOptions[
          Math.floor(Math.random() * numberOptions.length)
        ];

      cells.push({
        q,
        r,
        s,
        terrain: terrain[0],
        color: terrain[1],
        number
      });
    }
  }

  function getHexCenter(q, r) {
    return {
      x: 380 + q * 76 + r * 38,
      y: 300 + r * 66
    };
  }

  cells.forEach(cell => {
    const center = getHexCenter(cell.q, cell.r);
    cell.verts = [];

    for (let cornerIndex = 0; cornerIndex < 6; cornerIndex++) {
      const angle =
        (cornerIndex - 1) * Math.PI / 3 - Math.PI / 6;

      const x = Math.round(center.x + 44 * Math.cos(angle));
      const y = Math.round(center.y + 44 * Math.sin(angle));
      const vertexId = `${x},${y}`;

      if (!vertices[vertexId]) {
        vertices[vertexId] = {
          id: vertexId,
          x,
          y,
          edges: []
        };
      }

      cell.verts.push(vertexId);
    }
  });

  cells.forEach(cell => {
    cell.edges = [];

    for (let cornerIndex = 0; cornerIndex < 6; cornerIndex++) {
      const startVertex = cell.verts[cornerIndex];
      const endVertex = cell.verts[(cornerIndex + 1) % 6];

      const edgeId = [startVertex, endVertex].sort().join("|");

      if (!roadEdges[edgeId]) {
        roadEdges[edgeId] = {
          id: edgeId,
          a: startVertex,
          b: endVertex
        };
      }

      cell.edges.push(edgeId);
    }
  });

  Object.values(roadEdges).forEach(edge => {
    vertices[edge.a].edges.push(edge.id);
    vertices[edge.b].edges.push(edge.id);
  });

  return {
    cells,
    verts: vertices,
    edges: roadEdges
  };
}

// ---------------------------------------------------------------------------
// GAME STATE
// ---------------------------------------------------------------------------

function createNewGameState(code, name, config = {}) {
  const mapSize = [1, 2, 3].includes(Number(config.mapSize))
    ? Number(config.mapSize)
    : 1;

  const maxPlayers = Math.max(
    2,
    Math.min(6, Number(config.maxPlayers) || 4)
  );

  const victoryPointsNeeded = Math.max(
    5,
    Math.min(15, Number(config.victoryPointsNeeded) || 10)
  );

  const board = createBoard(mapSize);

  const player = {
    id: currentPlayerId,
    name: name || "Colonist",
    color: PLAYER_COLORS[0],
    res: {
      wood: 0,
      brick: 0,
      wool: 0,
      grain: 0,
      ore: 0
    },
    pieces: {
      road: 0,
      settlement: 0,
      city: 0,
      port: 0
    },
    dev: [],
    points: 0
  };


  return {
    code,
    host: currentPlayerId,
    players: [player],
    maxPlayers,
    mapSize,
    victoryPointsNeeded,
    turn: 0,
    phase: "lobby",
    setupOrder: [],
    setupIndex: 0,
    setupStep: "settlement",
    setupSettlement: null,
    rolled: false,
    dice: null,
    board,
    roads: {},
    buildings: {},
    ports: {},
    logs: [`${player.name} founded room ${code}.`],
    winner: null,
    round: 0
  };
}

// ---------------------------------------------------------------------------
// ROOM NORMALIZATION
// ---------------------------------------------------------------------------

function normalizeRoomState(s) {
  if (!s || typeof s !== "object") return s;

  if (!Number.isFinite(s.maxPlayers)) s.maxPlayers = 4;
  if (!Number.isFinite(s.mapSize)) s.mapSize = 1;

  if (!Number.isFinite(s.victoryPointsNeeded)) {
    s.victoryPointsNeeded = 10;
  }

  s.players = Array.isArray(s.players)
    ? s.players
    : Object.values(s.players || {});

  s.roads = s.roads && typeof s.roads === "object" ? s.roads : {};
  s.buildings = s.buildings && typeof s.buildings === "object" ? s.buildings : {};
  s.ports = s.ports && typeof s.ports === "object" ? s.ports : {};
  s.logs = Array.isArray(s.logs) ? s.logs : Object.values(s.logs || {});

  if (s.board?.verts) {
    for (const vertex of Object.values(s.board.verts)) {
      delete vertex.cells;
      vertex.edges = Array.isArray(vertex.edges) ? vertex.edges : [];
    }
  }

  if (s.board?.edges) {
    for (const edge of Object.values(s.board.edges)) {
      delete edge.cells;
    }
  }

  s.players.forEach((player, i) => {
    player.res = player.res && typeof player.res === "object"
      ? player.res
      : {};

    for (const resource of RESOURCE_TYPES) {
      if (!Number.isFinite(player.res[resource])) {
        player.res[resource] = 0;
      }
    }

    player.pieces = player.pieces && typeof player.pieces === "object"
      ? player.pieces
      : {};

    for (const piece of ["road", "settlement", "city", "port"]) {
      if (!Number.isFinite(player.pieces[piece])) {
        player.pieces[piece] = 0;
      }
    }

    if (!Array.isArray(player.dev)) {
      player.dev = Object.values(player.dev || {});
    }

    if (!Number.isFinite(player.points)) player.points = 0;
    if (!player.color) player.color = PLAYER_COLORS[i % PLAYER_COLORS.length];
  });

  if (!s.phase) s.phase = "play";
  if (!Number.isFinite(s.turn)) s.turn = 0;
  if (typeof s.rolled !== "boolean") s.rolled = false;
  if (!Array.isArray(s.setupOrder)) s.setupOrder = [];
  if (!Number.isFinite(s.setupIndex)) s.setupIndex = 0;
  if (!s.setupStep) s.setupStep = "settlement";
  if (!Array.isArray(s.logs)) s.logs = [];

  return s;
}

// ---------------------------------------------------------------------------
// PLAYER HELPERS
// ---------------------------------------------------------------------------

function getCurrentPlayer() {
  if (!state || !state.players?.length) return null;

  if (state.phase === "setup") {
    return state.players.find(
      player => player.id === state.setupOrder?.[state.setupIndex]
    );
  }

  return state.players[state.turn % state.players.length];
}

function getLocalPlayer() {
  return state?.players.find(player => player.id === currentPlayerId);
}

function isPlayersTurn() {
  return !!state &&
    (state.phase === "setup" || state.phase === "play") &&
    !!getLocalPlayer() &&
    getCurrentPlayer()?.id === currentPlayerId &&
    !state.winner;
}

function notify(message) {
  const messageBox = getElementById("setupMsg");

  if (messageBox) {
    messageBox.textContent = message;
    messageBox.classList.remove("hidden");
  } else {
    alert(message);
  }
}

// ---------------------------------------------------------------------------
// STATUS AND RENDERING
// ---------------------------------------------------------------------------

var previousPlr = 1;
function updateStatus() {
  if (!state) return;

  getElementById("roomBadge").textContent =
    `ROOM ${state.code}${isOnlineGame ? " · ONLINE" : " · LOCAL"}`;

  getElementById("roomTitle").textContent = `Colonists · ${state.code}`;

  const active = getCurrentPlayer();

  if (state.phase == "play" && !state.rolled) {
    if (isPlayersTurn()) {
      SendLocalToast("It's your turn, roll the dice or use a development card.", "info")
    }else{
      SendLocalToast(`It's ${active.name}'s turn to play.`, "NONE")
    }
  }

  if (state.phase == "lobby") {
    if (previousPlr != state.players.length) {
      previousPlr = state.players.length

      if (state.players[state.players.length - 1].id != currentPlayerId) {
        SendLocalToast(`${state.players[state.players.length - 1].name || "Unknown"} has joined the room`, "success")
      }
    }
  }
  
  const secondRound = state.setupIndex >= state.players.length;
  if (active?.id == currentPlayerId) {
    if (state.phase == "setup") {

      if (state.setupStep == "settlement") {
        if (secondRound) {
          SendLocalToast("It's your turn, place your final settlement.", "info");
        }else{
          if (state.setupIndex == 0) {
            SendLocalToast("Opening placements have started, you are first. Place a settlement.", "info");
          }else{
            SendLocalToast("It's your turn, place a settlement.", "info");
          }
        }
      }else{
        if (!secondRound) { // Prevent overwriting gained resources.
          SendLocalToast("Place a road attached to the settlement.", "info")
        }
      }
    }
  }else{
      if (state.phase == "setup") {
        if (state.setupStep == "settlement") {
          if (state.setupIndex == 0) {
            SendLocalToast(`Opening placements have started. ${active.name} is first.`, "NONE")
          }else{
            if (secondRound) {
              SendLocalToast(`It's ${active.name}'s turn to place their final settlement.`, "NONE")
            }else{
              SendLocalToast(`It's ${active.name}'s turn to place an opening settlement.`, "NONE")
            }
          }
        }
      }
  } 

  if (state.winner) {
    getElementById("turnText").textContent = `${state.winner} wins!`;
  } else if (state.phase === "lobby") {

    if (state.host == currentPlayerId) {
      if (state.players.length == 1) {
          SendLocalToast(
          `Your room has been created! Invite other players using the code '${state.code}'.`,
          "success"
        );
      }
    }

    getElementById("turnText").textContent =
      state.host === currentPlayerId
        ? `Lobby · ${state.players.length}/${state.maxPlayers} players · start when everyone has joined`
        : `Lobby · waiting for the host to start (${state.players.length}/${state.maxPlayers} players)`;
  } else if (state.phase === "setup") {
    const action = state.setupStep === "settlement"
      ? "place a settlement"
      : "place a road connected to that settlement";

    getElementById("turnText").textContent =
      active?.id === currentPlayerId
        ? `Opening placement ${state.setupIndex + 1}/${state.setupOrder.length} · Your turn to ${action}`
        : `Opening placement ${state.setupIndex + 1}/${state.setupOrder.length} · ${active?.name} to ${action}`;
  } else {
    getElementById("turnText").textContent =
      active?.id === currentPlayerId
        ? `Your turn${state.rolled ? " — build, trade, or end turn" : " — roll to begin"}`
        : `${active?.name}'s turn`;
  }

  getElementById("diceDisplay").textContent = state.dice
    ? `🎲 ${state.dice[0]} + ${state.dice[1]} = ${state.dice[0] + state.dice[1]}`
    : "🎲 —";

  getElementById("startPlacementBtn").classList.toggle(
    "hidden",
    state.phase !== "lobby" || state.host !== currentPlayerId
  );

  getElementById("startPlacementBtn").disabled =
    state.phase !== "lobby" ||
    state.host !== currentPlayerId ||
    state.players.length < 2;

  getElementById("rollBtn").disabled =
    !isPlayersTurn() || state.phase !== "play" || state.rolled;

  getElementById("endBtn").disabled =
    !isPlayersTurn() || state.phase !== "play" || !state.rolled;
}

function renderResourceInventory() {
  const player = getLocalPlayer();

  getElementById("resourceBox").innerHTML = RESOURCE_TYPES.map(resource =>
    `<div class="resource"><div class="emoji">${RESOURCE_DETAILS[resource][0]}</div><strong>${player?.res[resource] || 0}</strong><small>${RESOURCE_DETAILS[resource][1]}</small></div>`
  ).join("");

  for (const id of ["giveResource", "getResource"]) {
    getElementById(id).innerHTML = RESOURCE_TYPES.map(resource =>
      `<option value="${resource}">${RESOURCE_DETAILS[resource][0]} ${RESOURCE_DETAILS[resource][1]}</option>`
    ).join("");
  }

  getElementById("getResource").selectedIndex = 1;
}

function renderPlayerList() {
  const activeId = getCurrentPlayer()?.id;

  getElementById("playersBox").innerHTML = state.players.map(player =>
    `<div class="player ${player.id === activeId && state.phase !== "lobby" && !state.winner ? "active" : ""}"><span class="dot" style="background:${player.color}"></span><div class="grow"><b>${esc(player.name)} ${player.id === currentPlayerId ? "(you)" : ""}</b><span class="small muted">${player.points} VP · ${Object.values(player.res).reduce((a, b) => a + b, 0)} resources</span></div><b>${player.points}</b></div>`
  ).join("");
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function svgEl(tag, attrs = {}, text = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);

  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }

  if (text) element.textContent = text;

  return element;
}

// ---------------------------------------------------------------------------
// BOARD RENDERING
// ---------------------------------------------------------------------------

function renderGameBoard() {
  const svg = getElementById("board");
  svg.innerHTML = "";

  if (!state) return;

  const board = state.board;

  if (!board?.cells || !board?.verts || !board?.edges) {
    svg.append(svgEl("text", {
      x: 380,
      y: 300,
      fill: "#edf4f5",
      "text-anchor": "middle"
    }, "Board data is incomplete. Create a new room."));

    return;
  }

  state.roads ||= {};
  state.buildings ||= {};
  state.ports ||= {};

  board.cells.forEach(cell => {
    const points = cell.verts.map(id =>
      `${board.verts[id].x},${board.verts[id].y}`
    ).join(" ");

    const polygon = svgEl("polygon", {
      points,
      fill: cell.color,
      class: "hex"
    });

    polygon.addEventListener("click", () => {});
    svg.append(polygon);

    const centerX =
      (board.verts[cell.verts[0]].x + board.verts[cell.verts[3]].x) / 2;

    const centerY =
      (board.verts[cell.verts[0]].y + board.verts[cell.verts[3]].y) / 2;

    svg.append(svgEl("text", {
      x: centerX,
      y: centerY - 3,
      class: "hex-label"
    }, cell.terrain === "desert"
      ? "🏜"
      : RESOURCE_DETAILS[cell.terrain]?.[0] || ""
    ));

    if (cell.number) {
      const highlighted = Number(cell.number) === 6 ||
        Number(cell.number) === 8;

      const x = centerX;
      const y = centerY + 16;

      svg.append(svgEl("circle", {
        cx: x,
        cy: y,
        r: 13,
        fill: "#e9e2d1",
        stroke: "#5d4b34",
        "stroke-width": 1
      }));

      svg.append(svgEl("text", {
        x,
        y,
        class: highlighted ? "hex-num hex-num-highlight" : "hex-num"
      }, cell.number));
    }
  });

  Object.values(board.edges).forEach(edge => {
    const a = board.verts[edge.a];
    const b = board.verts[edge.b];

    svg.append(svgEl("line", {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: "#13252c",
      "stroke-width": 2,
      opacity: 0.7
    }));

    const road = state.roads[edge.id];

    if (road) {
      svg.append(svgEl("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: state.players.find(player => player.id === road.owner)?.color || "#fff",
        "stroke-width": 8,
        "stroke-linecap": "round"
      }));
    }

    if (mode === "road") {
      const hit = svgEl("line", {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        stroke: "transparent",
        "stroke-width": 18,
        cursor: "pointer"
      });

      hit.addEventListener("click", () => buildOnBoard("road", edge.id));
      svg.append(hit);
    }
  });

  Object.values(board.verts).forEach(vertex => {
    const building = state.buildings[vertex.id];

    if (building) {
      const owner = state.players.find(player => player.id === building.owner);
      const fill = owner?.color || "#fff";

      if (building.type === "city") {
        svg.append(svgEl("rect", {
          x: vertex.x - 12,
          y: vertex.y - 17,
          width: 24,
          height: 20,
          rx: 3,
          fill,
          class: "settlement"
        }));

        svg.append(svgEl("path", {
          d: `M${vertex.x - 15} ${vertex.y - 17} L${vertex.x} ${vertex.y - 30} L${vertex.x + 15} ${vertex.y - 17} Z`,
          fill,
          class: "settlement"
        }));
      } else {
        svg.append(svgEl("polygon", {
          points: `${vertex.x},${vertex.y - 15} ${vertex.x - 12},${vertex.y + 7} ${vertex.x + 12},${vertex.y + 7}`,
          fill,
          class: "settlement"
        }));
      }
    }

    if (["settlement", "city", "port"].includes(mode)) {
      const upgradeTarget =
        mode === "city" &&
        building?.owner === currentPlayerId &&
        building?.type === "settlement";

      const hit = svgEl("circle", {
        cx: vertex.x,
        cy: vertex.y,
        r: mode === "city" ? 21 : 14,
        fill: "transparent",
        stroke: upgradeTarget ? "#fff" : "transparent",
        "stroke-width": 2,
        cursor: "pointer"
      });

      hit.addEventListener("click", () => buildOnBoard(mode, vertex.id));
      svg.append(hit);
    }
  });

  getElementById("board").style.cursor =
    mode === "select" ? "default" : "crosshair";
}

function renderGameLog() {
  getElementById("logBox").innerHTML = state.logs
    .slice()
    .reverse()
    .map(message => `<div class="logitem">${esc(message)}</div>`)
    .join("");
}

function renderGame() {
  if (!state) return;

  state = normalizeRoomState(state);

  updateStatus();
  renderResourceInventory();
  renderPlayerList();
  renderGameBoard();
  renderGameLog();

  const player = getLocalPlayer();

  getElementById("scoreBox").textContent =
    `Victory points: ${player?.points || 0} / ${state.victoryPointsNeeded || 10}${state.winner ? " · " + state.winner + " won" : ""}`;

  getElementById("devBox").textContent = player?.dev.length
    ? `Development cards: ${player.dev.join(", ")}`
    : "No development cards yet.";

  document.querySelectorAll(".modeBtn").forEach(button => {
    button.style.borderColor =
      button.dataset.mode === mode ? "var(--accent)" : "";
  });
}

// ---------------------------------------------------------------------------
// BUILDING HELPERS
// ---------------------------------------------------------------------------

function payResourceCost(player, cost) {
  if (Object.entries(cost).some(([resource, amount]) =>
    player.res[resource] < amount
  )) {
    return false;
  }

  for (const [resource, amount] of Object.entries(cost)) {
    player.res[resource] -= amount;
  }

  return true;
}

function hasAdjacentRoad(vertexId, owner) {
  const vertex = state.board.verts[vertexId];

  return vertex.edges.some(edgeId =>
    state.roads[edgeId]?.owner === owner
  );
}

// ---------------------------------------------------------------------------
// OPENING PLACEMENTS
// ---------------------------------------------------------------------------

function placeOpeningPiece(type, id) {
  const player = getCurrentPlayer();
  const board = state.board;

  if (!player) return;

  if (state.setupStep === "settlement") {
    if (type !== "settlement") {
      return SendLocalToast("Opening order: place a settlement first.");
    }

    if (state.buildings[id]) {
      return SendLocalToast("That intersection is already occupied.");
    }

    const vertex = board.verts[id];

    if (vertex.edges.some(edgeId => {
      const edge = board.edges[edgeId];
      const other = edge.a === id ? edge.b : edge.a;

      return !!state.buildings[other];
    })) {
      return SendLocalToast("Settlements need at least one empty intersection between them.");
    }

    state.buildings[id] = {
      owner: player.id,
      type: "settlement"
    };

    player.pieces.settlement++;
    player.points++;
    state.setupSettlement = id;
    state.setupStep = "road";

    const secondRound = state.setupIndex >= state.players.length;
    const gained = {};

    if (secondRound) {
      for (const cell of board.cells.filter(cell => cell.verts.includes(id))) {
        if (RESOURCE_TYPES.includes(cell.terrain)) {
          player.res[cell.terrain]++;
          gained[cell.terrain] = (gained[cell.terrain] || 0) + 1;
        }
      }
    }

    const gainedText = Object.entries(gained)
      .map(([resource, amount]) =>
        `${RESOURCE_DETAILS[resource][0]} ${amount} ${RESOURCE_DETAILS[resource][1]}`
      )
      .join(", ");

    if (secondRound) {
      SendLocalToast(
        `You placed your second settlement, and received ${gainedText}. Now place your final road.`,
        "success"
      );
    } else {
      SendLocalToast(
        "You placed your first settlement, now place a road attached to it.",
        "info"
      );
    }

  } else {
    if (type !== "road") {
      return SendLocalToast("Opening order: place a road connected to your new settlement.");
    }

    if (state.roads[id]) {
      return SendLocalToast("That road edge is already occupied.");
    }

    const edge = board.edges[id];

    if (edge.a !== state.setupSettlement && edge.b !== state.setupSettlement) {
      return SendLocalToast("Your opening road must touch the settlement you just placed.");
    }

    state.roads[id] = {
      owner: player.id
    };

    player.pieces.road++;

    state.logs.push(`${player.name} placed an opening road.`);
    state.logs = state.logs.slice(-70);

    state.setupIndex++;
    state.setupSettlement = null;

    if (state.setupIndex >= state.setupOrder.length) {
      state.phase = "play";
      state.turn = 0;
      state.rolled = false;
      state.dice = null;

      state.logs.push("Opening placement complete. Normal turns begin — roll the dice.");
    } else {
      state.setupStep = "settlement";

      const next = getCurrentPlayer();
      state.logs.push(`${next?.name}'s placement turn: place a settlement, then its road.`);
    }
  }

  synchronizeRoomState();
  renderGame();
}

// ---------------------------------------------------------------------------
// BUILDING ACTIONS
// ---------------------------------------------------------------------------

function buildOnBoard(type, id) {
  if (!state || state.winner) return;

  if (state.phase === "lobby") {
    return SendLocalToast("Wait for the host to start the opening placements.");
  }

  if (!isPlayersTurn()) {
    return SendLocalToast("It's not your turn.");
  }

  if (state.phase === "setup") {
    return placeOpeningPiece(type, id);
  }

  if (!state.rolled) {
    return SendLocalToast("Roll the dice before building.");
  }

  const player = getLocalPlayer();
  const board = state.board;

  if (type === "road") {
    if (state.roads[id]) {
      return SendLocalToast("That road is already occupied.");
    }

    const edge = board.edges[id];

    const connected = [edge.a, edge.b].some(vertexId =>
      hasAdjacentRoad(vertexId, player.id) ||
      state.buildings[vertexId]?.owner === player.id
    );

    if (!connected) {
      return SendLocalToast("Road must connect to your road network or one of your buildings.");
    }

    if (!payResourceCost(player, BUILDING_COSTS.road)) {
      return SendLocalToast("Not enough resources for a road.");
    }

    state.roads[id] = { owner: player.id };
    player.pieces.road++;

    SendGlobalToast(`${player.name} built a road.`, "info");

  } else if (type === "settlement") {
    if (state.buildings[id]) {
      return SendLocalToast("That intersection is occupied.");
    }

    const vertex = board.verts[id];

    if (!vertex.edges.some(edgeId => state.roads[edgeId]?.owner === player.id)) {
      return SendLocalToast("A settlement must connect to one of your roads.");
    }

    if (vertex.edges.some(edgeId => {
      const edge = board.edges[edgeId];
      const other = edge.a === id ? edge.b : edge.a;

      return !!state.buildings[other];
    })) {
      return SendLocalToast("Settlements need at least one empty intersection between them.");
    }

    if (!payResourceCost(player, BUILDING_COSTS.settlement)) {
      return SendLocalToast("Not enough resources for a settlement.");
    }

    state.buildings[id] = {
      owner: player.id,
      type: "settlement"
    };

    player.pieces.settlement++;
    player.points++;

    SendGlobalToast(`${player.name} built a settlement.`, "info");

  } else if (type === "city") {
    if (
      state.buildings[id]?.owner !== player.id ||
      state.buildings[id]?.type !== "settlement"
    ) {
      return SendLocalToast("Upgrade one of your own settlements.", "error");
    }

    if (!payResourceCost(player, BUILDING_COSTS.city)) {
      return SendLocalToast("A city costs 3 ore and 2 grain.", "error");
    }

    state.buildings[id].type = "city";
    player.pieces.city++;
    player.pieces.settlement--;
    player.points++;

    SendGlobalToast(`${player.name} upgraded a settlement to a city.`, "info");

  } else if (type === "port") {
    const vertex = board.verts[id];
    const adjacentCellCount = board.cells.filter(cell =>
      cell.verts.includes(id)
    ).length;

    const coastal = adjacentCellCount < 3;

    if (!coastal) {
      return SendLocalToast("Ports can only be built on coastal intersections.");
    }

    if (state.buildings[id]) {
      return SendLocalToast("That intersection is occupied.");
    }

    if (!hasAdjacentRoad(id, player.id)) {
      return SendLocalToast("A port needs to connect to your road network.");
    }

    if (!payResourceCost(player, BUILDING_COSTS.port)) {
      return SendLocalToast("Not enough resources for a port.");
    }

    state.ports[id] = {
      owner: player.id,
      rate: 3
    };

    player.pieces.port++;

    SendGlobalToast(`${player.name} built a port (3:1 trade).`, "success");
  }

  if (player.points >= (state.victoryPointsNeeded || 10)) {
    state.winner = player.name;

    SendGlobalToast(
      `${player.name} reached ${state.victoryPointsNeeded || 10} victory points and wins!`,
      "success"
    );
  }

  synchronizeRoomState();
  renderGame();
}

// ---------------------------------------------------------------------------
// DICE AND RESOURCE DISTRIBUTION
// ---------------------------------------------------------------------------

function rollDice() {
  if (!isPlayersTurn() || state.phase !== "play" || state.rolled) return;

  const roller = getCurrentPlayer();
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const total = d1 + d2;

  state.dice = [d1, d2];
  state.rolled = true;
  state.round++;

  const gains = Object.fromEntries(
    state.players.map(player => [
      player.id,
      Object.fromEntries(RESOURCE_TYPES.map(resource => [resource, 0]))
    ])
  );

  if (total !== 7) {
    for (const cell of state.board.cells.filter(cell => cell.number === total)) {
      for (const vertexId of cell.verts) {
        const building = state.buildings[vertexId];
        if (!building) continue;

        const player = state.players.find(p => p.id === building.owner);
        const resource = cell.terrain;

        if (!player || !RESOURCE_TYPES.includes(resource)) continue;

        const amount = building.type === "city" ? 2 : 1;

        player.res[resource] += amount;
        gains[player.id][resource] += amount;
      }
    }

    for (const player of state.players) {
      const items = RESOURCE_TYPES
        .filter(resource => gains[player.id][resource] > 0)
        .map(resource =>
          `${RESOURCE_DETAILS[resource][0]} ${gains[player.id][resource]} ${RESOURCE_DETAILS[resource][1]}`
        );

      if (player.id === currentPlayerId) {
        if (items.length) {
          SendLocalToast(
            `You received ${items.join(", ")} from the roll.`,
            "success"
          );
        } else {
          SendLocalToast(
            "You did not receive any resources from this roll.\nBuild something, use a development card, or end your turn.",
            "info"
          );
        }
      }else{
        if (items.length) {
          SendGlobalToast(`You received ${items.join(", ")} from the roll.`, "success", player.id)
        }else{
          SendGlobalToast(`You received no resources from this roll.`, "NONE", player.id)
        }
      }

      if (items.length) {
        state.logs.push(
          `${player.name} received ${items.join(", ")} from the roll.`
        );
        state.logs = state.logs.slice(-70);
      }
    }

  } else {
    const message = `${roller.name} rolled 7. No resources were distributed.`;

    state.logs.push(message);
    state.logs = state.logs.slice(-70);

    SendGlobalToast(message, "info");
  }

  synchronizeRoomState();
  renderGame();
}

// ---------------------------------------------------------------------------
// TURN MANAGEMENT
// ---------------------------------------------------------------------------

async function endCurrentTurn() {
  if (!isPlayersTurn() || state.phase !== "play" || !state.rolled) return;

  state.turn = (state.turn + 1) % state.players.length;
  state.rolled = false;
  state.dice = null;

  // if (isPlayersTurn()) {
  //   SendLocalToast("It's your turn, roll the dice.", "info");
  // } else {
  //   SendLocalToast(`${getCurrentPlayer().name}'s turn began.`, "info");
  // }

  synchronizeRoomState();
  renderGame();
}

// ---------------------------------------------------------------------------
// TRADING
// ---------------------------------------------------------------------------

function tradeResources() {
  if (!isPlayersTurn() || state.phase !== "play" || !state.rolled) return;

  const player = getLocalPlayer();
  const give = getElementById("giveResource").value;
  const get = getElementById("getResource").value;

  if (give === get) {
    return SendLocalToast("Choose two different resources.");
  }

  const rate = Object.values(state.ports).some(port =>
    port.owner === player.id
  ) ? 3 : 4;

  if (player.res[give] < rate) {
    return SendLocalToast(
      `You need ${rate} ${RESOURCE_DETAILS[give][1]} to trade.`
    );
  }

  player.res[give] -= rate;
  player.res[get]++;

  SendGlobalToast(
    `${player.name} traded ${rate} ${RESOURCE_DETAILS[give][1]} for 1 ${RESOURCE_DETAILS[get][1]}.`,
    "success"
  );

  synchronizeRoomState();
  renderGame();
}

// ---------------------------------------------------------------------------
// DEVELOPMENT CARDS
// ---------------------------------------------------------------------------

function buyDevelopmentCard() {
  if (!isPlayersTurn() || state.phase !== "play" || !state.rolled) return;

  const player = getLocalPlayer();

  if (!payResourceCost(player, BUILDING_COSTS.dev)) {
    return SendLocalToast(
      "A development card costs 1 grain, 1 wool, and 1 ore."
    );
  }

  const card = [
    "Knight",
    "Road Building",
    "Year of Plenty",
    "Monopoly",
    "Victory Point"
  ][Math.floor(Math.random() * 5)];

  player.dev.push(card);

  if (card === "Victory Point") player.points++;

  SendLocalToast(`You bought a development card: ${card}.`, "success");

  synchronizeRoomState();
  renderGame();
}

// ---------------------------------------------------------------------------
// GAME RULES
// ---------------------------------------------------------------------------

function showGameRules() {
  alert(
    "COLONISTS — QUICK RULES\n\n" +
    "Turn: roll 2 dice, collect resources, then build/trade.\n\n" +
    "Costs:\n" +
    "Road: 1 wood + 1 brick\n" +
    "Settlement: 1 wood + 1 brick + 1 wool + 1 grain\n" +
    "City upgrade: 3 ore + 2 grain\n" +
    "Port: 2 wood + 2 brick + 1 ore\n" +
    "Development card: 1 wool + 1 grain + 1 ore\n\n" +
    "Settlements: connect to your road network, and keep one intersection empty between settlements.\n" +
    "Roads: must connect to your own road/building.\n" +
    "Cities: upgrade your own settlement.\n" +
    "Ports: coastal intersection, connected to your road network; grants 3:1 trade.\n\n" +
    "First to the configured victory-point target wins. This is an original fan-made game inspired by classic hex-tile trading games, not an official adaptation."
  );
}

// ---------------------------------------------------------------------------
// FIREBASE
// ---------------------------------------------------------------------------

async function initializeFirebase() {
  if (FIREBASE_CONFIG.apiKey === "PASTE_API_KEY") {
    throw new Error("Firebase isn't configured yet. Use local demo or add your Firebase config in the HTML file.");
  }

  const { initializeApp } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");

  const {
    getDatabase,
    ref,
    set,
    get,
    update,
    onValue,
    runTransaction
  } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");

  const app = initializeApp(FIREBASE_CONFIG);
  database = getDatabase(app);

  return {
    ref,
    set,
    get,
    update,
    onValue,
    runTransaction
  };
}

function readGameConfig() {
  return {
    maxPlayers: Number(getElementById("maximumPlayers")?.value || 4),
    mapSize: Number(getElementById("mapSize")?.value || 1),
    victoryPointsNeeded: Number(getElementById("victoryPointsNeeded")?.value || 10)
  };
}

async function createOnlineRoom() {
  try {
    firebaseTools = await initializeFirebase();
    isOnlineGame = true;

    const roomCode = generateRoomCode();
    const config = readGameConfig();

    state = createNewGameState(
      roomCode,
      sessionStorage.getItem("lobbyCreatorName") || localplayerName,
      config
    );

    roomDatabaseReference = firebaseTools.ref(database, "rooms/" + roomCode);

    await firebaseTools.set(roomDatabaseReference, state);

    sessionStorage.setItem("colonistsRoomCode", roomCode);
    sessionStorage.removeItem("colonistsLocalState");

    window.location.href = `game.html?room=${encodeURIComponent(roomCode)}`;

  } catch (error) {
    notify(error.message);
  }
}

function goToGameCreationPage() {
  const playerName =
    getElementById("nameInput").value.trim() || "Colonist";

    let badWordList = ["kanker", "gay", "homo", "nigger", "nigga", "n!gga", "n!ga", "niga", "nigge", "n!gge", "nig", "n!g", "raym"]
    let playerchosenName = getElementById("nameInput").value.trim().toLowerCase()
    if (playerchosenName.length < 3) { return notify("Your player name must be at least 3 characters.")}
    if (badWordList.some(word => playerchosenName.includes(word))) {
      return notify("Opzouten")
    }

  sessionStorage.setItem("lobbyCreatorName", playerName);
  window.location.href = "game_creation.html";
}

async function joinOnlineRoom() {
  try {
    firebaseTools = await initializeFirebase();
    isOnlineGame = true;

    const roomCode = getElementById("codeInput").value.trim().toUpperCase();

    if (!roomCode) return notify("Enter a room code.");

    roomDatabaseReference = firebaseTools.ref(database, "rooms/" + roomCode);

    const roomSnapshot = await firebaseTools.get(roomDatabaseReference);

    if (!roomSnapshot.exists()) {
      return notify("Room not found. Check the code.");
    }

    let badWordList = ["kanker", "gay", "homo", "nigger", "nigga", "n!gga", "n!ga", "niga", "nigge", "n!gge", "nig", "n!g", "raym"]
    let playerchosenName = getElementById("nameInput").value.trim().toLowerCase()
    if (playerchosenName.length < 3) { return notify("Your player name must be at least 3 characters.")}
    if (badWordList.some(word => playerchosenName.includes(word))) {
      return notify("Opzouten")
    }

    const roomState = normalizeRoomState(roomSnapshot.val());

    if (roomState.phase !== "lobby") {
      return notify("This game has already started; new players cannot join now.");
    }

    const maxPlayers = roomState.maxPlayers || 4;

    if (roomState.players.length >= maxPlayers) {
      return notify(`That room already has ${maxPlayers} players.`);
    }

    if (roomState.players.some(player => player.id === currentPlayerId)) {
      return notify("You are already in this room.");
    }

    const newPlayer = {
      id: currentPlayerId,
      name: getElementById("nameInput").value.trim() || "Colonist",
      color: PLAYER_COLORS[roomState.players.length],
      res: {
        wood: 0,
        brick: 0,
        wool: 0,
        grain: 0,
        ore: 0
      },
      pieces: {
        road: 0,
        settlement: 0,
        city: 0,
        port: 0
      },
      dev: [],
      points: 0
    };

    roomState.players.push(newPlayer);
    roomState.logs.push(`${newPlayer.name} joined the room.`);


    await firebaseTools.set(roomDatabaseReference, roomState);

    sessionStorage.setItem("colonistsRoomCode", roomCode);
    sessionStorage.removeItem("colonistsLocalState");

    window.location.href = `game.html?room=${encodeURIComponent(roomCode)}`;
  } catch (error) {
    notify("Could not join room: " + error.message);
  }
  
  await SendGlobalToast(`${newPlayer.name} joined the room.`, "info")
}

function subscribeToRoomUpdates() {
  if (unsubscribeFromRoom) unsubscribeFromRoom();

  unsubscribeFromRoom = firebaseTools.onValue(roomDatabaseReference, snapshot => {
    if (!snapshot.exists()) return;

    const next = normalizeRoomState(snapshot.val());

    if (!next.players.some(player => player.id === currentPlayerId)) {
      alert("You are no longer in this room. Returning to the lobby.");
      window.location.href = "lobby.html";
      return;
    }

    state = next;
    renderGame();
  });
}

async function synchronizeRoomState() {
  if (!isOnlineGame || !roomDatabaseReference) return;

  const snapshot = JSON.parse(JSON.stringify(state));

  syncQueue = syncQueue
    .then(() => firebaseTools.set(roomDatabaseReference, snapshot))
    .catch(error => {
      console.error(error);
      notify("Sync failed. Check your Firebase rules/config.");
    });

  return syncQueue;
}

// ---------------------------------------------------------------------------
// GAME INITIALIZATION
// ---------------------------------------------------------------------------

function renderInitialGame() {
  clearTimeout(localToastTimer);
  clearTimeout(globalToastTimer);

  getElementById("gameNoticeLocal")?.classList.add("hidden");
  getElementById("gameNoticeGlobal")?.classList.add("hidden");



  renderGame();
}

function beginOpeningPlacements() {
  if (!state || state.phase !== "lobby" || state.host !== currentPlayerId) return;

  if (state.players.length < 2) {
    return SendLocalToast("At least two players are needed to begin.");
  }

  state.phase = "setup";

  const forward = state.players.map(player => player.id);

  state.setupOrder = [...forward, ...forward.slice().reverse()];
  state.setupIndex = 0;
  state.setupStep = "settlement";
  state.setupSettlement = null;
  state.turn = 0;
  state.rolled = false;
  state.dice = null;

  const currentPlayer = getCurrentPlayer();

  // if (currentPlayer?.id === currentPlayerId) {
  //   SendLocalToast(
  //     "Opening placements started, you are first. Place a settlement, followed by a road. :)",
  //     "success"
  //   );

  //   SendGlobalToast(
  //     `Opening placements started. It's ${currentPlayer.name}'s turn.`,
  //     "info"
  //   );
  // }

  state.logs.push(
    `Opening placements have started, it's ${currentPlayer?.name}'s turn to play.`
  );
  state.logs = state.logs.slice(-70);

  synchronizeRoomState();
  renderGame();
}

function startLocalDemo() {
  isOnlineGame = false;
  isLocalGame = true;

  const playerName =
    getElementById("nameInput").value.trim() || "Colonist";

  state = createNewGameState("LOCAL", playerName);

  state.phase = "setup";
  state.setupOrder = [currentPlayerId, currentPlayerId];
  state.setupIndex = 0;
  state.setupStep = "settlement";

  state.logs.push(
    "Local demo started. Place two settlements and their attached roads; the second settlement grants adjacent resources."
  );

  sessionStorage.setItem("colonistsLocalState", JSON.stringify(state));
  sessionStorage.removeItem("colonistsRoomCode");

  window.location.href = "game.html?mode=local";
}

function leaveGame() {
  if (unsubscribeFromRoom) {
    unsubscribeFromRoom();
    unsubscribeFromRoom = null;
  }

  if (unsubscribeFromGlobalToasts) {
    unsubscribeFromGlobalToasts();
    unsubscribeFromGlobalToasts = null;
  }

  clearTimeout(localToastTimer);
  clearTimeout(globalToastTimer);

  sessionStorage.removeItem("colonistsRoomCode");
  sessionStorage.removeItem("colonistsLocalState");

  window.location.href = "lobby.html";
}

// ---------------------------------------------------------------------------
// PLAYER IDENTITY
// ---------------------------------------------------------------------------

currentPlayerId = sessionStorage.getItem("colonistsPlayerId");

if (!currentPlayerId) {
  currentPlayerId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "player-" + Math.random().toString(36).slice(2);

  sessionStorage.setItem("colonistsPlayerId", currentPlayerId);
}

// ---------------------------------------------------------------------------
// EVENT LISTENERS
// ---------------------------------------------------------------------------

if (getElementById("createBtn")) {
  getElementById("createBtn").addEventListener("click", createOnlineRoom);
}

if (getElementById("createGameRoom")) {
  getElementById("createGameRoom").addEventListener("click", goToGameCreationPage);
  getElementById("joinBtn").addEventListener("click", joinOnlineRoom);
  getElementById("soloBtn").addEventListener("click", startLocalDemo);
}

if (getElementById("rollBtn")) {
  getElementById("leaveBtn").addEventListener("click", leaveGame);
  getElementById("startPlacementBtn").addEventListener("click", beginOpeningPlacements);
  getElementById("rollBtn").addEventListener("click", rollDice);
  getElementById("endBtn").addEventListener("click", endCurrentTurn);
  getElementById("tradeBtn").addEventListener("click", tradeResources);
  getElementById("buyDevBtn").addEventListener("click", buyDevelopmentCard);
  getElementById("helpBtn").addEventListener("click", showGameRules);

  document.querySelectorAll(".modeBtn").forEach(button => {
    button.addEventListener("click", () => {
      mode = button.dataset.mode;
      renderGameBoard();

      document.querySelectorAll(".modeBtn").forEach(modeButton => {
        modeButton.style.borderColor =
          modeButton === button ? "var(--accent)" : "";
      });
    });
  });

  bootGamePage();
}

// ---------------------------------------------------------------------------
// GAME BOOT
// ---------------------------------------------------------------------------

async function bootGamePage() {
  const query = new URLSearchParams(window.location.search);
  const roomCode = query.get("room");
  const localMode = query.get("mode") === "local";

  if (localMode) {
    const savedState = sessionStorage.getItem("colonistsLocalState");

    if (!savedState) {
      alert("Your local game session was not found. Please start a new game from the lobby.");
      window.location.href = "lobby.html";
      return;
    }

    state = normalizeRoomState(JSON.parse(savedState));

    isLocalGame = true;
    isOnlineGame = false;

    renderInitialGame();
    return;
  }

  if (!roomCode) {
    alert("No room code was provided. Please create or join a room from the lobby.");
    window.location.href = "lobby.html";
    return;
  }

  try {
    firebaseTools = await initializeFirebase();
    isOnlineGame = true;

    roomDatabaseReference = firebaseTools.ref(database, "rooms/" + roomCode);

    // -- // Global notifications use their own independent Firebase path
    subscribeToGlobalToasts(roomCode);

    subscribeToRoomUpdates();
  } catch (error) {
    alert("Could not connect to the room: " + error.message);
    window.location.href = "lobby.html";
  }
}

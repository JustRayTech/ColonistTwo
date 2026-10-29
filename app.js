/* ============================================================================
   COLONISTS — GAME LOGIC
   ---------------------------------------------------------------------------
   This file contains the game rules, board rendering, player actions, and
   Firebase Realtime Database multiplayer connection.

   To enable online rooms, replace the placeholder values in FIREBASE_CONFIG
   below with the web configuration from your Firebase project. For local
   testing, open Colonists.html and choose “Play local demo”.
   ============================================================================ */
// ---------------------------------------------------------------------------
// FIREBASE CONFIGURATION
// Create a Firebase project, enable Realtime Database, and paste its web config
// here. Never put private server credentials in a browser-based application.
// ---------------------------------------------------------------------------
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyA4G46NAn-RFWz0l6sx-o2eR3ZeUkKjtMg",
  authDomain: "kolonisten-df6cb.firebaseapp.com",
  databaseURL: "https://kolonisten-df6cb-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kolonisten-df6cb",
  storageBucket: "kolonisten-df6cb.firebasestorage.app",
  messagingSenderId: "372541702579",
  appId: "1:372541702579:web:e48be1d520cabb85a70bc6",
  measurementId: "G-SEWN7CKHXX"
};

// Resource identifiers and display labels used throughout the interface.
const RESOURCE_TYPES = ["wood", "brick", "wool", "grain", "ore"];
const RESOURCE_DETAILS = {
    wood:["🪵","Wood"],
    brick:["🧱","Brick"],
    wool:["🐑","Wool"],
    grain:["🌾","Grain"],
    ore:["🪨","Ore"]
};
// Building costs. Opening settlements and roads are placed for free.
const BUILDING_COSTS = {
    road: {
        wood:1,
        brick:1
    },
    settlement: {
        wood:1,
        brick:1,
        grain:1,
        wool:1
    },
    city: {
        ore:3,
        grain:2
    },
    port: {
        wood:2,
        brick:2,
        ore:1
    },
    dev: {
        grain:1,
        wool:1,
        ore:1
    }
};
const PLAYER_COLORS = ["#e06b5c", "#5ca9e0", "#e5b84f", "#8dce8c"];
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
const getElementById = elementId => document.getElementById(elementId);
let state = null,
currentPlayerId = null,
mode="select",
isOnlineGame=false,
database=null,
roomDatabaseReference=null,
unsubscribeFromRoom=null,
isLocalGame=false;
function generateRoomCode() {
    return Math.random().toString(36).slice(2,8).toUpperCase()
}
// Generate the hex island and derive each shared intersection and road edge.

function createBoard() {
    // -- // Initialize board data
    const cells = [];
    const vertices = {};
    const roadEdges = {};

    let terrainIndex = 0;

    // -- // Generate the 19 hexagonal tiles
    for (let q = -2; q <= 2; q++) {
        for (let r = -2; r <= 2; r++) {
            const s = -q - r;

            // Skip coordinates outside the hexagonal board
            if (Math.abs(s) > 2) {
                continue;
            }

            // Assign terrain and color from the predefined layout
            const terrain = TERRAIN_LAYOUT[terrainIndex++];

            // Assign a random number, except for desert tiles
            const numberOptions = [2, 3, 4, 5, 6, 8, 9, 10, 11, 12];

            const number = terrain[0] === "desert"
                ? 0
                : numberOptions[Math.floor(Math.random() * numberOptions.length)];

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

    // -- // Convert hex coordinates into screen coordinates
    function getHexCenter(q, r) {
        return {
            x: 380 + q * 76 + r * 38,
            y: 300 + r * 66
        };
    }

    // -- // Calculate and register the six unique corners of each tile
    cells.forEach(cell => {
        const center = getHexCenter(cell.q, cell.r);

        cell.verts = [];

        for (let cornerIndex = 0; cornerIndex < 6; cornerIndex++) {
            const angle =
                (cornerIndex - 1) * Math.PI / 3 - Math.PI / 6;

            const x = Math.round(
                center.x + 44 * Math.cos(angle)
            );

            const y = Math.round(
                center.y + 44 * Math.sin(angle)
            );

            // Use coordinates as the unique vertex ID
            const vertexId = `${x},${y}`;

            // Create the vertex only if it doesn't already exist
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

    // -- // Generate unique road edges between adjacent corners
    cells.forEach(cell => {
        cell.edges = [];

        for (let cornerIndex = 0; cornerIndex < 6; cornerIndex++) {
            const startVertex = cell.verts[cornerIndex];

            const endVertex =
                cell.verts[(cornerIndex + 1) % 6];

            // Sort IDs so the same edge always gets the same key
            const edgeId = [
                startVertex,
                endVertex
            ].sort().join("|");

            // Create the edge only if it doesn't already exist
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

    // -- // Register connected edges on each vertex
    Object.values(roadEdges).forEach(edge => {
        vertices[edge.a].edges.push(edge.id);
        vertices[edge.b].edges.push(edge.id);
    });

    // -- // Return the completed board
    return {
        cells,
        verts: vertices,
        edges: roadEdges
    };
}

function createNewGameState(code,name) {
    let board=createBoard(), player= {
        id:currentPlayerId,name:name||"Colonist",color:PLAYER_COLORS[0],res: {
            wood:0,brick:0,wool:0,grain:0,ore:0
        },pieces: {
            road:0,settlement:0,city:0,port:0
        },
    dev:[],points:0
    };
    return {
        code,host:currentPlayerId,players:[player],turn:0,phase:"lobby",setupOrder:[],setupIndex:0,setupStep:"settlement",setupSettlement:null,rolled:false,dice:null,board,roads: {
        },buildings: {
        },ports: {
        },logs:[`${player.name} founded room ${code}.`],winner:null,round:0
    };
}
let lastNoticeId=null, noticeTimer=null;
function noticeKind(msg, explicit=null) {
    if(explicit)return explicit;
    if(/not enough|already occupied|already used|occupied|must|needs?|cannot|can't|wait for|not your turn|choose two|roll the dice before|ports can only|upgrade one|at least two players|settlements need|road edge is already|opening order|costs? \d|port needs/i.test(msg))return "error";
 if(/received|built|placed|upgraded|traded|bought|wins|resource distribution complete|opening placement complete/i.test(msg))return "success";
 return "info";
}

function addGameLogEntry(msg, kind=null, perPlayer=null){
 if(!state)return;
 state.logs.push(msg);
state.logs=state.logs.slice(-70);
 state.toast={id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,message:msg,kind:noticeKind(msg,kind),perPlayer};
}

function renderActionNotification(){
 const toast=state?.toast,box=getElementById("gameNotice");
if(!toast||toast.id===lastNoticeId)return;
 lastNoticeId=toast.id;
 const personal=toast.perPlayer?.[currentPlayerId];
 box.textContent=typeof personal==="string"?personal:(personal?.message||toast.message);
 box.className=`game-notice ${personal?.kind||toast.kind||"info"}`;
 clearTimeout(noticeTimer);
const id=toast.id;
 noticeTimer=setTimeout(()=>{if(lastNoticeId===id)box.classList.add("hidden")},6500);
}
// Normalize rooms created by older versions before rendering or acting on them.
// Firebase keeps old room data until a client writes the newer fields, so defaults are required.
// Add defaults when loading older Firebase rooms created by earlier versions.
function normalizeRoomState(s){
 if(!s||typeof s!=="object")return s;
 s.players=Array.isArray(s.players)?s.players:Object.values(s.players||{});
 s.roads=s.roads&&typeof s.roads==="object"?s.roads:{};
 s.buildings=s.buildings&&typeof s.buildings==="object"?s.buildings:{};
 s.ports=s.ports&&typeof s.ports==="object"?s.ports:{};
 s.logs=Array.isArray(s.logs)?s.logs:Object.values(s.logs||{});
 // Board cells are the source of truth for adjacency; remove old nested copies.
 if (s.board && s.board.verts) {
  for (const vertex of Object.values(s.board.verts)) {
   delete vertex.cells;
   vertex.edges = Array.isArray(vertex.edges) ? vertex.edges : [];
  }
 }
 if (s.board && s.board.edges) {
  for (const edge of Object.values(s.board.edges)) delete edge.cells;
 }
 s.players.forEach((player,i)=>{
  player.res=player.res&&typeof player.res==="object"?player.res:{};
  for(const r of RESOURCE_TYPES)if(!Number.isFinite(player.res[r]))player.res[r]=0;
  player.pieces=player.pieces&&typeof player.pieces==="object"?player.pieces:{};
  for(const piece of ["road","settlement","city","port"])if(!Number.isFinite(player.pieces[piece]))player.pieces[piece]=0;
  if(!Array.isArray(player.dev))player.dev=Object.values(player.dev||{});
  if(!Number.isFinite(player.points))player.points=0;
  if(!player.color)player.color=PLAYER_COLORS[i%PLAYER_COLORS.length];
 });
 if(!s.phase)s.phase="play";
 if(!Number.isFinite(s.turn))s.turn=0;
 if(typeof s.rolled!=="boolean")s.rolled=false;
 if(!Array.isArray(s.setupOrder))s.setupOrder=[];
 if(!Number.isFinite(s.setupIndex))s.setupIndex=0;
 if(!s.setupStep)s.setupStep="settlement";
 if(!Array.isArray(s.logs))s.logs=[];
 return s;
}

function getCurrentPlayer(){if(!state||!state.players?.length)return null;
if(state.phase==="setup")return state.players.find(player=>player.id===state.setupOrder?.[state.setupIndex]);
return state.players[state.turn%state.players.length]}

function getLocalPlayer(){return state?.players.find(player=>player.id===currentPlayerId)}

function isPlayersTurn(){return !!state && (state.phase==="setup"||state.phase==="play") && !!getLocalPlayer() && getCurrentPlayer()?.id===currentPlayerId && !state.winner}

function showGameMessage(msg,kind=null,perPlayer=null){addGameLogEntry(msg,kind,perPlayer);
renderGame()}

function notify(msg){const messageBox=getElementById("setupMsg");if(messageBox){messageBox.textContent=msg;messageBox.classList.remove("hidden")}else{alert(msg)}}

function updateStatus(){
 if(!state)return;
 getElementById("roomBadge").textContent=`ROOM ${state.code}${isOnlineGame?" · ONLINE":" · LOCAL"}`;
 getElementById("roomTitle").textContent=`Colonists · ${state.code}`;
 const active=getCurrentPlayer();
 if(state.winner){getElementById("turnText").textContent=`${state.winner} wins!`}
 else if(state.phase==="lobby"){getElementById("turnText").textContent=state.host===currentPlayerId?`Lobby · ${state.players.length}/4 players · start when everyone has joined`:`Lobby · waiting for the host to start (${state.players.length}/4 players)`}
 else if(state.phase==="setup"){
   const action=state.setupStep==="settlement"?"place a settlement":"place a road connected to that settlement";
   getElementById("turnText").textContent=active?.id===currentPlayerId?`Opening placement ${state.setupIndex+1}/${state.setupOrder.length} · Your turn to ${action}`:`Opening placement ${state.setupIndex+1}/${state.setupOrder.length} · ${active?.name} to ${action}`;
 }else{getElementById("turnText").textContent=active?.id===currentPlayerId?`Your turn${state.rolled?" — build, trade, or end turn":" — roll to begin"}`:`${active?.name}'s turn`}
 getElementById("diceDisplay").textContent=state.dice?`🎲 ${state.dice[0]} + ${state.dice[1]} = ${state.dice[0]+state.dice[1]}`:"🎲 —";
 getElementById("startPlacementBtn").classList.toggle("hidden",state.phase!=="lobby"||state.host!==currentPlayerId);
 getElementById("startPlacementBtn").disabled=state.phase!=="lobby"||state.host!==currentPlayerId||state.players.length<2;
 getElementById("rollBtn").disabled=!isPlayersTurn()||state.phase!=="play"||state.rolled;
 getElementById("endBtn").disabled=!isPlayersTurn()||state.phase!=="play"||!state.rolled;
}

function renderResourceInventory(){const player=getLocalPlayer();
getElementById("resourceBox").innerHTML=RESOURCE_TYPES.map(r=>`<div class="resource"><div class="emoji">${RESOURCE_DETAILS[r][0]}</div><strong>${player?.res[r]||0}</strong><small>${RESOURCE_DETAILS[r][1]}</small></div>`).join("");
for(const id of ["giveResource","getResource"]){getElementById(id).innerHTML=RESOURCE_TYPES.map(r=>`<option value="${r}">${RESOURCE_DETAILS[r][0]} ${RESOURCE_DETAILS[r][1]}</option>`).join("")} getElementById("getResource").selectedIndex=1;}

function renderPlayerList(){ const activeId=getCurrentPlayer()?.id; getElementById("playersBox").innerHTML=state.players.map((player,i)=>`<div class="player ${player.id===activeId&&state.phase!=="lobby"&&!state.winner?"active":""}"><span class="dot" style="background:${player.color}"></span><div class="grow"><b>${esc(player.name)} ${player.id===currentPlayerId?"(you)":""}</b><span class="small muted">${player.points} VP · ${Object.values(player.res).reduce((a,b)=>a+b,0)} resources</span></div><b>${player.points}</b></div>`).join("");}

function esc(s){return String(s).replace(/[&<>"']/g,c=>( {
        "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }
    [c]))
}
function svgEl(tag,attrs= {
},text="") {
    let el=document.createElementNS("http://www.w3.org/2000/svg",tag);
    for(let [k,v] of Object.entries(attrs))el.setAttribute(k,v);
    if(text)el.textContent=text;
    return el
}
// Draw terrain, dice numbers, roads, buildings, and invisible click targets.
function renderGameBoard() {
    const svg=getElementById("board");svg.innerHTML="";
    if(!state)return;
    const b=state.board;
    if(!b||!b.cells||!b.verts||!b.edges) {
        svg.append(svgEl("text", {
            x:380,y:300,fill:"#edf4f5","text-anchor":"middle"
        },"Board data is incomplete. Create a new room."));
        return;
    }
    state.roads ||= {
    };
    state.buildings ||= {
    };
    state.ports ||= {
    };
    
    b.cells.forEach(c=> {
        let pts=c.verts.map(k=>`${b.verts[k].x},${b.verts[k].y}`).join(" ");
        let poly=svgEl("polygon", {
            points:pts,fill:c.color,class:"hex"
        });poly.addEventListener("click",()=> {
        });svg.append(poly);svg.append(svgEl("text", {
            x:b.cells.length?b.verts[c.verts[0]].x*0.0+ (b.verts[c.verts[0]].x+b.verts[c.verts[3]].x)/2:0,y:(b.verts[c.verts[0]].y+b.verts[c.verts[3]].y)/2-3,class:"hex-label"
        },c.terrain==="desert"?"🏜":RESOURCE_DETAILS[c.terrain]?.[0]||""));
        if(c.number) {
            let x=(b.verts[c.verts[0]].x+b.verts[c.verts[3]].x)/2,y=(b.verts[c.verts[0]].y+b.verts[c.verts[3]].y)/2+16;svg.append(svgEl("circle", {
                cx:x,cy:y,r:13,fill:c.number===6||c.number===8?"#fff0c7":"#e9e2d1",stroke:"#5d4b34","stroke-width":1
            }));svg.append(svgEl("text", {
                x,y,class:"hex-num"
            },c.number))
        }
    });
    
    Object.values(b.edges).forEach(e=> {
        let a=b.verts[e.a],z=b.verts[e.b];
        let line=svgEl("line", {
            x1:a.x,y1:a.y,x2:z.x,y2:z.y,stroke:"#13252c","stroke-width":2,opacity:.7
        });svg.append(line);
        let road=state.roads[e.id];
        if(road) {
            svg.append(svgEl("line", {
                x1:a.x,y1:a.y,x2:z.x,y2:z.y,stroke:state.players.find(player=>player.id===road.owner)?.color||"#fff","stroke-width":8,"stroke-linecap":"round"
            }))
        }
        if(mode==="road") {
            let hit=svgEl("line", {
                x1:a.x,y1:a.y,x2:z.x,y2:z.y,stroke:"transparent","stroke-width":18,cursor:"pointer"
            });hit.addEventListener("click",()=>buildOnBoard("road",e.id));svg.append(hit)
        }
    });
    Object.values(b.verts).forEach(v=> {
        const building=state.buildings[v.id];
        if(building) {
            const owner=state.players.find(player=>player.id===building.owner),fill=owner?.color||"#fff";
            if(building.type==="city") {
                svg.append(svgEl("rect", {
                    x:v.x-12,y:v.y-17,width:24,height:20,rx:3,fill,class:"settlement"
                }));
                svg.append(svgEl("path", {
                    d:`M${v.x-15} ${v.y-17} L${v.x} ${v.y-30} L${v.x+15} ${v.y-17} Z`,fill,class:"settlement"
                }));
            }
            else {
                svg.append(svgEl("polygon", {
                    points:`${v.x},${v.y-15} ${v.x-12},${v.y+7} ${v.x+12},${v.y+7}`,fill,class:"settlement"
                }));
            }
        }
        // Keep a clickable overlay above existing buildings: city upgrades must be clickable.
        if(mode==="settlement"||mode==="city"||mode==="port") {
            const upgradeTarget=mode==="city"&&building?.owner===currentPlayerId&&building?.type==="settlement";
            const hit=svgEl("circle", {
                cx:v.x,cy:v.y,r:mode==="city"?21:14,fill:"transparent",stroke:upgradeTarget?"#fff":"transparent","stroke-width":2,cursor:"pointer"
            });
            hit.addEventListener("click",()=>buildOnBoard(mode,v.id));svg.append(hit);
        }
    });
    getElementById("board").style.cursor=mode==="select"?"default":"crosshair";
}
function renderGameLog() {
    getElementById("logBox").innerHTML=state.logs.slice().reverse().map(s=>`<div class="logitem">${esc(s)}</div>`).join("")
}
function renderGame() {
    if(!state)return;state=normalizeRoomState(state);updateStatus();renderResourceInventory();renderPlayerList();renderGameBoard();renderGameLog();
    let player=getLocalPlayer();
    getElementById("scoreBox").textContent=`Victory points: ${player?.points||0} / 10${state.winner?" · "+state.winner+" won":""}`;
    getElementById("devBox").textContent=player?.dev.length?`Development cards: ${player.dev.join(", ")}`:"No development cards yet.";
    document.querySelectorAll(".modeBtn").forEach(b=>b.style.borderColor=b.dataset.mode===mode?"var(--accent)":"");renderActionNotification();
}
function payResourceCost(player,cost) {
    if(Object.entries(cost).some(([r,n])=>player.res[r]<n))return false;
    for(let [r,n] of Object.entries(cost))player.res[r]-=n;
    return true
}
function hasAdjacentRoad(vId,owner) {
    let v=state.board.verts[vId];
    return v.edges.some(e=>state.roads[e]?.owner===owner)
}
function placeOpeningPiece(type,id) {
    const player=getCurrentPlayer(),b=state.board;
    if(!player)return;
    if(state.setupStep==="settlement") {
        if(type!=="settlement")return showGameMessage("Opening order: place a settlement first.");
        if(state.buildings[id])return showGameMessage("That intersection is already occupied.");
        const v=b.verts[id];
        if(v.edges.some(e=> {
            const edge=b.edges[e],other=edge.a===id?edge.b:edge.a;
            return !!state.buildings[other]
        }))return showGameMessage("Settlements need at least one empty intersection between them.");
        state.buildings[id]= {
            owner:player.id,type:"settlement"
        };
        player.pieces.settlement++;
        player.points++;
        state.setupSettlement=id;
        state.setupStep="road";
        const secondRound=state.setupIndex>=state.players.length;
        let gained= {
        };
        if(secondRound) {
            for (const cell of b.cells.filter(cell => cell.verts.includes(id))) {
                if (RESOURCE_TYPES.includes(cell.terrain)) {
                    player.res[cell.terrain]++;
                    gained[cell.terrain] = (gained[cell.terrain] || 0) + 1;
                }
            }
        }
        const gainedText=Object.entries(gained).map(([r,n])=>`${RESOURCE_DETAILS[r][0]} ${n} ${RESOURCE_DETAILS[r][1]}`).join(", ");
        const setupMessage=secondRound&&gainedText?`You received ${gainedText} from your second settlement.`:`You placed your ${secondRound?"second":"first"} settlement. Now place the road attached to it.`;
        addGameLogEntry(`${player.name} placed ${secondRound?"their second":"their first"} settlement${gainedText?` and received ${gainedText}`:""}. Now place a road attached to it.`,gainedText?"success":"info", {
            [player.id]: {
                message:setupMessage,kind:gainedText?"success":"info"
            }
        });
    }
    else {
        if(type!=="road")return showGameMessage("Opening order: place a road connected to your new settlement.");
        if(state.roads[id])return showGameMessage("That road edge is already occupied.");
        const edge=b.edges[id];
        if(edge.a!==state.setupSettlement&&edge.b!==state.setupSettlement)return showGameMessage("Your opening road must touch the settlement you just placed.");
        state.roads[id]= {
            owner:player.id
        };
        player.pieces.road++;
        addGameLogEntry(`${player.name} placed an opening road.`);
        state.setupIndex++;
        state.setupSettlement=null;
        if(state.setupIndex>=state.setupOrder.length) {
            state.phase="play";
            state.turn=0;
            state.rolled=false;
            state.dice=null;
            addGameLogEntry("Opening placement complete. Normal turns begin — roll the dice.");
        }
        else {
            state.setupStep="settlement";
            const next=getCurrentPlayer();
            addGameLogEntry(`${next?.name}'s placement turn: place a settlement, then its road.`);
        }
    }
    synchronizeRoomState();
    renderGame();
}
// Validate and apply a building action for the active player.
function buildOnBoard(type,id) {
    if(!state||state.winner)return;
    if(state.phase==="lobby")return showGameMessage("Wait for the host to start the opening placements.");
    if(!isPlayersTurn())return showGameMessage("It's not your turn.");
    if(state.phase==="setup")return placeOpeningPiece(type,id);
    if(!state.rolled)return showGameMessage("Roll the dice before building.");
    let player=getLocalPlayer(),b=state.board;
    if(type==="road") {
        if(state.roads[id])return showGameMessage("That road is already occupied.");
        const e=b.edges[id],connected= [e.a,e.b].some(v=>hasAdjacentRoad(v,player.id)||state.buildings[v]?.owner===player.id);
        if(!connected)return showGameMessage("Road must connect to your road network or one of your buildings.");
        if(!payResourceCost(player,BUILDING_COSTS.road))return showGameMessage("Not enough resources for a road.");
        state.roads[id]= {
            owner:player.id
        };
        player.pieces.road++;
        showGameMessage(`${player.name} built a road.`);
    }
    else if(type==="settlement") {
        if(state.buildings[id])return showGameMessage("That intersection is occupied.");
        const v=b.verts[id];
        if(v.edges.some(e=>state.roads[e]?.owner===player.id)===false)return showGameMessage("A settlement must connect to one of your roads.");
        if(v.edges.some(e=> {
            let x=b.edges[e],other=x.a===id?x.b:x.a;
            return !!state.buildings[other]
        }))return showGameMessage("Settlements need at least one empty intersection between them.");
        if(!payResourceCost(player,BUILDING_COSTS.settlement))return showGameMessage("Not enough resources for a settlement.");
        state.buildings[id]= {
            owner:player.id,type:"settlement"
        };
        player.pieces.settlement++;
        player.points++;
        showGameMessage(`${player.name} built a settlement.`);
    }
    else if(type==="city") {
        if(state.buildings[id]?.owner!==player.id||state.buildings[id]?.type!=="settlement")return showGameMessage("Upgrade one of your own settlements.");
        if(!payResourceCost(player,BUILDING_COSTS.city))return showGameMessage("A city costs 3 ore and 2 grain.");
        state.buildings[id].type="city";
        player.pieces.city++;
        player.pieces.settlement--;
        player.points++;
        showGameMessage(`${player.name} upgraded a settlement to a city.`);
    }
    else if(type==="port") {
        const vertex = b.verts[id];
        const adjacentCellCount = b.cells.filter(cell => cell.verts.includes(id)).length;
        const coastal = adjacentCellCount < 3;
        let v = vertex;
        if(!coastal)return showGameMessage("Ports can only be built on coastal intersections.");
        if(state.buildings[id])return showGameMessage("That intersection is occupied.");
        if(!hasAdjacentRoad(id,player.id))return showGameMessage("A port needs to connect to your road network.");
        if(!payResourceCost(player,BUILDING_COSTS.port))return showGameMessage("Not enough resources for a port.");
        state.ports[id]= {
            owner:player.id,rate:3
        };
        player.pieces.port++;
        showGameMessage(`${player.name} built a port (3:1 trade).`);
    }
    if(player.points>=10) {
        state.winner=player.name;
        showGameMessage(`${player.name} reached 10 victory points and wins!`)
    }
    synchronizeRoomState();
    renderGame();
}
// Roll two dice and report the exact resource gains to each player.
function rollDice() {
    if(!isPlayersTurn()||state.phase!=="play"||state.rolled)return;
    const roller=getCurrentPlayer(),d1=1+Math.floor(Math.random()*6),d2=1+Math.floor(Math.random()*6),total=d1+d2;
    state.dice=[d1,d2];
    state.rolled=true;
    state.round++;
    const gains=Object.fromEntries(state.players.map(player=>[player.id,Object.fromEntries(RESOURCE_TYPES.map(r=>[r,0]))]));
    if(total!==7) {
        for(const c of state.board.cells.filter(c=>c.number===total)) {
            for(const vId of c.verts) {
                const building=state.buildings[vId];
                if(!building)continue;
                const player=state.players.find(player=>player.id===building.owner),resource=c.terrain;
                if(!player||!RESOURCE_TYPES.includes(resource))continue;
                const qty=building.type==="city"?2:1;player.res[resource]+=qty;gains[player.id][resource]+=qty;
            }
        }
        const personal= {
        };
        for(const player of state.players) {
            const items=RESOURCE_TYPES.filter(r=>gains[player.id][r]>0).map(r=>`${RESOURCE_DETAILS[r][0]} ${gains[player.id][r]} ${RESOURCE_DETAILS[r][1]}`);
            personal[player.id]=items.length? {
                message:`You received ${items.join(", ")} from the roll.`,kind:"success"
            }
            : {
                message:"You received no resources from this roll.",kind:"info"
            };
        }
        addGameLogEntry(`${roller.name} rolled ${total}; resource distribution complete.`,"info",personal);
    }
    else {
        const personal=Object.fromEntries(state.players.map(player=>[player.id, {
            message:"Rolled 7 — you received no resources.",kind:"info"
        }]));
        addGameLogEntry(`${roller.name} rolled 7. No resources were distributed.`,"info",personal);
    }
    synchronizeRoomState();
    renderGame();
}
function endCurrentTurn() {
    if(!isPlayersTurn()||state.phase!=="play"||!state.rolled)return;
    state.turn=(state.turn+1)%state.players.length;
    state.rolled=false;
    state.dice=null;
    showGameMessage(`${getCurrentPlayer().name}'s turn began.`);
    synchronizeRoomState();
    renderGame()
}
function tradeResources() {
    if(!isPlayersTurn()||state.phase!=="play"||!state.rolled)return;
    let player=getLocalPlayer(),give=getElementById("giveResource").value,get=getElementById("getResource").value;
    if(give===get)return showGameMessage("Choose two different resources.");
    let rate=Object.values(state.ports).some(x=>x.owner===player.id)?3:4;
    if(player.res[give]<rate)return showGameMessage(`You need ${rate} ${RESOURCE_DETAILS[give][1]} to trade.`);
    player.res[give]-=rate;
    player.res[get]++;
    showGameMessage(`${player.name} traded ${rate} ${RESOURCE_DETAILS[give][1]} for 1 ${RESOURCE_DETAILS[get][1]}.`);
    synchronizeRoomState();
    renderGame()
}
function buyDevelopmentCard() {
    if(!isPlayersTurn()||state.phase!=="play"||!state.rolled)return;
    let player=getLocalPlayer();
    if(!payResourceCost(player,BUILDING_COSTS.dev))return showGameMessage("A development card costs 1 grain, 1 wool, and 1 ore.");
    let card=["Knight","Road Building","Year of Plenty","Monopoly","Victory Point"][Math.floor(Math.random()*5)];
    player.dev.push(card);
    if(card==="Victory Point")player.points++;
    showGameMessage(`${player.name} bought a development card: ${card}.`);
    synchronizeRoomState();
    renderGame()
}
function showGameRules() {
    alert("COLONISTS — QUICK RULES\\n\\nTurn: roll 2 dice, collect resources, then build/trade.\\n\\nCosts:\\nRoad: 1 wood + 1 brick\\nSettlement: 1 wood + 1 brick + 1 wool + 1 grain\\nCity upgrade: 3 ore + 2 grain\\nPort: 2 wood + 2 brick + 1 ore\\nDevelopment card: 1 wool + 1 grain + 1 ore\\n\\nSettlements: connect to your road network, and keep one intersection empty between settlements.\\nRoads: must connect to your own road/building.\\nCities: upgrade your own settlement.\\nPorts: coastal intersection, connected to your road network; grants 3:1 trade.\\n\\nFirst to 10 victory points wins. This is an original fan-made game inspired by classic hex-tile trading games, not an official adaptation.");
}
// Load Firebase modules only when a player chooses an online room.
async function initializeFirebase() {
    if(FIREBASE_CONFIG.apiKey==="PASTE_API_KEY")throw new Error("Firebase isn't configured yet. Use local demo or add your Firebase config in the HTML file.");
    const {
        initializeApp
    }
    =await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const {
        getDatabase,ref,set,get,update,onValue,runTransaction
    }
    =await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
    const app=initializeApp(FIREBASE_CONFIG);database=getDatabase(app);
    return {
        ref,set,get,update,onValue,runTransaction
    };
}
let firebaseTools=null;
async function createOnlineRoom() {
    try {
        firebaseTools = await initializeFirebase();
        isOnlineGame = true;
        const roomCode = generateRoomCode();
        state = createNewGameState(roomCode, getElementById("nameInput").value.trim() || "Colonist");
        roomDatabaseReference = firebaseTools.ref(database, "rooms/" + roomCode);
        await firebaseTools.set(roomDatabaseReference, state);
        sessionStorage.setItem("colonistsRoomCode", roomCode);
        sessionStorage.removeItem("colonistsLocalState");
        window.location.href = `game.html?room=${encodeURIComponent(roomCode)}`;
    }
    catch (error) {
        notify(error.message);
    }
}


async function goToGameCreationPage() {
     window.location.href = "game_creation.html"
}

async function joinOnlineRoom() {
    try {
        firebaseTools = await initializeFirebase();
        isOnlineGame = true;
        const roomCode = getElementById("codeInput").value.trim().toUpperCase();
        if (!roomCode) return notify("Enter a room code.");
        roomDatabaseReference = firebaseTools.ref(database, "rooms/" + roomCode);
        const roomSnapshot = await firebaseTools.get(roomDatabaseReference);
        if (!roomSnapshot.exists()) return notify("Room not found. Check the code.");
        const roomState = normalizeRoomState(roomSnapshot.val());
        if (roomState.phase !== "lobby") return notify("This game has already started; new players cannot join now.");
        if (roomState.players.length >= 4) return notify("That room already has 4 players.");
        if (roomState.players.some(player => player.id === currentPlayerId)) return notify("You are already in this room.");
        const newPlayer = {
            id: currentPlayerId,
            name: getElementById("nameInput").value.trim() || "Colonist",
            color: PLAYER_COLORS[roomState.players.length],
            res: {
                wood: 0, brick: 0, wool: 0, grain: 0, ore: 0
            },
            pieces: {
                road: 0, settlement: 0, city: 0, port: 0
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
    }
    catch (error) {
        notify("Could not join room: " + error.message);
    }
}
function subscribeToRoomUpdates() {
    if(unsubscribeFromRoom)unsubscribeFromRoom();unsubscribeFromRoom=firebaseTools.onValue(roomDatabaseReference,snap=> {
        if(snap.exists()) {
            let next=normalizeRoomState(snap.val());
            if(!next.players.some(player=>player.id===currentPlayerId)) {
                alert("You are no longer in this room. Returning to the lobby.");
                window.location.href = "lobby.html";
                return
            }
            state=next;
            renderGame()
        }
    })
}
let syncQueue=Promise.resolve();
async function synchronizeRoomState() {
    if(!isOnlineGame||!roomDatabaseReference)return;
    // Queue full-state snapshots so quick settlement/road clicks do not silently drop a write.
    const snapshot=JSON.parse(JSON.stringify(state));
    syncQueue=syncQueue.then(()=>firebaseTools.set(roomDatabaseReference,snapshot)).catch(e=> {
        console.error(e);
        notify("Sync failed. Check your Firebase rules/config.")
    });
    return syncQueue;
}
function renderInitialGame() {
    lastNoticeId = null;
    getElementById("gameNotice").classList.add("hidden");
    renderGame();
}
function beginOpeningPlacements() {
    if(!state||state.phase!=="lobby"||state.host!==currentPlayerId)return;
    if(state.players.length<2) {
        addGameLogEntry("At least two players are needed to begin.");
        renderGame();
        return
    }
    state.phase="setup";
    const forward=state.players.map(player=>player.id);
    state.setupOrder=[...forward,...forward.slice().reverse()];
    state.setupIndex=0;
    state.setupStep="settlement";
    state.setupSettlement=null;
    state.turn=0;
    state.rolled=false;
    state.dice=null;
    addGameLogEntry(`Opening placements started. ${getCurrentPlayer()?.name} places first. Each player places a settlement followed by an attached road; then placement order reverses.`);
    synchronizeRoomState();
    renderGame();
}
function startLocalDemo() {
    isOnlineGame = false;
    isLocalGame = true;
    const playerName = getElementById("nameInput").value.trim() || "Colonist";
    state = createNewGameState("LOCAL", playerName);
    // The local demo lets one person test both opening settlement-road pairs.
    state.phase = "setup";
    state.setupOrder = [currentPlayerId, currentPlayerId];
    state.setupIndex = 0;
    state.setupStep = "settlement";
    state.logs.push("Local demo started. Place two settlements and their attached roads; the second settlement grants adjacent resources.");
    sessionStorage.setItem("colonistsLocalState", JSON.stringify(state));
    sessionStorage.removeItem("colonistsRoomCode");
    window.location.href = "game.html?mode=local";
}
function leaveGame() {
    if (unsubscribeFromRoom) {
        unsubscribeFromRoom();
        unsubscribeFromRoom = null;
    }
    sessionStorage.removeItem("colonistsRoomCode");
    sessionStorage.removeItem("colonistsLocalState");
    window.location.href = "lobby.html";
}
// Keep a stable player identity when moving from the lobby page to the game page.
currentPlayerId = sessionStorage.getItem("colonistsPlayerId");
if (!currentPlayerId) {
    currentPlayerId = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "player-" + Math.random().toString(36).slice(2);
    sessionStorage.setItem("colonistsPlayerId", currentPlayerId);
}
// Lobby-only controls. The game page has its own separate document.
if (getElementById("createBtn")) {
    getElementById("createBtn").addEventListener("click", createOnlineRoom);
}

if (getElementById("createGameRoom")) {
    getElementById("createGameRoom").addEventListener("click", goToGameCreationPage)
    getElementById("joinBtn").addEventListener("click", joinOnlineRoom);
    getElementById("soloBtn").addEventListener("click", startLocalDemo);
}

// Game-only controls.
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
                modeButton.style.borderColor = modeButton === button ? "var(--accent)" : "";
            });
        });
    });
    bootGamePage();
}
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
        subscribeToRoomUpdates();
    }
    catch (error) {
        alert("Could not connect to the room: " + error.message);
        window.location.href = "lobby.html";
    }
}

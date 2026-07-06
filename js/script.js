let SIGNALING_URL = "ws://localhost:8080/?role=receiver";
let STUN_SERVER_URL = "stun:stun.l.google.com:19302";
const videoEl = document.getElementById("remoteVideo");
const overlay = document.getElementById("overlay");
const hint = document.getElementById("hint");
const statusBar = document.getElementById("status-bar");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const btnFullscreen = document.getElementById("btn-fullscreen");
const btnFill = document.getElementById("btn-fill");
const btnRotate = document.getElementById("btn-rotate");

let pc = null, ws = null, hideTimer = null;
let fillMode = false, rotation = 0;
const signalingHostInput = document.getElementById("signaling-host");
const btnConnect = document.getElementById("btn-connect");

function appendReceiverQuery(url) {
  if (/[?&]role=receiver/i.test(url)) return url;
  return url.includes('?') ? `${url}&role=receiver` : `${url}/?role=receiver`;
}

function normalizeSignalingHost(value) {
  const trimmed = value.trim();
  if (!trimmed) return SIGNALING_URL;

  let normalized = trimmed.replace(/\s+/g, '');

  if (/^wss?:\/\//i.test(normalized)) {
    return appendReceiverQuery(normalized);
  }

  if (/^https?:\/\//i.test(normalized)) {
    normalized = normalized.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    return appendReceiverQuery(normalized);
  }

  const host = normalized.replace(/\/+$/, '');
  const hostName = host.split(/[/:]/)[0];
  const useWss = !/^(localhost|127\.0\.0\.1|\[::1\]|\d+\.\d+\.\d+\.\d+)$/i.test(hostName);
  normalized = `${useWss ? 'wss' : 'ws'}://${host}`;
  return appendReceiverQuery(normalized);
}

function updateSignalingInput(value) {
  if (!signalingHostInput) return;
  signalingHostInput.value = value
    .replace(/^wss?:\/\//i, '')
    .replace(/\/?\?role=receiver$/i, '');
}

function connectWithInput() {
  const inputValue = signalingHostInput?.value?.trim();
  if (inputValue) {
    SIGNALING_URL = normalizeSignalingHost(inputValue);
  }
  connectSignaling();
}

async function loadEnv() {
  const defaultConfig = {
    SIGNALING_URL: "ws://localhost:8080/?role=receiver",
    STUN_SERVER_URL: "stun:stun.l.google.com:19302"
  };

  if (window.location.protocol === 'file:') {
    console.warn('Running from file:// protocol; .env cannot be fetched. Using defaults.');
    return defaultConfig;
  }

  try {
    const response = await fetch('.env');
    if (!response.ok) return defaultConfig;
    const text = await response.text();
    const config = { ...defaultConfig };
    text.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const [key, ...rest] = trimmed.split('=');
      if (!key) return;
      config[key.trim()] = rest.join('=').trim();
    });
    return config;
  } catch (error) {
    console.warn('Could not load .env config, using defaults.', error);
    return defaultConfig;
  }
}

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}]`, msg); }

function updateStatus(dotClass, text) {
  statusDot.className = dotClass;
  statusText.textContent = text;
  statusBar.classList.remove("hide");
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => statusBar.classList.add("hide"), 3000);
}

document.addEventListener("mousemove", () => { if (videoEl.srcObject) updateStatus(statusDot.className, statusText.textContent); });

// ===== Fullscreen =====
function toggleFullscreen() {
  if (!document.fullscreenElement) document.body.requestFullscreen().then(() => document.body.classList.add("fullscreen")).catch(() => { });
  else document.exitFullscreen().then(() => document.body.classList.remove("fullscreen"));
}

// ===== Fill =====
function applyFill() {
  videoEl.style.objectFit = fillMode ? "cover" : "contain";
  btnFill.textContent = fillMode ? "⊡ Adaptive" : "⊡ Fill";
  btnFill.classList.toggle("active", fillMode);
}

// ===== Rotate =====
function applyRotation() {
  const on = rotation % 180 !== 0;
  videoEl.classList.toggle("rotated", on);
  videoEl.classList.toggle("normal", !on);
  videoEl.style.transform = on ? `translate(-50%, -50%) rotate(${rotation}deg)` : "";
}

btnFullscreen.addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) document.body.classList.remove("fullscreen");
});

btnFill.addEventListener("click", () => { fillMode = !fillMode; applyFill(); });

btnRotate.addEventListener("click", () => { rotation = (rotation + 90) % 360; applyRotation(); });

videoEl.addEventListener("dblclick", toggleFullscreen);
document.addEventListener("keydown", (e) => {
  if (e.key === "f" || e.key === "F") toggleFullscreen();
  if (e.key === "r" || e.key === "R") btnRotate.click();
  if (e.key === "c" || e.key === "C") btnFill.click();
});

// ===== Signaling =====
function connectSignaling() {
  if (ws && ws.readyState !== WebSocket.CLOSED) {
    ws.close();
  }
  ws = new WebSocket(SIGNALING_URL);
  ws.onopen = () => updateStatus("waiting", "Waiting for mobile pairing...");
  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case "offer": await handleOffer(msg); break;
      case "ice-candidate":
        if (pc && msg.candidate) await pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); break;
      case "peer-disconnected":
        overlay.classList.remove("hidden"); updateStatus("disconnected", "Mobile disconnected"); break;
    }
  };
  ws.onclose = () => { updateStatus("disconnected", "Signaling disconnected, reconnecting in 5s"); setTimeout(connectSignaling, 5000); };
  ws.onerror = () => updateStatus("disconnected", "Signaling connection failed");
}

async function handleOffer(msg) {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: STUN_SERVER_URL }],
    bundlePolicy: "max-bundle",
    rtcpMuxPolicy: "require",
  });
  pc.ontrack = (event) => {
    const rcv = event.receiver;
    if (rcv && rcv.playoutDelayHint !== undefined) rcv.playoutDelayHint = 0.05;
    videoEl.srcObject = event.streams[0];
    overlay.classList.add("hidden");
    hint.style.opacity = "0";
    updateStatus("connected", "Mirroring");
  };
  pc.onicecandidate = (event) => {
    if (event.candidate && ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate.toJSON() }));
  };
  pc.oniceconnectionstatechange = () => {
    log("ICE: " + pc.iceConnectionState);
    if (pc.iceConnectionState === "connected") updateStatus("connected", "Mirroring");
    else if (pc.iceConnectionState === "disconnected") { updateStatus("disconnected", "Stream interrupted"); overlay.classList.remove("hidden"); }
    else if (pc.iceConnectionState === "failed") { updateStatus("disconnected", "Connection failed"); overlay.classList.remove("hidden"); }
  };
  await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: msg.sdp }));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
}

loadEnv().then((config) => {
  SIGNALING_URL = config.SIGNALING_URL || SIGNALING_URL;
  STUN_SERVER_URL = config.STUN_SERVER_URL || STUN_SERVER_URL;
  updateSignalingInput(SIGNALING_URL);
  if (window.location.protocol !== 'file:') {
    connectSignaling();
  }
});

btnConnect.addEventListener("click", connectWithInput);
signalingHostInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") connectWithInput();
});
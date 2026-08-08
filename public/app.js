const landing = document.getElementById('landing');
const roomView = document.getElementById('roomView');
const nameInput = document.getElementById('nameInput');
const roomInput = document.getElementById('roomInput');
const joinBtn = document.getElementById('joinBtn');
const createBtn = document.getElementById('createBtn');
const roomTitle = document.getElementById('roomTitle');
const copyBtn = document.getElementById('copyBtn');
const syncBtn = document.getElementById('syncBtn');
const youtubeUrl = document.getElementById('youtubeUrl');
const loadBtn = document.getElementById('loadBtn');
const emptyState = document.getElementById('emptyState');
const userCount = document.getElementById('userCount');
const presenceLabel = document.getElementById('presenceLabel');
const toast = document.getElementById('toast');

const joinVoiceBtn = document.getElementById('joinVoiceBtn');
const muteBtn = document.getElementById('muteBtn');
const leaveVoiceBtn = document.getElementById('leaveVoiceBtn');
const voiceTitle = document.getElementById('voiceTitle');
const voiceStatus = document.getElementById('voiceStatus');
const voiceCount = document.getElementById('voiceCount');
const participants = document.getElementById('participants');
const voiceOrb = document.getElementById('voiceOrb');
const remoteAudios = document.getElementById('remoteAudios');

let roomId = '';
let displayName = '';
let player = null;
let playerReady = false;
let pendingVideoId = '';
let applyingRemote = false;
let lastKnownState = -1;
let lastTime = 0;
let pollTimer = null;
let eventSource = null;
let roomUsers = [];

let localStream = null;
let voiceJoined = false;
let muted = false;
const peers = new Map();
const pendingCandidates = new Map();

const clientId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

function randomRoom() {
  const a = ['cosmic','quiet','pixel','midnight','mango','violet','orbit','chill'];
  const b = ['cinema','room','nest','screen','party','stream','lounge','club'];
  return `${a[Math.floor(Math.random()*a.length)]}-${b[Math.floor(Math.random()*b.length)]}-${Math.floor(100+Math.random()*900)}`;
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1800);
}

function extractVideoId(input) {
  const raw = String(input || '').trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || '';
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname === '/watch') return u.searchParams.get('v') || '';
      const parts = u.pathname.split('/').filter(Boolean);
      if (['embed','shorts','live'].includes(parts[0])) return parts[1] || '';
    }
  } catch (_) {}
  return '';
}

async function sendAction(type, payload = {}) {
  try {
    await fetch('/api/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, roomId, name: displayName, clientId, ...payload })
    });
  } catch (_) {
    showToast('Connection problem');
  }
}

function connectRoomEvents() {
  if (eventSource) eventSource.close();
  const q = new URLSearchParams({ room: roomId, name: displayName, client: clientId });
  eventSource = new EventSource(`/events?${q}`);
  eventSource.onopen = () => { presenceLabel.textContent = 'Connected'; };
  eventSource.onerror = () => { presenceLabel.textContent = 'Reconnecting…'; };
  eventSource.addEventListener('room-state', e => applyRoomState(JSON.parse(e.data)));
  eventSource.addEventListener('load-video', e => {
    const { videoId, by } = JSON.parse(e.data);
    loadIntoPlayer(videoId, false);
    showToast(`${by || 'Someone'} loaded a video`);
  });
  eventSource.addEventListener('player-action', e => applyRemoteAction(JSON.parse(e.data)));
  eventSource.addEventListener('presence', e => {
    roomUsers = JSON.parse(e.data);
    userCount.textContent = `${roomUsers.length} online`;
    presenceLabel.textContent = `${roomUsers.length} connected`;
    renderParticipants();
    syncVoicePeers();
  });
  eventSource.addEventListener('rtc-signal', e => handleRtcSignal(JSON.parse(e.data)));
  eventSource.addEventListener('rtc-peer-left', e => {
    const { clientId: leftId } = JSON.parse(e.data);
    closePeer(leftId);
  });
}

function enterRoom(id, name) {
  roomId = id.trim();
  displayName = name.trim() || 'Guest';
  if (!roomId) return showToast('Enter a room code');
  const url = new URL(location.href);
  url.searchParams.set('room', roomId);
  url.searchParams.set('name', displayName);
  history.replaceState({}, '', url);
  landing.classList.add('hidden');
  roomView.classList.remove('hidden');
  roomTitle.textContent = roomId;
  localStorage.setItem('syncnest-name', displayName);
  connectRoomEvents();
}

joinBtn.addEventListener('click', () => enterRoom(roomInput.value, nameInput.value));
createBtn.addEventListener('click', () => {
  roomInput.value = randomRoom();
  enterRoom(roomInput.value, nameInput.value);
});
roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') enterRoom(roomInput.value, nameInput.value); });

copyBtn.addEventListener('click', async () => {
  const url = new URL(location.href);
  url.searchParams.delete('name');
  await navigator.clipboard.writeText(url.toString());
  showToast('Invite link copied');
});

syncBtn.addEventListener('click', () => {
  sendAction('request-sync');
  showToast('Re-sync requested');
});

loadBtn.addEventListener('click', () => {
  const videoId = extractVideoId(youtubeUrl.value);
  if (!videoId) return showToast('Paste a valid YouTube link');
  sendAction('load-video', { videoId });
});
youtubeUrl.addEventListener('keydown', e => { if (e.key === 'Enter') loadBtn.click(); });

function renderParticipants() {
  const sorted = [...roomUsers].sort((a, b) => {
    if (a.id === clientId) return -1;
    if (b.id === clientId) return 1;
    if (a.voice !== b.voice) return a.voice ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  participants.replaceChildren();
  for (const user of sorted) {
    const row = document.createElement('div');
    row.className = 'participant';

    const avatar = document.createElement('div');
    avatar.className = `avatar ${user.voice ? 'active' : ''}`;
    avatar.textContent = (user.name || '?').slice(0, 1).toUpperCase();

    const details = document.createElement('div');
    details.className = 'participant-details';
    const name = document.createElement('strong');
    name.textContent = `${user.name}${user.id === clientId ? ' (You)' : ''}`;
    const state = document.createElement('span');
    state.textContent = user.voice ? 'In voice' : 'Not in call';
    details.append(name, state);

    const indicator = document.createElement('span');
    indicator.className = `voice-indicator ${user.voice ? 'on' : ''}`;
    indicator.textContent = user.voice ? '●' : '○';

    row.append(avatar, details, indicator);
    participants.appendChild(row);
  }

  const inVoice = roomUsers.filter(u => u.voice).length;
  voiceCount.textContent = `${inVoice} in voice`;
}

joinVoiceBtn.addEventListener('click', joinVoice);
muteBtn.addEventListener('click', toggleMute);
leaveVoiceBtn.addEventListener('click', leaveVoice);

async function joinVoice() {
  if (voiceJoined) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Voice calling is not supported here');
    return;
  }

  try {
    voiceStatus.textContent = 'Requesting microphone permission…';
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    voiceJoined = true;
    muted = false;
    updateVoiceControls();
    await sendAction('voice-status', { active: true });
    voiceStatus.textContent = 'Connected. You can keep watching while you talk.';
    syncVoicePeers();
  } catch (err) {
    console.error(err);
    voiceStatus.textContent = 'Microphone access was not granted.';
    showToast('Allow microphone access to join voice');
  }
}

function toggleMute() {
  if (!localStream) return;
  muted = !muted;
  for (const track of localStream.getAudioTracks()) track.enabled = !muted;
  updateVoiceControls();
}

async function leaveVoice() {
  if (!voiceJoined && !localStream) return;
  voiceJoined = false;
  await sendAction('voice-status', { active: false });
  for (const peerId of [...peers.keys()]) closePeer(peerId);
  if (localStream) {
    for (const track of localStream.getTracks()) track.stop();
    localStream = null;
  }
  muted = false;
  updateVoiceControls();
  voiceStatus.textContent = 'Join when you\'re ready. Your browser will ask for microphone permission.';
}

function updateVoiceControls() {
  joinVoiceBtn.classList.toggle('hidden', voiceJoined);
  muteBtn.classList.toggle('hidden', !voiceJoined);
  leaveVoiceBtn.classList.toggle('hidden', !voiceJoined);
  muteBtn.textContent = muted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('muted', muted);
  voiceOrb.classList.toggle('live', voiceJoined);
  voiceOrb.classList.toggle('muted', muted);
  voiceTitle.textContent = voiceJoined ? (muted ? 'Microphone muted' : 'You’re in the voice call') : 'Voice call is off';
}

function syncVoicePeers() {
  const activeIds = new Set(roomUsers.filter(u => u.voice && u.id !== clientId).map(u => u.id));

  for (const peerId of [...peers.keys()]) {
    if (!voiceJoined || !activeIds.has(peerId)) closePeer(peerId);
  }

  if (!voiceJoined || !localStream) return;
  for (const peerId of activeIds) {
    if (!peers.has(peerId)) ensurePeer(peerId, clientId < peerId);
  }
}

function ensurePeer(peerId, shouldOffer = false) {
  if (peers.has(peerId)) return peers.get(peerId);
  if (!voiceJoined || !localStream) return null;

  const pc = new RTCPeerConnection(rtcConfig);
  peers.set(peerId, pc);
  pendingCandidates.set(peerId, []);

  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);

  pc.onicecandidate = event => {
    if (event.candidate) {
      sendAction('rtc-signal', {
        targetId: peerId,
        signal: { candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate }
      });
    }
  };

  pc.ontrack = event => {
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${peerId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      remoteAudios.appendChild(audio);
    }
    audio.srcObject = event.streams[0];
    audio.play().catch(() => {
      voiceStatus.textContent = 'Tap anywhere once if your browser blocks incoming audio.';
    });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      voiceStatus.textContent = 'Connected. You can keep watching while you talk.';
    }
    if (['failed', 'closed'].includes(pc.connectionState)) closePeer(peerId);
  };

  if (shouldOffer) createOffer(peerId, pc);
  return pc;
}

async function createOffer(peerId, pc) {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendAction('rtc-signal', {
      targetId: peerId,
      signal: { description: pc.localDescription }
    });
  } catch (err) {
    console.error('Offer failed', err);
    closePeer(peerId);
  }
}

async function handleRtcSignal({ fromId, signal }) {
  if (!voiceJoined || !localStream || !fromId || !signal) return;
  const pc = ensurePeer(fromId, false);
  if (!pc) return;

  try {
    if (signal.description) {
      await pc.setRemoteDescription(signal.description);
      await flushCandidates(fromId, pc);

      if (signal.description.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await sendAction('rtc-signal', {
          targetId: fromId,
          signal: { description: pc.localDescription }
        });
      }
    }

    if (signal.candidate) {
      if (pc.remoteDescription) {
        await pc.addIceCandidate(signal.candidate);
      } else {
        if (!pendingCandidates.has(fromId)) pendingCandidates.set(fromId, []);
        pendingCandidates.get(fromId).push(signal.candidate);
      }
    }
  } catch (err) {
    console.error('RTC signal error', err);
  }
}

async function flushCandidates(peerId, pc) {
  const queue = pendingCandidates.get(peerId) || [];
  pendingCandidates.set(peerId, []);
  for (const candidate of queue) {
    try { await pc.addIceCandidate(candidate); } catch (err) { console.error(err); }
  }
}

function closePeer(peerId) {
  const pc = peers.get(peerId);
  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
  }
  peers.delete(peerId);
  pendingCandidates.delete(peerId);
  const audio = document.getElementById(`audio-${peerId}`);
  if (audio) audio.remove();
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('player', {
    height: '100%', width: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
    events: { onReady: () => {
      playerReady = true;
      if (pendingVideoId) loadIntoPlayer(pendingVideoId, false);
      startPlayerPolling();
    }}
  });
};

function loadIntoPlayer(videoId, autoplay=false) {
  pendingVideoId = videoId;
  emptyState.classList.add('hidden');
  if (!playerReady) return;
  applyingRemote = true;
  player.cueVideoById(videoId);
  setTimeout(() => {
    if (autoplay) player.playVideo();
    applyingRemote = false;
    lastKnownState = player.getPlayerState();
    lastTime = player.getCurrentTime() || 0;
  }, 350);
}

function applyRoomState(state) {
  if (!state || !state.videoId) return;
  if (pendingVideoId !== state.videoId) loadIntoPlayer(state.videoId, false);
  const apply = () => {
    if (!playerReady) return setTimeout(apply, 150);
    applyingRemote = true;
    player.seekTo(state.currentTime || 0, true);
    if (state.state === 'playing') player.playVideo(); else player.pauseVideo();
    setTimeout(() => {
      applyingRemote = false;
      lastKnownState = player.getPlayerState();
      lastTime = player.getCurrentTime() || 0;
    }, 450);
  };
  setTimeout(apply, 350);
}

function applyRemoteAction({ action, currentTime }) {
  if (!playerReady || !pendingVideoId) return;
  applyingRemote = true;
  if (Math.abs((player.getCurrentTime() || 0) - currentTime) > 0.8 || action === 'seek') player.seekTo(currentTime, true);
  if (action === 'play') player.playVideo();
  if (action === 'pause') player.pauseVideo();
  setTimeout(() => {
    applyingRemote = false;
    lastKnownState = player.getPlayerState();
    lastTime = player.getCurrentTime() || 0;
  }, 350);
}

function startPlayerPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!playerReady || applyingRemote || !pendingVideoId || !roomId) return;
    const state = player.getPlayerState();
    const t = player.getCurrentTime() || 0;
    if (state !== lastKnownState) {
      if (state === YT.PlayerState.PLAYING) sendAction('player-action', { action: 'play', currentTime: t });
      if (state === YT.PlayerState.PAUSED) sendAction('player-action', { action: 'pause', currentTime: t });
      lastKnownState = state;
      lastTime = t;
      return;
    }
    const expectedDelta = state === YT.PlayerState.PLAYING ? 0.25 : 0;
    const actualDelta = t - lastTime;
    if (Math.abs(actualDelta - expectedDelta) > 1.5) sendAction('player-action', { action: 'seek', currentTime: t });
    lastTime = t;
  }, 250);
}

window.addEventListener('beforeunload', () => {
  if (voiceJoined) {
    navigator.sendBeacon('/api/action', new Blob([JSON.stringify({
      type: 'voice-status', roomId, name: displayName, clientId, active: false
    })], { type: 'application/json' }));
  }
});

const params = new URLSearchParams(location.search);
const presetRoom = params.get('room');
const presetName = params.get('name') || localStorage.getItem('syncnest-name') || '';
nameInput.value = presetName;
if (presetRoom) {
  roomInput.value = presetRoom;
  if (!nameInput.value) nameInput.value = `Guest-${Math.floor(10+Math.random()*90)}`;
  enterRoom(presetRoom, nameInput.value);
}

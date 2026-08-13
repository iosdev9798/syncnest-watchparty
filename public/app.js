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
const localVideoFile = document.getElementById('localVideoFile');
const loadLocalBtn = document.getElementById('loadLocalBtn');
const localPlayer = document.getElementById('localPlayer');
const localAltAudio = document.getElementById('localAltAudio');
const localTrackControls = document.getElementById('localTrackControls');
const audioTrackSelect = document.getElementById('audioTrackSelect');
const subtitleTrackSelect = document.getElementById('subtitleTrackSelect');
const subtitleFile = document.getElementById('subtitleFile');
const trackSupportNote = document.getElementById('trackSupportNote');
const youtubeSurface = document.getElementById('youtubePlayer');
const emptyState = document.getElementById('emptyState');
const emptyTitle = document.getElementById('emptyTitle');
const emptyText = document.getElementById('emptyText');
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
let youtubeReady = false;
let loadedYoutubeId = '';
let activeSource = null;
let activeMediaKey = '';
let currentLocalFile = null;
let currentLocalMeta = null;
let localObjectUrl = '';
let localReady = false;
let externalSubtitleUrls = [];
let generatedEmbeddedSubtitleUrl = '';
let generatedAudioUrl = '';
let altAudioActive = false;
let altAudioPlayWarningShown = false;
let audioRoutingContext = null;
let audioRoutingSource = null;
let audioRoutingGain = null;
let ffmpegClient = null;
let ffmpegMounted = false;
let ffmpegInputPath = '';
let ffmpegTaskQueue = Promise.resolve();
let ffmpegWorkerBlobUrl = '';
let ffmpegCoreBlobUrl = '';
let ffmpegWasmBlobUrl = '';
let inspectedTracks = { key: '', audio: [], subtitles: [] };
let inspectingLocalMedia = false;
let selectedInspectedAudio = null;
let selectedSubtitleValue = 'off';
let trackOperationMessage = '';
let preparingAudioTrack = false;
let preparingSubtitleTrack = false;
let audioJobToken = 0;
let subtitleJobToken = 0;
let inspectionJobToken = 0;
let pendingRoomState = null;
let applyingRemote = false;
let lastKnownState = 'paused';
let lastTime = 0;
let pollTimer = null;
let eventSource = null;
let roomUsers = [];

let localStream = null;
let voiceJoined = false;
let muted = false;
const peers = new Map();
const pendingCandidates = new Map();
const pendingAudioPlayback = new Set();

const clientId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
let rtcConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};
let rtcConfigLoaded = false;

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

function fileMeta(file) {
  return {
    name: String(file?.name || '').slice(0, 180),
    size: Number(file?.size) || 0,
    lastModified: Number(file?.lastModified) || 0,
    mime: String(file?.type || '').slice(0, 100)
  };
}

function mediaKey(source) {
  if (!source) return '';
  if (source.type === 'youtube') return `youtube:${source.videoId || ''}`;
  if (source.type === 'local' && source.file) {
    return `local:${source.file.name || ''}:${Number(source.file.size) || 0}`;
  }
  return '';
}

function localFileMatches(file, expected) {
  if (!file || !expected) return false;
  const meta = fileMeta(file);
  return meta.name === expected.name && meta.size === Number(expected.size || 0);
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
  eventSource.addEventListener('load-media', e => {
    const { source, by } = JSON.parse(e.data);
    activateSource(source);
    pendingRoomState = { source, state: 'paused', currentTime: 0 };
    tryApplyRoomState();
    showToast(`${by || 'Someone'} loaded ${source?.type === 'local' ? 'a local video' : 'a YouTube video'}`);
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

localVideoFile.addEventListener('change', () => {
  const file = localVideoFile.files?.[0];
  if (!file) return;
  if (activeSource?.type === 'local' && localFileMatches(file, activeSource.file)) {
    attachLocalFile(file);
    sendAction('request-sync');
    showToast('Local video matched. Re-syncing…');
  }
});

loadLocalBtn.addEventListener('click', () => {
  const file = localVideoFile.files?.[0];
  if (!file) return showToast('Choose a local video file first');

  if (activeSource?.type === 'local' && localFileMatches(file, activeSource.file)) {
    attachLocalFile(file);
    sendAction('request-sync');
    return showToast('Using the room’s local video');
  }

  const meta = fileMeta(file);
  attachLocalFile(file);
  activateSource({ type: 'local', file: meta });
  pendingRoomState = { source: activeSource, state: 'paused', currentTime: 0 };
  sendAction('load-local', { file: meta });
});

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

// If a browser blocks remote WebRTC audio autoplay, the next real user
// interaction retries every pending remote audio element. The previous code
// told the user to tap, but never actually retried playback.
function retryRemoteAudioPlayback() {
  for (const audio of [...pendingAudioPlayback]) {
    if (!audio.isConnected || !audio.srcObject) {
      pendingAudioPlayback.delete(audio);
      continue;
    }
    audio.muted = false;
    audio.volume = 1;
    audio.play().then(() => {
      pendingAudioPlayback.delete(audio);
      if (voiceJoined) voiceStatus.textContent = 'Connected. You can keep watching while you talk.';
    }).catch(() => {});
  }
}

document.addEventListener('pointerdown', retryRemoteAudioPlayback, { passive: true });
document.addEventListener('keydown', retryRemoteAudioPlayback);

function hasTurnServer() {
  return (rtcConfig.iceServers || []).some(server => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some(url => /^turns?:/i.test(String(url || '')));
  });
}

async function loadRtcConfig() {
  if (rtcConfigLoaded) return;
  try {
    const response = await fetch('/api/rtc-config', { cache: 'no-store' });
    if (response.ok) {
      const config = await response.json();
      if (Array.isArray(config.iceServers) && config.iceServers.length) rtcConfig = config;
    }
  } catch (err) {
    console.warn('Using default STUN configuration', err);
  }
  rtcConfigLoaded = true;
}

async function joinVoice() {
  if (voiceJoined) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Voice calling is not supported here');
    return;
  }

  try {
    voiceStatus.textContent = 'Preparing secure voice connection…';
    await loadRtcConfig();
    voiceStatus.textContent = 'Requesting microphone permission…';
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false
    });
    voiceJoined = true;
    muted = false;
    updateVoiceControls();
    await sendAction('voice-status', { active: true });
    voiceStatus.textContent = 'Connecting to other listeners…';
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
      audio.preload = 'auto';
      audio.volume = 1;
      audio.muted = false;
      remoteAudios.appendChild(audio);
    }

    // event.streams can be empty in some browser/WebRTC combinations.
    // Build a stream from the received track so audio still has a source.
    const remoteStream = event.streams && event.streams[0]
      ? event.streams[0]
      : new MediaStream([event.track]);

    if (audio.srcObject !== remoteStream) audio.srcObject = remoteStream;
    audio.muted = false;
    audio.volume = 1;

    audio.play().then(() => {
      pendingAudioPlayback.delete(audio);
    }).catch(err => {
      console.warn('Remote audio autoplay was blocked', peerId, err);
      pendingAudioPlayback.add(audio);
      voiceStatus.textContent = 'Incoming audio is blocked. Tap anywhere once to enable sound.';
    });
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      voiceStatus.textContent = 'Connected. You can keep watching while you talk.';
    } else if (pc.connectionState === 'connecting') {
      voiceStatus.textContent = 'Connecting to the other listener…';
    } else if (pc.connectionState === 'failed') {
      console.warn('WebRTC connection failed', peerId, pc.iceConnectionState);
      voiceStatus.textContent = hasTurnServer()
        ? 'Voice connection failed. Retrying…'
        : 'Voice connection failed. This network may require a TURN server.';
      restartPeer(peerId);
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'failed') {
      try { pc.restartIce(); } catch (_) {}
      if (peers.get(peerId) === pc) createOffer(peerId, pc);
    }
  };

  if (shouldOffer) createOffer(peerId, pc);
  return pc;
}

function restartPeer(peerId) {
  const old = peers.get(peerId);
  if (old) old.close();
  peers.delete(peerId);
  pendingCandidates.delete(peerId);
  const shouldOffer = clientId < peerId;
  setTimeout(() => {
    if (voiceJoined && localStream && !peers.has(peerId)) ensurePeer(peerId, shouldOffer);
  }, 300);
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
  if (audio) {
    pendingAudioPlayback.delete(audio);
    try { audio.pause(); } catch (_) {}
    audio.srcObject = null;
    audio.remove();
  }
}

window.onYouTubeIframeAPIReady = function () {
  player = new YT.Player('player', {
    height: '100%', width: '100%',
    playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: location.origin },
    events: { onReady: () => {
      youtubeReady = true;
      if (activeSource?.type === 'youtube') cueYoutube(activeSource.videoId);
      tryApplyRoomState();
      startPlayerPolling();
    }}
  });
};

function setEmptyState(title, text, visible = true) {
  emptyTitle.textContent = title;
  emptyText.textContent = text;
  emptyState.classList.toggle('hidden', !visible);
}

function cueYoutube(videoId) {
  if (!youtubeReady || !videoId || loadedYoutubeId === videoId) return;
  applyingRemote = true;
  player.cueVideoById(videoId);
  loadedYoutubeId = videoId;
  setTimeout(() => {
    applyingRemote = false;
    lastKnownState = getPlaybackState();
    lastTime = getCurrentTime();
    tryApplyRoomState();
  }, 350);
}

function listTracks(trackList) {
  if (!trackList || typeof trackList.length !== 'number') return [];
  const tracks = [];
  for (let i = 0; i < trackList.length; i += 1) tracks.push(trackList[i]);
  return tracks;
}

function displayLanguage(code) {
  const language = String(code || '').trim();
  if (!language) return '';
  try {
    if (Intl.DisplayNames) {
      const names = new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' });
      return names.of(language) || language.toUpperCase();
    }
  } catch (_) {}
  return language.toUpperCase();
}

function mediaTrackLabel(track, fallback) {
  const label = String(track?.label || '').trim();
  const language = displayLanguage(track?.language);
  if (label && language && !label.toLowerCase().includes(String(track.language || '').toLowerCase())) {
    return `${label} — ${language}`;
  }
  return label || language || fallback;
}

function inspectedTrackLabel(track, fallback) {
  const title = String(track?.title || '').trim();
  const language = displayLanguage(track?.language);
  const codec = String(track?.codec || '').toUpperCase();
  const channels = Number(track?.channels) || 0;
  const details = [codec, channels > 2 ? `${channels}ch` : ''].filter(Boolean).join(' · ');
  let primary = title || language || fallback;
  if (title && language && !title.toLowerCase().includes(language.toLowerCase())) primary = `${title} — ${language}`;
  return details ? `${primary} (${details})` : primary;
}

function fileInspectionKey(file) {
  if (!file) return '';
  return `${file.name}:${file.size}:${file.lastModified || 0}`;
}

const FFMPEG_WORKER_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/umd/814.ffmpeg.js';
const FFMPEG_CORE_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.js';
const FFMPEG_WASM_URL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm';

async function fetchFfmpegAsset(url, mime) {
  const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!response.ok) throw new Error(`Could not download local media engine asset (${response.status})`);
  const bytes = await response.arrayBuffer();
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

class LocalFFmpegClient {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = { log: new Set(), progress: new Set() };
    this.loaded = false;
  }

  registerWorkerHandlers() {
    this.worker.onmessage = ({ data }) => {
      if (!data) return;
      if (data.type === 'LOG') {
        for (const listener of this.listeners.log) listener(data.data || {});
        return;
      }
      if (data.type === 'PROGRESS') {
        for (const listener of this.listeners.progress) listener(data.data || {});
        return;
      }
      const pending = this.pending.get(data.id);
      if (!pending) return;
      this.pending.delete(data.id);
      if (data.type === 'ERROR') pending.reject(new Error(String(data.data || 'FFmpeg error')));
      else pending.resolve(data.data);
    };
    this.worker.onerror = event => {
      const err = new Error(event?.message || 'Could not start the local media engine');
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
    };
  }

  send(type, data) {
    if (!this.worker) return Promise.reject(new Error('Local media engine is not loaded'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, type, data });
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async load() {
    if (this.loaded) return;
    if (!this.worker) {
      if (!ffmpegWorkerBlobUrl || !ffmpegCoreBlobUrl || !ffmpegWasmBlobUrl) {
        [ffmpegWorkerBlobUrl, ffmpegCoreBlobUrl, ffmpegWasmBlobUrl] = await Promise.all([
          fetchFfmpegAsset(FFMPEG_WORKER_URL, 'application/javascript'),
          fetchFfmpegAsset(FFMPEG_CORE_URL, 'application/javascript'),
          fetchFfmpegAsset(FFMPEG_WASM_URL, 'application/wasm')
        ]);
      }
      this.worker = new Worker(ffmpegWorkerBlobUrl);
      this.registerWorkerHandlers();
    }
    await this.send('LOAD', { coreURL: ffmpegCoreBlobUrl, wasmURL: ffmpegWasmBlobUrl });
    this.loaded = true;
  }

  terminate() {
    const err = new Error('Local media operation cancelled');
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
    try { this.worker?.terminate(); } catch (_) {}
    this.worker = null;
    this.loaded = false;
  }

  on(type, listener) { this.listeners[type]?.add(listener); }
  off(type, listener) { this.listeners[type]?.delete(listener); }
  ffprobe(args) { return this.send('FFPROBE', { args, timeout: -1 }); }
  exec(args) { return this.send('EXEC', { args, timeout: -1 }); }
  readFile(path, encoding = 'binary') { return this.send('READ_FILE', { path, encoding }); }
  deleteFile(path) { return this.send('DELETE_FILE', { path }); }
  createDir(path) { return this.send('CREATE_DIR', { path }); }
  mount(fsType, options, mountPoint) { return this.send('MOUNT', { fsType, options, mountPoint }); }
  unmount(mountPoint) { return this.send('UNMOUNT', { mountPoint }); }
}

function enqueueFfmpegTask(task) {
  const next = ffmpegTaskQueue.then(task, task);
  ffmpegTaskQueue = next.catch(() => {});
  return next;
}

async function ensureFfmpegClient() {
  if (!ffmpegClient) ffmpegClient = new LocalFFmpegClient();
  await ffmpegClient.load();
  return ffmpegClient;
}

async function mountLocalFileForFfmpeg(file) {
  const ffmpeg = await ensureFfmpegClient();
  if (ffmpegMounted) {
    try { await ffmpeg.unmount('/source'); } catch (_) {}
    ffmpegMounted = false;
  }
  try { await ffmpeg.createDir('/source'); } catch (_) {}
  await ffmpeg.mount('WORKERFS', { files: [file] }, '/source');
  ffmpegMounted = true;
  ffmpegInputPath = `/source/${file.name}`;
  return ffmpegInputPath;
}

function normalizeProbeTrack(stream) {
  return {
    index: Number(stream?.index),
    codec: String(stream?.codec_name || '').toLowerCase(),
    language: String(stream?.tags?.language || '').trim(),
    title: String(stream?.tags?.title || '').trim(),
    channels: Number(stream?.channels) || 0,
    default: Number(stream?.disposition?.default) === 1
  };
}

async function inspectLocalTracks(file) {
  const key = fileInspectionKey(file);
  const inspectionToken = ++inspectionJobToken;
  if (!file || !/\.mkv$/i.test(file.name || '')) {
    inspectedTracks = { key: '', audio: [], subtitles: [] };
    inspectingLocalMedia = false;
    refreshTrackControls();
    return;
  }
  if (inspectedTracks.key === key && (inspectedTracks.audio.length || inspectedTracks.subtitles.length)) return;

  inspectedTracks = { key, audio: [], subtitles: [] };
  inspectingLocalMedia = true;
  selectedInspectedAudio = null;
  selectedSubtitleValue = 'off';
  trackOperationMessage = 'Scanning MKV audio and subtitle tracks locally…';
  refreshTrackControls();

  try {
    await enqueueFfmpegTask(async () => {
      const ffmpeg = await ensureFfmpegClient();
      await mountLocalFileForFfmpeg(file);
      const probeOutput = `/probe-${inspectionToken}.json`;
      const code = await ffmpeg.ffprobe(['-v', 'error', '-print_format', 'json', '-show_streams', ffmpegInputPath, '-o', probeOutput]);
      if (Number(code) !== 0) throw new Error(`ffprobe exited with code ${code}`);
      const probeText = await ffmpeg.readFile(probeOutput, 'utf8');
      try { await ffmpeg.deleteFile(probeOutput); } catch (_) {}
      const probe = JSON.parse(String(probeText || '{}'));
      const streams = Array.isArray(probe?.streams) ? probe.streams : [];
      const audio = streams.filter(stream => stream.codec_type === 'audio').map(normalizeProbeTrack);
      const subtitles = streams.filter(stream => stream.codec_type === 'subtitle').map(normalizeProbeTrack);
      if (inspectionToken !== inspectionJobToken || fileInspectionKey(currentLocalFile) !== key) return;
      inspectedTracks = { key, audio, subtitles };
      const defaultAudio = audio.find(track => track.default) || audio[0];
      selectedInspectedAudio = defaultAudio ? defaultAudio.index : null;
    });

    if (inspectionToken !== inspectionJobToken) return;
    trackOperationMessage = '';
    if (inspectedTracks.audio.length > 1) showToast(`${inspectedTracks.audio.length} audio tracks found in the MKV`);
  } catch (err) {
    console.error('MKV track scan failed', err);
    if (inspectionToken !== inspectionJobToken) return;
    inspectedTracks = { key, audio: [], subtitles: [] };
    trackOperationMessage = 'Could not scan this MKV locally. Browser-native tracks are still available if supported.';
  } finally {
    if (inspectionToken === inspectionJobToken) {
      inspectingLocalMedia = false;
      refreshTrackControls();
    }
  }
}

function externalTextTrackIndexes() {
  const textTracks = listTracks(localPlayer.textTracks);
  const allowed = new Set();
  for (const el of localPlayer.querySelectorAll('track[data-external-subtitle="true"]')) {
    const idx = textTracks.findIndex(track => track === el.track);
    if (idx >= 0) allowed.add(idx);
  }
  return allowed;
}

function generatedTextTrackIndexes() {
  const textTracks = listTracks(localPlayer.textTracks);
  const allowed = new Set();
  for (const el of localPlayer.querySelectorAll('track[data-generated-embedded-subtitle="true"]')) {
    const idx = textTracks.findIndex(track => track === el.track);
    if (idx >= 0) allowed.add(idx);
  }
  return allowed;
}

function refreshTrackControls() {
  const localIsActive = activeSource?.type === 'local' && Boolean(currentLocalFile);
  localTrackControls.classList.toggle('hidden', !localIsActive);
  if (!localIsActive) return;

  const nativeAudioTracks = listTracks(localPlayer.audioTracks);
  audioTrackSelect.replaceChildren();

  if (inspectedTracks.audio.length) {
    audioTrackSelect.disabled = inspectingLocalMedia || preparingAudioTrack;
    for (const track of inspectedTracks.audio) {
      const option = document.createElement('option');
      option.value = `scan:${track.index}`;
      option.textContent = inspectedTrackLabel(track, `Audio track ${track.index + 1}`);
      audioTrackSelect.appendChild(option);
    }
    const fallback = inspectedTracks.audio.find(track => track.default) || inspectedTracks.audio[0];
    const selected = inspectedTracks.audio.find(track => track.index === selectedInspectedAudio) || fallback;
    if (selected) audioTrackSelect.value = `scan:${selected.index}`;
  } else if (nativeAudioTracks.length) {
    audioTrackSelect.disabled = false;
    let selectedAudio = 0;
    nativeAudioTracks.forEach((track, index) => {
      const option = document.createElement('option');
      option.value = `native:${index}`;
      option.textContent = mediaTrackLabel(track, `Audio track ${index + 1}`);
      audioTrackSelect.appendChild(option);
      if (track.enabled) selectedAudio = index;
    });
    audioTrackSelect.value = `native:${selectedAudio}`;
  } else {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = inspectingLocalMedia ? 'Scanning audio tracks…' : 'Default audio';
    audioTrackSelect.appendChild(option);
    audioTrackSelect.disabled = true;
  }

  const allTextTracks = listTracks(localPlayer.textTracks);
  const externalIndexes = externalTextTrackIndexes();
  const generatedIndexes = generatedTextTrackIndexes();
  const nativeTextTracks = allTextTracks
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()))
    .filter(({ index }) => !inspectedTracks.subtitles.length || externalIndexes.has(index) || generatedIndexes.has(index));

  subtitleTrackSelect.replaceChildren();
  const offOption = document.createElement('option');
  offOption.value = 'off';
  offOption.textContent = 'Off';
  subtitleTrackSelect.appendChild(offOption);

  for (const track of inspectedTracks.subtitles) {
    const option = document.createElement('option');
    option.value = `scan:${track.index}`;
    option.textContent = inspectedTrackLabel(track, `Subtitle ${track.index + 1}`);
    if (['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'].includes(track.codec)) {
      option.textContent += ' — image subtitle';
      option.disabled = true;
    }
    subtitleTrackSelect.appendChild(option);
  }

  for (const { track, index } of nativeTextTracks) {
    if (generatedIndexes.has(index)) continue;
    const option = document.createElement('option');
    option.value = `text:${index}`;
    option.textContent = mediaTrackLabel(track, `Subtitle ${index + 1}`);
    subtitleTrackSelect.appendChild(option);
  }

  const availableSubtitleValues = new Set([...subtitleTrackSelect.options].map(option => option.value));
  if (!availableSubtitleValues.has(selectedSubtitleValue)) selectedSubtitleValue = 'off';
  subtitleTrackSelect.value = selectedSubtitleValue;
  subtitleTrackSelect.disabled = inspectingLocalMedia || preparingSubtitleTrack || subtitleTrackSelect.options.length <= 1;

  const audioCount = inspectedTracks.audio.length || nativeAudioTracks.length;
  const subtitleCount = inspectedTracks.subtitles.length + nativeTextTracks.filter(({ index }) => !generatedIndexes.has(index)).length;
  const audioMessage = audioCount > 1
    ? `${audioCount} audio tracks available.`
    : audioCount === 1
      ? 'One audio track available.'
      : "Using the browser's default audio track.";
  const subtitleMessage = subtitleCount
    ? `${subtitleCount} subtitle/caption track${subtitleCount === 1 ? '' : 's'} available.`
    : 'No embedded text subtitles detected; you can add SRT or VTT files.';
  const wasmMessage = inspectedTracks.audio.length > nativeAudioTracks.length
    ? 'Non-native audio is prepared locally when selected.'
    : '';
  trackSupportNote.textContent = [trackOperationMessage, audioMessage, subtitleMessage, wasmMessage].filter(Boolean).join(' ');
}

function ensureAudioRouting() {
  if (audioRoutingContext && audioRoutingGain) {
    audioRoutingContext.resume?.().catch(() => {});
    return true;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return false;
  try {
    audioRoutingContext = new AudioContextClass();
    audioRoutingSource = audioRoutingContext.createMediaElementSource(localPlayer);
    audioRoutingGain = audioRoutingContext.createGain();
    audioRoutingSource.connect(audioRoutingGain).connect(audioRoutingContext.destination);
    audioRoutingContext.resume?.().catch(() => {});
    updateAudioRouting();
    return true;
  } catch (err) {
    console.warn('Audio routing unavailable', err);
    return false;
  }
}

function updateAudioRouting() {
  if (audioRoutingGain && audioRoutingContext) {
    audioRoutingGain.gain.setValueAtTime(altAudioActive ? 0 : 1, audioRoutingContext.currentTime);
  }
  if (altAudioActive) {
    localAltAudio.volume = localPlayer.volume;
    localAltAudio.muted = localPlayer.muted;
  }
}

function syncAlternativeAudio(force = false) {
  if (!altAudioActive || !localAltAudio.src) return;
  localAltAudio.playbackRate = localPlayer.playbackRate || 1;
  localAltAudio.volume = localPlayer.volume;
  localAltAudio.muted = localPlayer.muted;
  const videoTime = Number(localPlayer.currentTime) || 0;
  const audioTime = Number(localAltAudio.currentTime) || 0;
  if (force || Math.abs(videoTime - audioTime) > 0.25) {
    try { localAltAudio.currentTime = videoTime; } catch (_) {}
  }
  if (localPlayer.paused || localPlayer.ended) {
    localAltAudio.pause();
  } else {
    localAltAudio.play().then(() => {
      altAudioPlayWarningShown = false;
    }).catch(() => {
      if (!altAudioPlayWarningShown) {
        altAudioPlayWarningShown = true;
        showToast('Tap the video once to enable the selected audio');
      }
    });
  }
}

function clearGeneratedAudio() {
  audioJobToken += 1;
  localAltAudio.pause();
  localAltAudio.removeAttribute('src');
  localAltAudio.load();
  if (generatedAudioUrl) URL.revokeObjectURL(generatedAudioUrl);
  generatedAudioUrl = '';
  altAudioActive = false;
  altAudioPlayWarningShown = false;
  updateAudioRouting();
}

function clearGeneratedEmbeddedSubtitle(cancelJob = true) {
  if (cancelJob) subtitleJobToken += 1;
  for (const el of localPlayer.querySelectorAll('track[data-generated-embedded-subtitle="true"]')) el.remove();
  if (generatedEmbeddedSubtitleUrl) URL.revokeObjectURL(generatedEmbeddedSubtitleUrl);
  generatedEmbeddedSubtitleUrl = '';
}

function canUseNativeInspectedAudio(track) {
  const nativeAudioTracks = listTracks(localPlayer.audioTracks);
  if (nativeAudioTracks.length < 2 || nativeAudioTracks.length !== inspectedTracks.audio.length) return -1;
  return inspectedTracks.audio.findIndex(candidate => candidate.index === track.index);
}

function audioOutputPlan(track, token) {
  const baseArgs = ['-y', '-i', ffmpegInputPath, '-map', `0:${track.index}`, '-vn', '-sn', '-dn'];
  if (track.codec === 'aac') return { output: `/audio-${token}.m4a`, mime: 'audio/mp4', args: [...baseArgs, '-c:a', 'copy', '-f', 'ipod'] };
  if (track.codec === 'mp3') return { output: `/audio-${token}.mp3`, mime: 'audio/mpeg', args: [...baseArgs, '-c:a', 'copy', '-f', 'mp3'] };
  if (track.codec === 'opus') return { output: `/audio-${token}.webm`, mime: 'audio/webm', args: [...baseArgs, '-c:a', 'copy', '-f', 'webm'] };
  if (track.codec === 'vorbis') return { output: `/audio-${token}.ogg`, mime: 'audio/ogg', args: [...baseArgs, '-c:a', 'copy', '-f', 'ogg'] };
  return { output: `/audio-${token}.m4a`, mime: 'audio/mp4', args: [...baseArgs, '-c:a', 'aac', '-b:a', '192k', '-f', 'ipod'] };
}

async function activateInspectedAudio(track) {
  const nativeIndex = canUseNativeInspectedAudio(track);
  selectedInspectedAudio = track.index;
  if (nativeIndex >= 0) {
    clearGeneratedAudio();
    listTracks(localPlayer.audioTracks).forEach((nativeTrack, index) => {
      try { nativeTrack.enabled = index === nativeIndex; } catch (_) {}
    });
    trackOperationMessage = '';
    refreshTrackControls();
    return;
  }

  ensureAudioRouting();
  const token = ++audioJobToken;
  const languageName = displayLanguage(track.language) || track.title || `audio track ${track.index + 1}`;
  preparingAudioTrack = true;
  trackOperationMessage = `Preparing ${languageName} locally…`;
  refreshTrackControls();

  try {
    await enqueueFfmpegTask(async () => {
      if (!currentLocalFile) throw new Error('No local file selected');
      if (!ffmpegMounted || !ffmpegInputPath) await mountLocalFileForFfmpeg(currentLocalFile);
      const ffmpeg = await ensureFfmpegClient();
      const plan = audioOutputPlan(track, token);
      const code = await ffmpeg.exec(plan.args);
      if (Number(code) !== 0) throw new Error(`Audio extraction exited with code ${code}`);
      const bytes = await ffmpeg.readFile(plan.output);
      try { await ffmpeg.deleteFile(plan.output); } catch (_) {}
      if (token !== audioJobToken) return;
      const blob = new Blob([bytes], { type: plan.mime });
      if (generatedAudioUrl) URL.revokeObjectURL(generatedAudioUrl);
      generatedAudioUrl = URL.createObjectURL(blob);
      localAltAudio.src = generatedAudioUrl;
      localAltAudio.load();
      altAudioActive = true;
      updateAudioRouting();
      syncAlternativeAudio(true);
    });
    if (token !== audioJobToken) return;
    trackOperationMessage = `${languageName} is playing locally.`;
  } catch (err) {
    console.error('Audio track preparation failed', err);
    if (token === audioJobToken) {
      clearGeneratedAudio();
      selectedInspectedAudio = (inspectedTracks.audio.find(candidate => candidate.default) || inspectedTracks.audio[0])?.index ?? null;
      trackOperationMessage = `Could not prepare ${languageName}; using the default audio.`;
      showToast('Could not prepare that audio track');
    }
  } finally {
    preparingAudioTrack = false;
    refreshTrackControls();
  }
}

async function selectAudioTrack(value) {
  if (String(value).startsWith('scan:')) {
    const streamIndex = Number(String(value).slice(5));
    const track = inspectedTracks.audio.find(candidate => candidate.index === streamIndex);
    if (track) await activateInspectedAudio(track);
    return;
  }

  if (String(value).startsWith('native:')) {
    clearGeneratedAudio();
    const audioTracks = listTracks(localPlayer.audioTracks);
    const selected = Math.max(0, Math.min(Number(String(value).slice(7)) || 0, audioTracks.length - 1));
    audioTracks.forEach((track, i) => {
      try { track.enabled = i === selected; } catch (_) {}
    });
    refreshTrackControls();
  }
}

function disableAllTextTracks() {
  listTracks(localPlayer.textTracks).forEach(track => {
    if (!['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase())) return;
    try { track.mode = 'disabled'; } catch (_) {}
  });
}

function subtitleCodecIsText(codec) {
  return !['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'].includes(String(codec || '').toLowerCase());
}

async function activateInspectedSubtitle(track) {
  if (!subtitleCodecIsText(track.codec)) return showToast('This image-based subtitle cannot be converted to browser text');
  selectedSubtitleValue = `scan:${track.index}`;
  disableAllTextTracks();
  const token = ++subtitleJobToken;
  const languageName = displayLanguage(track.language) || track.title || `subtitle ${track.index + 1}`;
  preparingSubtitleTrack = true;
  trackOperationMessage = `Preparing ${languageName} subtitles locally…`;
  refreshTrackControls();

  try {
    await enqueueFfmpegTask(async () => {
      if (!currentLocalFile) throw new Error('No local file selected');
      if (!ffmpegMounted || !ffmpegInputPath) await mountLocalFileForFfmpeg(currentLocalFile);
      const ffmpeg = await ensureFfmpegClient();
      const output = `/subtitle-${token}.vtt`;
      const code = await ffmpeg.exec(['-y', '-i', ffmpegInputPath, '-map', `0:${track.index}`, '-c:s', 'webvtt', output]);
      if (Number(code) !== 0) throw new Error(`Subtitle extraction exited with code ${code}`);
      const bytes = await ffmpeg.readFile(output);
      try { await ffmpeg.deleteFile(output); } catch (_) {}
      if (token !== subtitleJobToken) return;
      clearGeneratedEmbeddedSubtitle(false);
      const text = new TextDecoder().decode(bytes);
      generatedEmbeddedSubtitleUrl = URL.createObjectURL(new Blob([text], { type: 'text/vtt;charset=utf-8' }));
      const trackElement = document.createElement('track');
      trackElement.kind = 'subtitles';
      trackElement.label = languageName;
      if (track.language) trackElement.srclang = track.language;
      trackElement.src = generatedEmbeddedSubtitleUrl;
      trackElement.dataset.generatedEmbeddedSubtitle = 'true';
      localPlayer.appendChild(trackElement);
      try { trackElement.track.mode = 'showing'; } catch (_) {}
    });
    if (token !== subtitleJobToken) return;
    trackOperationMessage = `${languageName} subtitles enabled.`;
  } catch (err) {
    console.error('Embedded subtitle preparation failed', err);
    if (token === subtitleJobToken) {
      selectedSubtitleValue = 'off';
      trackOperationMessage = `Could not prepare ${languageName} subtitles.`;
      showToast('Could not prepare that subtitle track');
    }
  } finally {
    preparingSubtitleTrack = false;
    refreshTrackControls();
  }
}

async function selectSubtitleTrack(value) {
  const selectedValue = String(value || 'off');
  if (selectedValue === 'off') {
    selectedSubtitleValue = 'off';
    disableAllTextTracks();
    trackOperationMessage = '';
    refreshTrackControls();
    return;
  }

  if (selectedValue.startsWith('scan:')) {
    const streamIndex = Number(selectedValue.slice(5));
    const track = inspectedTracks.subtitles.find(candidate => candidate.index === streamIndex);
    if (track) await activateInspectedSubtitle(track);
    return;
  }

  if (selectedValue.startsWith('text:')) {
    const selected = Number(selectedValue.slice(5));
    selectedSubtitleValue = selectedValue;
    listTracks(localPlayer.textTracks).forEach((track, i) => {
      if (!['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase())) return;
      try { track.mode = i === selected ? 'showing' : 'disabled'; } catch (_) {}
    });
    trackOperationMessage = '';
    refreshTrackControls();
  }
}

function inferSubtitleLanguage(filename) {
  const stem = String(filename || '').replace(/\.(srt|vtt)$/i, '');
  const match = stem.match(/(?:^|[._ -])([a-z]{2,3}(?:-[A-Za-z]{2})?)$/i);
  return match ? match[1].toLowerCase() : '';
}

function srtToVtt(input) {
  let text = String(input || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  text = text.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${text}\n`;
}

function clearExternalSubtitles() {
  for (const track of localPlayer.querySelectorAll('track[data-external-subtitle="true"]')) track.remove();
  for (const url of externalSubtitleUrls) URL.revokeObjectURL(url);
  externalSubtitleUrls = [];
  subtitleFile.value = '';
}

async function addExternalSubtitles(files) {
  const selectedFiles = [...(files || [])];
  if (!selectedFiles.length) return;

  let firstAddedTrack = null;
  for (const file of selectedFiles) {
    if (!/\.(srt|vtt)$/i.test(file.name || '')) {
      showToast(`Skipped unsupported subtitle: ${file.name || 'file'}`);
      continue;
    }

    try {
      const sourceText = await file.text();
      const isSrt = /\.srt$/i.test(file.name || '');
      const subtitleText = isSrt ? srtToVtt(sourceText) : sourceText;
      const blob = new Blob([subtitleText], { type: 'text/vtt;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      externalSubtitleUrls.push(url);

      const trackElement = document.createElement('track');
      trackElement.kind = 'subtitles';
      trackElement.label = file.name.replace(/\.(srt|vtt)$/i, '');
      const language = inferSubtitleLanguage(file.name);
      if (language) trackElement.srclang = language;
      trackElement.src = url;
      trackElement.dataset.externalSubtitle = 'true';
      localPlayer.appendChild(trackElement);
      try { trackElement.track.mode = 'disabled'; } catch (_) {}
      if (!firstAddedTrack) firstAddedTrack = trackElement.track;
    } catch (err) {
      console.error('Subtitle load failed', file.name, err);
      showToast(`Could not load ${file.name || 'subtitle'}`);
    }
  }

  refreshTrackControls();
  if (firstAddedTrack) {
    const textTracks = listTracks(localPlayer.textTracks);
    const firstIndex = textTracks.findIndex(track => track === firstAddedTrack);
    if (firstIndex >= 0) selectSubtitleTrack(`text:${firstIndex}`);
    showToast(`${selectedFiles.length === 1 ? 'Subtitle' : 'Subtitles'} added`);
  }
}

audioTrackSelect.addEventListener('change', () => selectAudioTrack(audioTrackSelect.value));
subtitleTrackSelect.addEventListener('change', () => selectSubtitleTrack(subtitleTrackSelect.value));
subtitleFile.addEventListener('change', () => addExternalSubtitles(subtitleFile.files));

for (const trackList of [localPlayer.textTracks, localPlayer.audioTracks]) {
  if (!trackList?.addEventListener) continue;
  trackList.addEventListener('addtrack', refreshTrackControls);
  trackList.addEventListener('removetrack', refreshTrackControls);
  trackList.addEventListener('change', refreshTrackControls);
}

localPlayer.addEventListener('play', () => {
  audioRoutingContext?.resume?.().catch(() => {});
  syncAlternativeAudio(true);
});
localPlayer.addEventListener('playing', () => syncAlternativeAudio(true));
localPlayer.addEventListener('pause', () => { if (altAudioActive) localAltAudio.pause(); });
localPlayer.addEventListener('ended', () => { if (altAudioActive) localAltAudio.pause(); });
localPlayer.addEventListener('waiting', () => { if (altAudioActive) localAltAudio.pause(); });
localPlayer.addEventListener('seeking', () => syncAlternativeAudio(true));
localPlayer.addEventListener('seeked', () => syncAlternativeAudio(true));
localPlayer.addEventListener('ratechange', () => syncAlternativeAudio(false));
localPlayer.addEventListener('volumechange', updateAudioRouting);
localPlayer.addEventListener('timeupdate', () => syncAlternativeAudio(false));
localAltAudio.addEventListener('loadedmetadata', () => syncAlternativeAudio(true));

function attachLocalFile(file) {
  if (!file) return;
  inspectionJobToken += 1;
  if ((inspectingLocalMedia || preparingAudioTrack || preparingSubtitleTrack) && ffmpegClient?.worker) {
    ffmpegClient.terminate();
    ffmpegMounted = false;
    ffmpegInputPath = '';
  }
  if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  clearGeneratedAudio();
  clearGeneratedEmbeddedSubtitle();
  clearExternalSubtitles();
  inspectedTracks = { key: '', audio: [], subtitles: [] };
  selectedInspectedAudio = null;
  selectedSubtitleValue = 'off';
  trackOperationMessage = '';
  currentLocalFile = file;
  currentLocalMeta = fileMeta(file);
  localReady = false;
  localObjectUrl = URL.createObjectURL(file);
  localPlayer.src = localObjectUrl;
  localPlayer.load();
  refreshTrackControls();
  inspectLocalTracks(file);
}

function activateSource(source) {
  if (!source || !['youtube', 'local'].includes(source.type)) return;
  const nextKey = mediaKey(source);
  const changed = nextKey !== activeMediaKey;
  activeSource = source;
  activeMediaKey = nextKey;

  if (source.type === 'youtube') {
    clearGeneratedAudio();
    localPlayer.pause();
    localPlayer.classList.add('hidden');
    youtubeSurface.classList.remove('hidden');
    setEmptyState('Loading YouTube…', 'The room is switching to the shared YouTube video.', !youtubeReady);
    if (youtubeReady) {
      setEmptyState('', '', false);
      cueYoutube(source.videoId);
    }
  } else {
    if (youtubeReady && player?.pauseVideo) {
      try { player.pauseVideo(); } catch (_) {}
    }
    youtubeSurface.classList.add('hidden');

    if (currentLocalFile && localFileMatches(currentLocalFile, source.file)) {
      localPlayer.classList.remove('hidden');
      setEmptyState('', '', false);
      if (!localPlayer.src) attachLocalFile(currentLocalFile);
    } else {
      localReady = false;
      localPlayer.pause();
      localPlayer.classList.add('hidden');
      setEmptyState(
        `Select “${source.file?.name || 'the same video'}”`,
        'This local file stays on your computer. Choose the matching file above to join synchronized playback.',
        true
      );
    }
  }

  refreshTrackControls();

  if (changed) {
    lastKnownState = 'paused';
    lastTime = 0;
  }
}

localPlayer.addEventListener('loadedmetadata', () => {
  localReady = true;
  refreshTrackControls();
  setTimeout(refreshTrackControls, 250);
  if (activeSource?.type === 'local' && currentLocalFile && localFileMatches(currentLocalFile, activeSource.file)) {
    localPlayer.classList.remove('hidden');
    setEmptyState('', '', false);
    tryApplyRoomState();
  }
});

localPlayer.addEventListener('error', () => {
  localReady = false;
  if (activeSource?.type === 'local') {
    setEmptyState('This video cannot be played', 'Try MP4 (H.264/AAC) or WebM, depending on your browser.', true);
    showToast('Browser cannot play this video format');
  }
});

function activePlayerReady() {
  if (!activeSource) return false;
  if (activeSource.type === 'youtube') return youtubeReady && loadedYoutubeId === activeSource.videoId;
  return localReady && currentLocalFile && localFileMatches(currentLocalFile, activeSource.file);
}

function getPlaybackState() {
  if (!activePlayerReady()) return 'paused';
  if (activeSource.type === 'youtube') {
    const state = player.getPlayerState();
    return state === YT.PlayerState.PLAYING ? 'playing' : 'paused';
  }
  return !localPlayer.paused && !localPlayer.ended ? 'playing' : 'paused';
}

function getCurrentTime() {
  if (!activePlayerReady()) return 0;
  if (activeSource.type === 'youtube') return player.getCurrentTime() || 0;
  return Number.isFinite(localPlayer.currentTime) ? localPlayer.currentTime : 0;
}

function seekActivePlayer(time) {
  const t = Math.max(0, Number(time) || 0);
  if (activeSource.type === 'youtube') player.seekTo(t, true);
  else localPlayer.currentTime = Math.min(t, Number.isFinite(localPlayer.duration) ? localPlayer.duration : t);
}

function playActivePlayer() {
  if (activeSource.type === 'youtube') {
    player.playVideo();
  } else {
    localPlayer.play().catch(() => showToast('Tap play once to allow video playback'));
  }
}

function pauseActivePlayer() {
  if (activeSource.type === 'youtube') player.pauseVideo();
  else localPlayer.pause();
}

function applyRoomState(state) {
  if (!state || !state.source) return;
  pendingRoomState = state;
  if (mediaKey(state.source) !== activeMediaKey) activateSource(state.source);
  tryApplyRoomState();
}

function tryApplyRoomState() {
  const state = pendingRoomState;
  if (!state || !state.source) return;
  if (mediaKey(state.source) !== activeMediaKey) activateSource(state.source);
  if (!activePlayerReady()) return;

  applyingRemote = true;
  seekActivePlayer(state.currentTime || 0);
  if (state.state === 'playing') playActivePlayer(); else pauseActivePlayer();
  setTimeout(() => {
    applyingRemote = false;
    lastKnownState = getPlaybackState();
    lastTime = getCurrentTime();
  }, 400);
}

function applyRemoteAction({ action, currentTime, mediaKey: incomingKey }) {
  if (!activePlayerReady()) return;
  if (incomingKey && incomingKey !== activeMediaKey) return;
  applyingRemote = true;
  if (Math.abs(getCurrentTime() - currentTime) > 0.8 || action === 'seek') seekActivePlayer(currentTime);
  if (action === 'play') playActivePlayer();
  if (action === 'pause') pauseActivePlayer();
  setTimeout(() => {
    applyingRemote = false;
    lastKnownState = getPlaybackState();
    lastTime = getCurrentTime();
  }, 350);
}

function startPlayerPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (!activePlayerReady() || applyingRemote || !activeMediaKey || !roomId) return;
    const state = getPlaybackState();
    const t = getCurrentTime();
    if (state !== lastKnownState) {
      sendAction('player-action', { action: state === 'playing' ? 'play' : 'pause', currentTime: t, mediaKey: activeMediaKey });
      lastKnownState = state;
      lastTime = t;
      return;
    }
    const expectedDelta = state === 'playing' ? 0.25 : 0;
    const actualDelta = t - lastTime;
    if (Math.abs(actualDelta - expectedDelta) > 1.5) {
      sendAction('player-action', { action: 'seek', currentTime: t, mediaKey: activeMediaKey });
    }
    lastTime = t;
  }, 250);
}

window.addEventListener('beforeunload', () => {
  if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  if (generatedAudioUrl) URL.revokeObjectURL(generatedAudioUrl);
  if (generatedEmbeddedSubtitleUrl) URL.revokeObjectURL(generatedEmbeddedSubtitleUrl);
  if (ffmpegWorkerBlobUrl) URL.revokeObjectURL(ffmpegWorkerBlobUrl);
  if (ffmpegCoreBlobUrl) URL.revokeObjectURL(ffmpegCoreBlobUrl);
  if (ffmpegWasmBlobUrl) URL.revokeObjectURL(ffmpegWasmBlobUrl);
  try { ffmpegClient?.terminate(); } catch (_) {}
  try { audioRoutingContext?.close?.(); } catch (_) {}
  for (const url of externalSubtitleUrls) URL.revokeObjectURL(url);
  if (voiceJoined) {
    navigator.sendBeacon('/api/action', new Blob([JSON.stringify({
      type: 'voice-status', roomId, name: displayName, clientId, active: false
    })], { type: 'application/json' }));
  }
});

startPlayerPolling();

const params = new URLSearchParams(location.search);
const presetRoom = params.get('room');
const presetName = params.get('name') || localStorage.getItem('syncnest-name') || '';
nameInput.value = presetName;
if (presetRoom) {
  roomInput.value = presetRoom;
  if (!nameInput.value) nameInput.value = `Guest-${Math.floor(10+Math.random()*90)}`;
  enterRoom(presetRoom, nameInput.value);
}

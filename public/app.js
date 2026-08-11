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

function refreshTrackControls() {
  const localIsActive = activeSource?.type === 'local' && Boolean(currentLocalFile);
  localTrackControls.classList.toggle('hidden', !localIsActive);
  if (!localIsActive) return;

  const audioTracks = listTracks(localPlayer.audioTracks);
  audioTrackSelect.replaceChildren();

  if (audioTracks.length) {
    audioTrackSelect.disabled = false;
    let selectedAudio = 0;
    audioTracks.forEach((track, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = mediaTrackLabel(track, `Audio track ${index + 1}`);
      audioTrackSelect.appendChild(option);
      if (track.enabled) selectedAudio = index;
    });
    audioTrackSelect.value = String(selectedAudio);
  } else {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'Default audio';
    audioTrackSelect.appendChild(option);
    audioTrackSelect.disabled = true;
  }

  const textTracks = listTracks(localPlayer.textTracks)
    .map((track, index) => ({ track, index }))
    .filter(({ track }) => ['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase()));

  subtitleTrackSelect.replaceChildren();
  const offOption = document.createElement('option');
  offOption.value = 'off';
  offOption.textContent = 'Off';
  subtitleTrackSelect.appendChild(offOption);

  let selectedSubtitle = 'off';
  for (const { track, index } of textTracks) {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = mediaTrackLabel(track, `Subtitle ${index + 1}`);
    subtitleTrackSelect.appendChild(option);
    if (track.mode === 'showing') selectedSubtitle = String(index);
  }
  subtitleTrackSelect.value = selectedSubtitle;
  subtitleTrackSelect.disabled = textTracks.length === 0;

  const audioMessage = audioTracks.length > 1
    ? `${audioTracks.length} audio tracks detected.`
    : audioTracks.length === 1
      ? 'One audio track detected.'
      : "Using the browser's default audio track.";
  const subtitleMessage = textTracks.length
    ? `${textTracks.length} subtitle/caption track${textTracks.length === 1 ? '' : 's'} available.`
    : 'No embedded subtitles detected; you can add SRT or VTT files.';
  trackSupportNote.textContent = `${audioMessage} ${subtitleMessage}`;
}

function selectAudioTrack(index) {
  const audioTracks = listTracks(localPlayer.audioTracks);
  if (!audioTracks.length) return;
  const selected = Math.max(0, Math.min(Number(index) || 0, audioTracks.length - 1));
  audioTracks.forEach((track, i) => {
    try { track.enabled = i === selected; } catch (_) {}
  });
  refreshTrackControls();
}

function selectSubtitleTrack(index) {
  const textTracks = listTracks(localPlayer.textTracks);
  const selected = index === 'off' ? -1 : Number(index);
  textTracks.forEach((track, i) => {
    if (!['subtitles', 'captions'].includes(String(track.kind || '').toLowerCase())) return;
    try { track.mode = i === selected ? 'showing' : 'disabled'; } catch (_) {}
  });
  refreshTrackControls();
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
    if (firstIndex >= 0) selectSubtitleTrack(String(firstIndex));
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

function attachLocalFile(file) {
  if (!file) return;
  if (localObjectUrl) URL.revokeObjectURL(localObjectUrl);
  clearExternalSubtitles();
  currentLocalFile = file;
  currentLocalMeta = fileMeta(file);
  localReady = false;
  localObjectUrl = URL.createObjectURL(file);
  localPlayer.src = localObjectUrl;
  localPlayer.load();
  refreshTrackControls();
}

function activateSource(source) {
  if (!source || !['youtube', 'local'].includes(source.type)) return;
  const nextKey = mediaKey(source);
  const changed = nextKey !== activeMediaKey;
  activeSource = source;
  activeMediaKey = nextKey;

  if (source.type === 'youtube') {
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

# SyncNest — synchronized YouTube + local video watch party + voice call

A dependency-free Node.js server with a browser client for watching YouTube or the same local video file together and talking through a built-in WebRTC voice room.

## What it does
- Private room codes + shareable invite links
- YouTube URL playback
- Local computer video playback with a native HTML5 video player
- VLC-style local track controls for audio-language and subtitle selection
- Local MKV stream inspection with FFmpeg WebAssembly when the browser does not expose embedded tracks
- Load external `.srt` or `.vtt` subtitle files directly in the browser
- Synchronized play, pause and seeking for both source types
- Late joiners jump to the current room position
- Built-in peer-to-peer voice call
- Join voice, mute/unmute and leave call controls
- Online + in-voice participant indicators
- Responsive layout
- No database or npm packages required on the Node.js server

## How local video works
Local video files are **not uploaded to the SyncNest server**. When one person chooses a local video, the room shares only basic file metadata (name and size) plus playback state.

Each participant must choose the same local video file on their own computer. Once the filename and file size match, SyncNest synchronizes play, pause and seeking.

This avoids uploading very large movie files and keeps the video on each person's device. Browser codec support still applies; MP4 with H.264/AAC and WebM are the safest choices. MKV support varies by browser and codec.

### Audio languages and subtitles
For normal browser-supported files, SyncNest still uses the browser's native audio/text track APIs. For `.mkv` files, SyncNest additionally starts a **local FFmpeg WebAssembly scan** and reads the embedded stream metadata directly from the file. The movie bytes are not uploaded to the SyncNest server.

After the scan, **Audio language** can show tracks such as English, Hindi and Tamil even when `HTMLMediaElement.audioTracks` is empty. If the browser exposes all of those tracks natively, switching remains instant. Otherwise, when the viewer explicitly chooses a track, SyncNest locally remuxes browser-friendly audio (AAC/MP3/Opus/Vorbis) or transcodes other audio codecs to AAC, then plays that companion audio in sync with the local video. This preference remains local to that viewer; only play/pause/seek are synchronized with the room.

Embedded text subtitles are also listed from the MKV scan. When selected, SyncNest converts/extracts a compatible embedded subtitle stream to WebVTT locally and attaches it to the video. Image-based subtitle formats such as PGS/DVD/DVB subtitles are shown as image subtitles but are disabled because they cannot be represented as normal browser WebVTT text without an OCR/rendering pipeline.

You can also load one or more external `.srt` or `.vtt` subtitle files. SRT files are converted to WebVTT in the browser and are never uploaded. The first subtitle file you add is enabled automatically; use **Subtitles → Off** to hide it or select another track.

The FFmpeg browser engine is downloaded on demand from jsDelivr the first time an MKV needs inspection (the core is roughly 30 MB). Preparing a non-native full-length audio track can use noticeable CPU and memory, especially for large movies or codecs that require AAC transcoding. Native browser track switching is preferred automatically when available.

## Run it
Requires Node.js 18 or newer.

```bash
npm start
```

or simply:

```bash
node server.js
```

Open `http://localhost:3000`.

## Use it with friends in different cities
Deploy this folder to a hosting service that supports a persistent Node.js process and **HTTPS**. Set the start command to `node server.js`. Then create a room and share its invite URL.

For YouTube, one person loads a link and everyone receives it automatically. For local video, each person chooses the same file on their own computer.

Microphone access works on `localhost` during development, but browsers require HTTPS for microphone/WebRTC access on a public deployment.

## How voice works
- Audio is peer-to-peer via WebRTC; the SyncNest server relays only signaling data needed to connect browsers.
- The app uses public Google STUN servers for NAT discovery.
- Some restrictive mobile, corporate, carrier-grade NAT or firewall setups require a **TURN server**.
- This implementation is a mesh call, so it is best for small rooms (roughly 2–5 people). Larger rooms should use an SFU such as LiveKit, mediasoup or Janus.

## TURN configuration
Voice calling reads ICE configuration from the server. It always includes Google STUN and can add a TURN relay when these environment variables are present:

- `TURN_URLS` — comma-separated TURN URLs from your TURN provider
- `TURN_USERNAME` — TURN username
- `TURN_CREDENTIAL` — TURN password/credential

If TURN variables are absent, the app still uses STUN-only WebRTC.

## Notes
- The YouTube mode uses the official YouTube iframe player. Each video must allow embedding and be viewable by every participant in their location/account.
- Modern browsers can restrict autoplay. A late joiner may need to click play once.
- Room state lives in server memory. Restarting the server clears room state.
- Local file bytes never pass through the Node.js server in this version. MKV inspection and fallback track preparation happen in the viewer's browser.
- MKV inspection requires network access to the pinned jsDelivr FFmpeg WebAssembly assets unless you self-host those assets and update the three FFmpeg URLs in `public/app.js`.
- For public use, add login, moderation, rate limiting, persistence, abuse protection and production TURN/SFU infrastructure.

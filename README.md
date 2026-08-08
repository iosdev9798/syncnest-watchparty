# SyncNest — synchronized YouTube watch party + voice call

A dependency-free Node.js website for watching YouTube together from different locations and talking through a built-in WebRTC voice room.

## What it does
- Private room codes + shareable invite links
- YouTube URL input
- Synchronized play, pause and seeking
- Late joiners jump to the current room position
- Built-in peer-to-peer voice call
- Join voice, mute/unmute and leave call controls
- Online + in-voice participant indicators
- Responsive layout
- No database or npm packages required

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
Deploy this folder to a hosting service that supports a persistent Node.js process and **HTTPS**. Set the start command to `node server.js`. Then create a room, share its invite URL, and each person clicks **Join voice**.

Microphone access works on `localhost` during development, but browsers require HTTPS for microphone/WebRTC access on a public deployment.

## How voice works
- Audio is peer-to-peer via WebRTC; the SyncNest server relays only signaling data needed to connect browsers.
- The sample uses public Google STUN servers for NAT discovery.
- For a small private call, this often works without extra infrastructure.
- Some restrictive mobile, corporate, carrier-grade NAT or firewall setups require a **TURN server**. For production reliability, configure a TURN service and add it to `rtcConfig` in `public/app.js`.
- This implementation is a mesh call, so it is best for small rooms (roughly 2–5 people). Larger rooms should use an SFU such as LiveKit, mediasoup or Janus.

## Notes
- The app uses the official YouTube iframe player. Each video must allow embedding and be viewable by every participant in their location/account.
- Modern browsers can restrict autoplay. A late joiner may need to click play once.
- Room state lives in server memory. Restarting the server clears room state.
- For public use, add login, moderation, rate limiting, persistence, abuse protection and production TURN/SFU infrastructure.
- Use your own name/branding rather than copying another service's trademark or exact visual identity.


## Voice calling demo (STUN + TURN)

Voice calling now reads ICE configuration from the server. It always includes Google STUN and can add a TURN relay when these Render environment variables are present:

- `TURN_URLS` — comma-separated TURN URLs from your TURN provider
- `TURN_USERNAME` — TURN username
- `TURN_CREDENTIAL` — TURN password/credential

For a one-day demo, Metered's Open Relay currently offers a free TURN tier (20 GB/month) and no credit card is required to start. Create an account, copy the TURN credentials/URLs from its dashboard, then add the three variables above in Render. Render keeps environment variables out of your source code and can redeploy after saving them.

If TURN variables are absent, the app still works with STUN-only WebRTC.

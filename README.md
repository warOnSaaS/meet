# wOS Meetings

Video meetings for small teams. Start a call, send the link, talk. Guests join from a browser with no account.

- **Small calls go straight between people.** Up to 4 people connect directly to each other. No server carries the call.
- **Bigger calls are carried by a computer in the call.** Someone on the desktop app or the command line turns on "Help carry this call", and their computer forwards the call for everyone. The call is encrypted end to end, so that computer cannot see or hear it.
- **Or a media server, when you have one.** Point it at LiveKit and the biggest calls go there.
- **Free to host yourself.** One command on your own server. AGPL-3.0.

Part of [wOS](https://github.com/warOnSaaS/suite), the suite of apps from warOnSaaS. It runs on its own today, and the suite loads the same files later.

## Use it

Hosted: https://meet.waronsaas.com (sign in with GitHub to start a meeting; anyone with a link can join).

Host it yourself, free:

```sh
git clone https://github.com/warOnSaaS/meet && cd meet
cp .env.example .env            # set SESSION_SECRET and DOMAIN
docker compose up -d            # the app, Postgres and HTTPS
```

Or without Docker: `npm install && npm start` (Node 22 or newer). It uses SQLite in `./data` until you set `DATABASE_URL` to any Postgres. Database updates apply themselves when it starts. See [docs/SELF-HOSTING.md](docs/SELF-HOSTING.md).

## What it does

| | |
|---|---|
| Meetings | Start now, schedule for later (with a calendar invite), join by link. Guests need no account. |
| In the call | Grid and speaker views, screen share, mute, camera, chat, raise hand. |
| Host controls | Waiting room, let in or turn away, mute someone or everyone, make co-hosts, ask someone to share, remove, lock, end for everyone. |
| Agents | Every button is also a tool an agent can call, over MCP at `/mcp` or REST at `/api/tools/<name>`. A person still has to allow the camera and choose what screen to share. |
| Other apps | `meet.huddle` opens (or finds) the live room for a record, such as a Chat channel, with no waiting room. Chat huddles use it. |
| Export | `meet.export` gives you every meeting you host, who joined and the chat, as JSON. |
| Check | `meet doctor` (and the `meet.doctor` tool) checks UDP, TLS, TURN and the media server, and says what to fix. |
| Recording | Off. It is not built yet, and when it is, it will only start after everyone in the call is told and agrees. |

## How a call is carried

Each call picks the first way that fits. The server works it out again whenever someone joins or leaves, and tells every browser.

| Way | When | What it needs |
|---|---|---|
| Direct | Up to 4 people (`P2P_MAX`) | Nothing. Public STUN servers find each browser's address. A TURN relay (`TURN_URLS`) helps people behind strict firewalls; without one, they see a plain message saying a firewall blocks the call. |
| Computers in the call | More than 4, and someone runs `npx github:warOnSaaS/meet host "<link>"` (or the desktop app) | Node 22, a computer that is plugged in, with good upload and steady connection. See [docs/DESKTOP-HOST.md](docs/DESKTOP-HOST.md). |
| Media server | You set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` | LiveKit (`docker compose --profile meetings up -d`, or LiveKit Cloud). |
| Full | None of the above | The first 4 talk; anyone else sees why they are waiting and what would fix it. |

Signalling (how browsers find each other) goes through this app's own server: a WebSocket where the server runs all the time, and long-polling where it cannot (Vercel). Media never passes through the app's server.

### Computers carrying a call

| Rule | How |
|---|---|
| Who carries | Measured upload, CPU load, power (on battery is never chosen), and how steady the connection is over a one minute warm-up. |
| How many | Enough that the combined room is 1.2 times the people in the call; at least two when two are offered, so everyone has a standby. |
| Several computers | Linked to each other directly (mediasoup pipe transports over encrypted RTP). Up to 5 link in a full mesh; more form a star, so a speaker reaches any listener in at most 2 hops between computers. A computer too far from the others (slow round trip) is left out. |
| What crosses between them | Only streams someone on the other side is watching, at the size they watch it. |
| Video sizes | Each camera sends three sizes (simulcast). The person talking is shown large; the rest small. Audio from everyone in calls up to 12; in bigger calls, from the 6 most recent speakers. |
| A computer leaving | Every person keeps a warm standby connection to a second computer, already connected and encrypted. If their computer stops answering for 3 seconds, they switch. A computer that is shutting down hands its people over first. |
| Privacy | Browsers encrypt every audio and video frame with a key only the people in the meeting have (WebRTC encoded transforms, AES-GCM). The computers forward frames they cannot read. |

## Tools

38 tools (`tools.json`, in the suite's format). The planned recording, transcript, notes and agent tools are listed so agents know they are coming; calling one says it is not built yet. `meet.start_recording` needs a person's yes.

## Development

```sh
npm install
npm run dev                   # http://localhost:8787, with a /auth/dev sign-in for testing
npm test                      # unit tests: planner, every tool over REST and MCP
npm run test:e2e              # real calls in Chromium with fake cameras, and the parity check
npm run shots                 # screenshots at 1440 and 390, light and dark, into .shots/
npm run check                 # tools.json is current; no private names or em dashes
```

| Path | What |
|---|---|
| `server/tools/meet.mjs` | Every tool. Screens, REST and MCP call these. |
| `server/room/plan.mjs` | The planner: direct, computers in the call, media server or full. Pure function. |
| `server/room/room.mjs` | Who is connected and the signalling mailbox (in the database, so any server instance can answer). |
| `host/host.mjs` | The participant host (mediasoup). |
| `public/app/` | The screens and the three media engines (`media/p2p.mjs`, `media/sfu.mjs`, `media/livekit.mjs`). |
| `server.mjs`, `wos-app.json` | How the wOS suite loads this app. |

## Measurements

Direct calls, measured on one Mac (10 cores, 32 GB) with Chromium's fake camera and microphone, 2026-10-07:

| | WebSocket signalling | Long-polling (as on Vercel) |
|---|---|---|
| 2 people: from the guest's Join click to both seeing and hearing each other, including the 2 s waiting-room check and the host's click | 3.2 to 3.4 s | 3.2 s |
| 3 people: same, for the third person | 3.2 to 3.3 s | 3.2 s |

Against the deployed site (https://meet.waronsaas.com on Vercel, region pdx1, Neon Postgres in us-west-2), from a Mac in the eastern US, `node test/live/p2p-live.mjs`, 2026-10-07. Real: the deployed server, its database and its long-polling signalling. Not real: all three browsers ran on one Mac, so media went over loopback, not across the internet.

| | |
|---|---|
| Host in the call, from opening the home page | 2.2 s |
| Host sees a guest waiting | 1.4 s after the guest clicks Join |
| 2 people seeing and hearing each other | 4.5 s after the guest clicks Join (includes the host's click to let them in) |
| 3 people, everyone sees and hears everyone | 5.3 s after the third person clicks Join |
| A chat message reaching the others | 0.4 s |

## Licence

AGPL-3.0-only. The ui-design kit in `public/ui` is Apache-2.0. mediasoup is ISC, LiveKit's client is Apache-2.0.

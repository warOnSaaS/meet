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
| Webinars | A few speakers, many viewers. Viewers send nothing and are not asked for a camera; they raise a hand, and the host lets them speak (only then does their browser ask for the microphone and camera). Viewers see and hear speakers 1 to 3 s late, which smooths playback and leaves room for longer paths between computers; speakers talk with each other live. |
| Agents | Every button is also a tool an agent can call, over MCP at `/mcp` or REST at `/api/tools/<name>`. A person still has to allow the camera and choose what screen to share. |
| Other apps | `meet.huddle` opens (or finds) the live room for a record, such as a Chat channel, with no waiting room. Chat huddles use it. |
| Export | `meet.export` gives you every meeting you host, who joined and the chat, as JSON. |
| Check | `meet doctor` (and the `meet.doctor` tool) checks UDP, TLS, TURN and the media server, and says what to fix. |
| AI notes | Off until a host turns them on. Everyone is asked first; each person's own device writes down only their own voice (Whisper, in the browser), captions reach the others encrypted, and when the call ends a summary, decisions and action items are written and sent to the CRM, the board, Chat and email (inside wOS). See [AI notes](#ai-notes). |
| Background blur | A camera option (More, Blur my background): MediaPipe's selfie segmentation finds you in each frame on your own device and blurs the rest; the blurred picture replaces your camera in the call. About 20 ms a frame on a laptop processor; it uses the graphics chip when that is faster. |
| Whiteboard | Excalidraw for everyone in the call, merged with Yjs; every stroke goes between browsers encrypted with the meeting key. Saved to the meeting, exported as PNG or SVG, attached to a CRM record or a board task (inside wOS). A shape reaches the other screen in about a quarter of a second on long-polling. |
| Recording | Off until a host asks. Everyone is asked first, and anyone who says no is left out of the picture and the sound. One browser records the composed call (everyone's video and mixed sound) and saves it to its disk or straight to the team's S3-compatible storage. See [docs/RECORDING-CONSENT.md](docs/RECORDING-CONSENT.md). |

## How a call is carried

Each call picks the first way that fits. The server works it out again whenever someone joins or leaves, and tells every browser.

| Way | When | What it needs |
|---|---|---|
| Direct | Up to 4 people (`P2P_MAX`) | Nothing. Public STUN servers find each browser's address. A TURN relay (`TURN_URLS`) helps people behind strict firewalls; without one, they see a plain message saying a firewall blocks the call. |
| Computers in the call | More than 4, and someone runs `npx github:warOnSaaS/meet host "<link>"` (or the desktop app) | Node 22, a computer that is plugged in, with good upload and steady connection. See [docs/DESKTOP-HOST.md](docs/DESKTOP-HOST.md). |
| Media server | You set `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` | LiveKit (`docker compose --profile meetings up -d`, or LiveKit Cloud). Encrypted end to end with the meeting's key. Tested against livekit-server 1.13.8: 3 people (with `P2P_MAX=2`) seeing and hearing each other 1.8 s after the third joined. |
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
| Privacy | Browsers encrypt every audio and video frame with the meeting's key (WebRTC encoded transforms, AES-GCM), which the app's server gives only to people it admits. The computers carrying the call, and LiveKit (its own E2EE with our key), forward frames they cannot read; a test hands one browser a wrong key and checks it decrypts nothing and shows no video. The app's own server stores the key, so whoever runs that server could read a call they also capture; it never sees the media itself. Direct calls are encrypted between the two browsers by WebRTC. |

## AI notes

| | |
|---|---|
| Who writes down what | Each person's browser writes down only that person's microphone, with Whisper (MIT) running on the device through transformers.js (Apache-2.0): on the graphics chip with WebGPU (whisper-base.en, about 80 MB, downloaded once) or on the processor (whisper-tiny.en, about 40 MB). Audio never leaves the device for this. |
| When a device cannot | The browser's own speech service (Web Speech API) where Whisper cannot run; the Notes panel says so, because Chrome and Safari may send that audio to their servers. With no speech at all on the device, a helper does it: another person in the call whose device can, and who already receives that person's audio, decrypted, as part of the call. Failing that, if the team set a speech service (any OpenAI-compatible `/audio/transcriptions`, such as whisper.cpp's server), the device sends short clips of its own speech there. A desktop computer carrying the call (a participant host) is never used: it cannot hear the call, by design. |
| Captions and the timeline | Each line (speaker, start, end, text) goes to the others over the call's encrypted channel (AES-GCM with the meeting key, sealed in the browser, carried by the signalling mailbox, so the server sees ciphertext) and shows as captions; each screen merges everyone's lines into one timeline. While notes are on, lines are also kept with the meeting (`meet.add_transcript`) for the notes. |
| The notes | `meet.summarise` writes a summary, decisions and action items with the team's model (any OpenAI-compatible address, model and key, in Settings or `NOTES_MODEL_URL`, `NOTES_MODEL`, `NOTES_MODEL_KEY`). With no model set, a short script writes them and every screen labels them "Demo notes (a script, not AI)", so the public demo has no model bill. They are written by themselves when the meeting ends. |
| Where notes go (inside wOS) | `meet.notes_to_crm` (a meeting activity on the linked deal, contact or organization), `meet.notes_to_board` (one task per action item, with its owner), `meet.notes_to_chat` (a post in the channel the call started from), `meet.notes_to_email` (to the team members who joined, through the Email app's alerts). Each is optional; the host can choose them when turning notes on and they run when the meeting ends. |
| Consent | [docs/RECORDING-CONSENT.md](docs/RECORDING-CONSENT.md). |

Measured on one Mac (Apple silicon, 10 cores), headless Chromium, two people, each browser's fake microphone fed a known recording (three sentences each, text to speech made at test time; `test/e2e/notes.test.mjs`), 2026-10-07:

| | |
|---|---|
| Engine | Whisper tiny.en on the processor (WebAssembly; headless Chromium has no WebGPU) |
| Accuracy | 0 word errors in 32 (Sam) and 0 in 26 (Jordan) on the first full pass. Synthetic, clean speech: expect real microphones in real rooms to do worse. |
| Speaker labels | Every line carried the right name; neither device ever wrote down the other person's words. |
| Delay, end of speech to the caption on the other screen | 2.5 s median (2.5 to 2.7 s, 10 lines). Of that, 0.7 s is the pause that marks the end of a sentence and about 1.8 s is the model; the encrypted channel and signalling add about 0.1 s. |
| Speed | 0.45 s of work per second of speech on the processor, so one device keeps up with its own person with room to spare. |
| Start | 6 s from "Turn notes on" to listening on both devices, with the model already in the browser's cache (a first download adds the model's size over your connection). |
| Helper | With Jordan's device set to "cannot transcribe", Sam's device wrote down Jordan's lines, labelled Jordan, from the audio it already received. |
| Leaving your voice out | After Jordan chose "Leave my voice out", no Jordan lines were kept over the next 45 s, while Sam's continued. |

| Device and browser limits | |
|---|---|
| Desktop Chrome, Edge (WebGPU) | base.en on the graphics chip; fastest and most accurate. |
| Desktop Firefox, Safari | tiny.en on the processor (Safari 26 has WebGPU and uses it). Needs about 300 MB of free memory while it runs. |
| Phones | Works on recent phones on the processor, but slower and warmer, and iOS may stop the model when the browser goes to the background. Devices that report under 2 GB of memory skip Whisper and use the browser's speech service or a helper. |
| Very old browsers (no WebAssembly workers) | A helper in the call, or the team's speech service. |

## Tools

TOOL_COUNT tools (`tools.json`, in the suite's format). The planned tools are listed so agents know they are coming; calling one says it is not built yet. `meet.start_notes` and `meet.start_recording` need a person's yes when an agent asks.

## Development

```sh
npm install
npm run dev                   # http://localhost:8787, with a /auth/dev sign-in for testing
npm test                      # unit tests: planner, every tool over REST and MCP
npm run test:e2e              # real calls in Chromium with fake cameras, and the parity check
node test/load/big-call.mjs --hosts=4 --people=12 --kill   # the load test (heavy)
node test/live/p2p-live.mjs https://meet.waronsaas.com     # a real call through a deployed site
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

### Calls carried by computers in the call

Everything below ran on one Mac (Apple silicon, 10 cores, 32 GB) on 2026-10-07: the app server, every participant host (real `meet host` processes running mediasoup) and every person (a headless Chromium with a fake camera and microphone). The Mac was shared with other work at the time.

**What was simulated, and why.** Each host stated its upload speed (`--upload-mbps`), and in the load script also its CPU load (`--cpu-load=0.2`) and jitter (`--jitter-ms=3`), instead of measuring them, because all of them shared this one Mac and its loopback network: measuring would have measured the Mac, not the hosts. Media went over loopback, so there was no internet delay or loss. The traffic numbers are what the hosts really sent. Audio delay is measured from a tone switched on in the speaker's page to the moment each listener's page detects it in the received audio, on one shared clock; it leaves out the microphone and speaker hardware.

| Test | People | Hosts | Result |
|---|---|---|---|
| One host (`test/e2e/hosts.test.mjs`) | 5, then 6 | 1 | The 5th person arriving moves the call from direct to the host in 2.2 to 3.2 s. A 6th person sees and hears everyone 1.2 s after joining. Audio delay through the host: 56 to 195 ms. The host sent 5.6 Mbit/s and received 6.8 to 7.6 Mbit/s. Every frame encrypted in the browser; 0 to 8 audio frames per person failed to decrypt around the switch, out of about 1,300. |
| Two hosts, one killed with no warning | 6 | 2, linked | 3 people on each host, sending 2.3 to 3.9 Mbit/s each. After the kill, the browsers switch to their warm standby in 126 to 155 ms once they notice (they notice after 2 s of silence); every screen had all video and audio moving again 3.7 to 4.9 s after the kill (this includes 1.2 s the test spends confirming). |
| Two hosts, one leaving politely (Ctrl+C) | 6 | 2 | It handed its 3 people over and exited in 91 to 143 ms. The longest gap in new video frames on any screen: 0.4 s. |
| Star: more than 5 hosts (`test/load/big-call.mjs --hosts=7 --people=6 --upload=12`) | 6 | 6 of 7 (1 root relaying, 5 leaves) | Everyone sees and hears everyone. Audio delay 71 to 203 ms, including two hops between hosts. Killing a leaf carrying 3: all flowing again within 7.5 s. Killing the root: within 6.8 s (other hosts report it after 2 s of silence; before that fix it took 24 to 27 s). |
| Largest this Mac held (`--hosts=4 --people=12 --kill`) | 12 | 2 used of 4 | Everyone sees and hears everyone; the Mac's CPU was 96 to 99% busy, almost all of it the 12 browsers encoding and decoding video (each host sent only about 6 Mbit/s). Most people saw and heard all within 2 to 6 s of joining; at full CPU some took 15 to 34 s. Audio delay at full CPU: 0.7 to 1.2 s. Killing a host carrying 6: the other 6 people were back in about 2 s, the 6 who moved in 10 to 15 s. |
| Earlier run, same size (`--hosts=3 --people=12`) | 12 | 3, mesh | Everyone sees and hears everyone. Killing a host carrying 6: all back within 7.9 s. |

| Webinar (`test/e2e/webinar.test.mjs`) | 2 speakers, 4 viewers | 1 | Viewers connect only to speakers and send nothing through the host. Sam to Jordan (speakers): 59 to 78 ms. Sam to each viewer: 1.21 to 1.26 s (the viewers' receive buffer is set to 2 s; Chrome delivers a little less). |

What these numbers do not show: real networks (loss, jitter, NAT, distance), hosts on separate computers, and more than 12 people, which this Mac cannot run as browsers. Expect real calls to add the internet's delay to the audio numbers above. Bugs these tests found and fixed are in the commit history (for example, closing a host connection used to stop the person's own camera).

## Licence

AGPL-3.0-only. The ui-design kit in `public/ui` is Apache-2.0. mediasoup is ISC, LiveKit's client is Apache-2.0, transformers.js is Apache-2.0 and the Whisper models are MIT, Excalidraw, React and Yjs are MIT, MediaPipe is Apache-2.0.

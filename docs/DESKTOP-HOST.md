# Carrying calls from the wOS desktop app

For the suite's desktop app (Electron, ROADMAP F2). It describes how the desktop app runs the participant host, the same code as `npx github:warOnSaaS/meet host`, so a person can turn on "Help carry this call" with one switch.

## What the person sees

- In a call, under Details: **Help carry this call**. On the desktop app it is a switch; in a browser it shows the command to run instead.
- While carrying: "Your computer is helping carry this call for N people. It cannot see or hear the call." and a Stop button.
- A computer on battery is never chosen. The app says "Plug in to help carry calls."
- Nothing starts by itself. The person turns it on per call, or ticks "Always help carry my team's calls when plugged in" in Settings.

## How the app runs it

| Step | What the app does |
|---|---|
| Start | Calls `meet.add_host` for the meeting. The result's `host_url` holds a host key that is good for 12 hours and only for that meeting. |
| Run | Starts `host/host.mjs` in a Node child process (Electron's `utilityProcess.fork`), with `runHost(host_url, { desktop: true, name: '<person>\\'s computer' })`. mediasoup's worker binary ships inside the app (it is ISC licensed); no compiler is needed. |
| Ports | The host listens on one UDP and one TCP port (random in 40000 to 60000, or `--port`). The app asks the OS firewall for permission on first use (macOS shows its own prompt; only the person can click it). |
| Warm-up | For the first minute the host measures upload speed, CPU load, power and how steady its connection is, and reports every 2 s. It is not chosen until warm. |
| Chosen or not | The server decides (see "How a call is carried" in the README). The app shows the host's status from `meet.list_hosts`: ready, carrying N, or why not (on battery, upload too low, still measuring). |
| Stop | Sends SIGTERM (or calls `host.stop('leaving')`). The host asks the server to move its people to other hosts, waits for them to leave (usually under 0.2 s, at most `--drain-s`, default 4 s), then exits. |
| Quit or sleep | The same as Stop. If the computer just loses power, the people it carried notice within about 2 s and switch to their warm standby. |

## Flags the app passes

| Flag | Meaning |
|---|---|
| `--desktop` | Report the client as the desktop app. |
| `--name=<text>` | What others see in Details ("Riley's computer"). |
| `--port=<n>` | Fixed media port, for people who open one port on their router. |
| `--announce=<ip>` | The public address to give browsers, when the app knows it (for example from UPnP). |
| `--upload-mbps=<n>` | Skip the upload measurement and use this. |
| `--drain-s=<n>` | How long to wait for people to move away when stopping. |
| `--warmup=<s>` | Warm-up length (default 60). |

Test-only flags (`--assume-plugged`, `--cpu-load`, `--jitter-ms`, `--local`) exist for running many hosts on one machine; the app never passes them.

## What the host can and cannot see

Browsers encrypt every audio and video frame before it leaves (AES-GCM with a key derived from the meeting's key, which only people admitted to the meeting receive). The host gets the frames' first few bytes in the clear (what a forwarder needs to pick video layers) and nothing else. It never receives the meeting key. It does see who is in the call (peer ids and names, as every participant does) and how much each person sends.

## Resource use (measured on one Mac, see the README)

A host carrying 6 people sent about 6 Mbit/s and received about 5 to 7 Mbit/s. The mediasoup worker used little CPU next to the browsers; forwarding does not decode or re-encode video.

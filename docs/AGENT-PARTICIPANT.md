# An AI agent in the call (`meet.join_as_agent`): design

Status: designed, not built. The tool is in the catalogue and answers "not built yet" (501), so agents can see it coming.

## What it is

An agent that is a participant: it hears the call, can speak in it, can read and write the chat and the whiteboard, and appears in the people list with an "Agent" badge like anyone else. Example: "join the 3 pm call with Acme Dental, take notes, and answer questions about their open invoices".

## The approach: a bot participant on the server

Calls are encrypted end to end. Only participants hold the meeting key, and a server that is not a participant sees nothing. So the agent must be a real participant, and everyone must be able to see that it is.

| Part | How |
|---|---|
| A peer | A WebRTC peer running on a server (Node with a WebRTC stack such as `@roamhq/wrtc` or `werift`, or LiveKit's Agents framework when the call is on LiveKit). It joins like a browser: `meet.join` with `as: 'agent'`, then `/media/join`, then the same signalling and the same engine (direct, computers in the call, or LiveKit). |
| The key | It receives the meeting key only after a host approves it (below), the same way a person gets it when admitted. It decrypts frames like any browser (the AES-GCM frame transform, or LiveKit's E2EE with our key). |
| Host approval | `meet.join_as_agent` is `confirm: human`. Calling it puts the agent in the waiting room with an "Agent" badge and a line saying who sent it and what it will do. Only a host or co-host can let it in, by hand. A host can remove it at any time. |
| Shown to everyone | While it is in the call: an "Agent in the call" marker at the top of every screen (like "Notes on"), its own tile with the agent badge, and a notice to everyone when it joins. Joining also asks for notes consent if it will transcribe (same rules as notes). |
| Hearing | It transcribes the mixed audio it receives, but only the voices of people who said yes to notes (it gets each person's audio separately in the call, so it can leave out anyone who did not). |
| Speaking | Text to speech into an audio track it sends. Speaking is off unless the host allows it when letting it in. It never speaks unprompted: only when someone addresses it by name, or the host asks. |
| Acting | Its tool calls go through the suite as the person who sent it (`ctx.callAs`), with that person's scopes, audited, and `confirm: human` tools wait for that person's yes. |
| Where it runs | Self-host: a small worker next to the app (`npx meet agent <link>`), like a participant host. Hosted: a worker pool, billed by minutes in calls. |

## Why not the other ways

| Option | Why not |
|---|---|
| The app's server joins the call silently | It would need the key without anyone seeing it: that breaks the promise that only visible participants can see or hear a call. |
| A participant host (a computer carrying the call) listens | It forwards media it cannot read, by design. Giving it the key would make every carrying computer a possible listener. |
| One person's browser runs the agent | Works only while that tab is open and in the foreground, and ties the agent to one person's device and battery. Fine for notes (which is how notes work today), not for an agent that should be there on its own. |

## Tool shape when built

`meet.join_as_agent` (`confirm: human`): `{ meeting, agent (which saved agent), purpose (one line shown to everyone), listen: true, speak: false, write_notes: true }` returns `{ participant, status: 'waiting' }`. Then `meet.remove_participant` removes it, and `meet.list_participants` shows it with `kind: 'agent'`.

## Effort

About 6 to 9 agent-days: the server peer and its media engines (3 to 4), approval and visibility (1), listening with per-person consent and speaking (2 to 3), tests with fake media (1).

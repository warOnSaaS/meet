# Notes and recording: off by default, and only with each person's agreement

Founder decision F11 and ROADMAP 9.1 (R-L1). Several US states (for example California) need every party's consent, and the EU treats recordings and transcripts as personal data. This is general knowledge, not legal advice.

## AI notes (built)

| Rule | How |
|---|---|
| Off by default | Every meeting starts with notes off. Only a host or co-host can turn them on (`meet.start_notes`, `confirm: human` when an agent asks). |
| Everyone is told | Turning notes on opens a notice on every screen in the call that has to be answered before the call can be used again: who turned notes on, what is written down, and two buttons. People who join later see a line about it on the join page before they join, and the same notice in the call. Each time notes are turned on again, everyone is asked again. |
| Nobody is written down without a yes | Each person's own device writes down only that person's microphone, and only after they answer "Include my voice". Until then, and after "Leave my voice out", nothing from their microphone is transcribed or kept. The server refuses transcript lines for anyone who has not said yes (`meet.add_transcript`). A muted microphone is not transcribed. |
| Visible while on | A "Notes on" marker with a red dot sits at the top of every screen in the call, and on the Notes button. |
| Change your mind | "Leave my voice out" in the Notes panel at any time (`meet.answer_notes`). |
| Consent record | `meet_notes_consents`: who, what they answered, when the notice was shown, when they answered, and how their device transcribes. Exported with everything else (`meet.export`). Kept when the transcript is deleted, as proof of what people agreed to. |
| Delete | The host deletes the transcript and notes at any time (`meet.delete_transcript`). |
| Where the words go | Live captions go to the others in the call over the call's encrypted channel (sealed with the meeting key in the browser). The transcript is kept with the meeting on this server while notes are on, so the team gets notes. A helper (another person in the call whose device can transcribe) only writes down people who said yes and whose own device cannot. The server's speech service is used only if the team set one up and only for people who said yes. |

**Spoken notice.** The roadmap asks for a spoken notice as well. It is not played: the founder asked that nothing in Meetings ever plays a voice by itself. The on-screen notice blocks the call until it is answered instead. If a spoken notice is needed later (for a jurisdiction that requires it), it should be a recorded announcement the host chooses to play, not automatic speech.

## Recording

See the section below once recording ships. Until then `meet.start_recording` answers "not built yet".

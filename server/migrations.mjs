// Schema steps. Written once for both databases; `serial` differs, so steps can be functions of the dialect.
const serial = (d) => (d === 'postgres' ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT');

export const migrations = [
  {
    id: 1,
    name: 'meetings core',
    sql: (d) => `
CREATE TABLE IF NOT EXISTS meet_users (
  id TEXT PRIMARY KEY, github_login TEXT UNIQUE, name TEXT NOT NULL, email TEXT, avatar_url TEXT, created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY, team_id TEXT NOT NULL DEFAULT 'default', title TEXT NOT NULL, host_id TEXT,
  starts_at BIGINT, ends_at BIGINT, duration_min INTEGER, status TEXT NOT NULL DEFAULT 'scheduled',
  room_name TEXT NOT NULL, link_token TEXT NOT NULL UNIQUE, waiting_room INTEGER NOT NULL DEFAULT 1,
  locked INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL DEFAULT 'meeting', media_pref TEXT NOT NULL DEFAULT 'auto',
  e2ee_key TEXT NOT NULL, linked_record TEXT, created_at BIGINT NOT NULL, started_at BIGINT, ended_at BIGINT
);
CREATE INDEX IF NOT EXISTS meet_meetings_team_starts ON meetings (team_id, starts_at);
CREATE INDEX IF NOT EXISTS meet_meetings_linked ON meetings (linked_record);
CREATE TABLE IF NOT EXISTS meeting_participants (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id TEXT, guest_name TEXT, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'guest',
  status TEXT NOT NULL DEFAULT 'waiting', asked_at BIGINT NOT NULL, joined_at BIGINT, left_at BIGINT,
  audio_on INTEGER NOT NULL DEFAULT 1, video_on INTEGER NOT NULL DEFAULT 1, sharing INTEGER NOT NULL DEFAULT 0,
  hand_raised INTEGER NOT NULL DEFAULT 0, layout TEXT NOT NULL DEFAULT 'grid', kind TEXT NOT NULL DEFAULT 'person'
);
CREATE INDEX IF NOT EXISTS meet_mp_meeting ON meeting_participants (meeting_id, status);
CREATE TABLE IF NOT EXISTS meeting_chat (
  id ${serial(d)}, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  participant_id TEXT, display_name TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS meet_mc_meeting ON meeting_chat (meeting_id, id);
CREATE TABLE IF NOT EXISTS meeting_requests (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  participant_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT, created_at BIGINT NOT NULL, done_at BIGINT
);
`,
  },
  {
    id: 2,
    name: 'live room: peers, signals, plan',
    sql: (d) => `
CREATE TABLE IF NOT EXISTS meet_peers (
  peer_id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  participant_id TEXT, kind TEXT NOT NULL, client TEXT NOT NULL DEFAULT 'browser', metrics TEXT,
  joined_at BIGINT NOT NULL, last_seen BIGINT NOT NULL, draining INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meet_rp_meeting ON meet_peers (meeting_id);
CREATE TABLE IF NOT EXISTS meet_signals (
  id ${serial(d)}, meeting_id TEXT NOT NULL, to_peer TEXT NOT NULL, from_peer TEXT NOT NULL,
  type TEXT NOT NULL, body TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS meet_signals_to ON meet_signals (meeting_id, to_peer, id);
CREATE TABLE IF NOT EXISTS meet_room_state (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE, version INTEGER NOT NULL, plan TEXT NOT NULL, updated_at BIGINT NOT NULL
);
`,
  },
  {
    id: 3,
    name: 'v1 tables, empty until recording and notes ship',
    sql: `
CREATE TABLE IF NOT EXISTS meet_recordings (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  file_id TEXT, duration_s INTEGER, consent_state TEXT NOT NULL DEFAULT 'asking', started_by TEXT, started_at BIGINT, stopped_at BIGINT
);
CREATE TABLE IF NOT EXISTS meet_recording_consents (
  recording_id TEXT NOT NULL REFERENCES meet_recordings(id) ON DELETE CASCADE, participant_id TEXT NOT NULL,
  answer TEXT NOT NULL, answered_at BIGINT NOT NULL, notice_shown_at BIGINT NOT NULL, PRIMARY KEY (recording_id, participant_id)
);
CREATE TABLE IF NOT EXISTS meet_transcripts (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE, segments TEXT NOT NULL, language TEXT
);
CREATE TABLE IF NOT EXISTS meeting_notes (
  meeting_id TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE, summary TEXT, decisions TEXT, action_items TEXT, written_by_agent_id TEXT
);
`,
  },
  {
    id: 4,
    name: 'notes: consent, transcript lines, notes columns, settings',
    sql: `
ALTER TABLE meetings ADD COLUMN notes_on INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meetings ADD COLUMN notes_by TEXT;
ALTER TABLE meetings ADD COLUMN notes_started_at BIGINT;
ALTER TABLE meetings ADD COLUMN notes_targets TEXT;
CREATE TABLE IF NOT EXISTS meet_notes_consents (
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, participant_id TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT 'pending', engine TEXT, notice_shown_at BIGINT, answered_at BIGINT,
  PRIMARY KEY (meeting_id, participant_id)
);
CREATE TABLE IF NOT EXISTS meet_segments (
  id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE, participant_id TEXT,
  speaker TEXT NOT NULL, start_at BIGINT NOT NULL, end_at BIGINT NOT NULL, text TEXT NOT NULL, engine TEXT,
  written_by TEXT, created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS meet_segments_meeting ON meet_segments (meeting_id, start_at);
ALTER TABLE meeting_notes ADD COLUMN model TEXT;
ALTER TABLE meeting_notes ADD COLUMN scripted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meeting_notes ADD COLUMN written_at BIGINT;
ALTER TABLE meeting_notes ADD COLUMN sent TEXT;
CREATE TABLE IF NOT EXISTS meet_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`,
  },
  {
    id: 5,
    name: 'recording: who records, where it went',
    sql: `
ALTER TABLE meet_recordings ADD COLUMN started_by_name TEXT;
ALTER TABLE meet_recordings ADD COLUMN recorder_pid TEXT;
ALTER TABLE meet_recordings ADD COLUMN recording_at BIGINT;
ALTER TABLE meet_recordings ADD COLUMN storage TEXT;
ALTER TABLE meet_recordings ADD COLUMN size_bytes BIGINT;
ALTER TABLE meet_recordings ADD COLUMN mime TEXT;
CREATE INDEX IF NOT EXISTS meet_recordings_meeting ON meet_recordings (meeting_id, started_at);
`,
  },
];

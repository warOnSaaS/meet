# Host wOS Meetings yourself

## What you need

| For | You need |
|---|---|
| Calls of up to 4 people | A server that runs Docker (a small VPS is fine), a domain pointed at it, and ports 80 and 443 open. That is all: media goes straight between the people in the call. |
| People behind strict firewalls | A TURN relay. `docker compose --profile turn up -d` runs coturn; open UDP 3478 and UDP 49160 to 49200. Set `TURN_URLS` and `TURN_SECRET`. |
| Calls bigger than 4 | Either someone in the call runs the participant host (no setup on your side, see DESKTOP-HOST.md), or a media server: `docker compose --profile meetings up -d` runs LiveKit; open UDP 50000 to 60000, TCP 7881 and UDP 3478, and point a second domain (`LIVEKIT_DOMAIN`) at the server. |
| Sign-in | A GitHub OAuth app (free, five minutes): callback `https://<your domain>/auth/github/callback`. Guests never need to sign in. |

## Steps

```sh
git clone https://github.com/warOnSaaS/meet && cd meet
cp .env.example .env
# edit .env: SESSION_SECRET (openssl rand -hex 32), DOMAIN, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
docker compose up -d
docker compose exec meet node bin/meet.mjs doctor https://$DOMAIN
```

The doctor checks that UDP leaves the server, that your certificate is valid, that TURN and LiveKit answer, and says what to fix in plain words. Signed-in people can run the same check from the home screen ("Check calls").

## Notes and recordings (optional)

Set these in the app (home page, "Notes and recording settings"; inside wOS, per team) or in `.env` as defaults for everyone. Keys saved in the app are encrypted with a key made from `SESSION_SECRET`.

| Setting | Env | What for |
|---|---|---|
| Notes model | `NOTES_MODEL_URL`, `NOTES_MODEL`, `NOTES_MODEL_KEY` | Any OpenAI-compatible chat API (OpenAI, a local Ollama at `http://localhost:11434/v1`, LM Studio, vLLM). Without it, a labelled script writes demo notes. |
| Speech service | `TRANSCRIBE_URL`, `TRANSCRIBE_MODEL`, `TRANSCRIBE_KEY` | Only for people whose device cannot run Whisper and who have no helper in the call. Any OpenAI-compatible `/audio/transcriptions` (OpenAI, or whisper.cpp's server on your own machine). |
| Recording storage | `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | S3, Cloudflare R2, MinIO or Backblaze B2. Browsers upload straight to the bucket, so the bucket needs a CORS rule allowing `PUT` and `GET` from your Meetings address with the `content-type` header. Without storage, recordings are saved to the recorder's disk. |

Whisper itself runs in each person's browser: nothing to install on the server. The model files come from the Hugging Face hub and the WebAssembly runtime from jsDelivr, once per browser.

## Your own Postgres

Set `DATABASE_URL` to any Postgres (Neon, Supabase, RDS, your own). Tables are created and updated when the app starts. Without it, the app uses SQLite in `./data/meet.db`.

## On Vercel

The app runs on Vercel too (`vercel deploy`), with `DATABASE_URL` pointing at a Postgres. Vercel has no WebSockets, so browsers long-poll for signalling; it adds a little delay to joining, not to the call itself. Participant hosts and LiveKit work the same.

## Moving off

`meet.export` returns every meeting you host, who joined and the chat, as JSON. The database is yours: `pg_dump` works.

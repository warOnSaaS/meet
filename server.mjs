// The suite's way in (CONTRACTS.md): register(ctx) returns one handler per tool, plus the non-tool media
// routes. Standalone, bin/meet.mjs serves the same handlers itself; this file lets the suite load them
// with no rewrite. The suite's ctx.db has the same all/get/run/exec shape as server/db.mjs.
import { tools } from './server/tools/meet.mjs';
import { loadConfig } from './server/config.mjs';
import { createRoom } from './server/room/room.mjs';
import { createApp } from './server/http.mjs';
import { migrate } from './server/db.mjs';

export default async function register(ctx) {
  await migrate(ctx.db);
  const config = { ...loadConfig(), ...(ctx.config ?? {}) };
  const room = createRoom({ db: ctx.db, config });
  const media = createApp({ db: ctx.db, config });
  const handlers = {};
  for (const t of tools) {
    handlers[t.name] = (input, call) => t.handler({
      db: ctx.db, config, room, base: call.base ?? config.publicUrl,
      caller: { user: call.actor?.kind === 'person' ? { id: call.actor.id, name: call.actor.name ?? call.actor.id } : null, ticket: call.ticket ?? null },
    }, input ?? {});
  }
  return {
    handlers,
    // Media signalling and the WebSocket live under /media/<app id>/ in the suite.
    routes: () => ({ '/media/': (req, res) => media.handle(req, res) }),
  };
}

export { catalogue } from './server/tools/meet.mjs';

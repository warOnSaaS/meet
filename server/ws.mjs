// WebSocket signalling for long-running servers. Same mailbox as the long-poll routes; the socket only
// makes delivery instant. Clients fall back to long-polling when this is not available (Vercel).
import { WebSocketServer } from 'ws';
import { verify } from './auth.mjs';

export function attachWs(server, app) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/media/ws') return socket.destroy();
    const v = verify(app.config.secret, url.searchParams.get('token'), 'peer');
    const peer = v && (await app.db.get('SELECT * FROM meet_peers WHERE peer_id = ?', [v.peer]));
    if (!peer) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const since = Number(url.searchParams.get('since') ?? 0);
      const stop = app.room.subscribe(peer, since, (msgs) => ws.readyState === 1 && ws.send(JSON.stringify({ msgs })));
      const beat = setInterval(() => app.room.touch(peer.peer_id).catch(() => {}), 4000);
      ws.on('message', async (data) => {
        try {
          const m = JSON.parse(data);
          if (m.ping) return ws.send(JSON.stringify({ pong: m.ping }));
          for (const x of Array.isArray(m.msgs) ? m.msgs : [m]) if (x?.to && x?.type) await app.room.send(peer.meeting_id, peer.peer_id, String(x.to), String(x.type).slice(0, 40), x.body ?? null);
        } catch {}
      });
      ws.on('close', () => { stop(); clearInterval(beat); });
    });
  });
  return wss;
}

// MCP over HTTP (JSON-RPC 2.0, the "streamable HTTP" transport answered with plain JSON). Same tools, same
// handlers as /api/tools. Auth: the same bearer session token, or a meeting ticket in x-meet-ticket.
import { tools, ToolError } from './tools/meet.mjs';
import { callerFrom } from './auth.mjs';

const PROTOCOL = '2025-06-18';

export async function handleMcp(req, res, { app, base, body, json }) {
  if (req.method === 'GET') return json(res, 405, { error: 'Use POST for MCP requests.' });
  const msg = await body(req);
  const batch = Array.isArray(msg) ? msg : [msg];
  const caller = await callerFrom(req, app);
  const out = [];
  for (const m of batch) {
    const r = await one(m, caller);
    if (r) out.push(r);
  }
  if (!out.length) return res.writeHead(202).end();
  return json(res, 200, Array.isArray(msg) ? out : out[0]);

  async function one(m, caller) {
    const reply = (result) => ({ jsonrpc: '2.0', id: m.id, result });
    const error = (code, message) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
    if (m.id === undefined) return null; // notification
    switch (m.method) {
      case 'initialize':
        return reply({ protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'wos-meet', version: '0.1.0' }, instructions: 'wOS Meetings. Start, schedule and run video meetings. Tools that a person must finish (choosing a screen, allowing the camera) say so in their description.' });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: tools.map((t) => ({ name: t.name, description: t.description + (t.planned ? ' (planned)' : ''), inputSchema: t.input, annotations: { readOnlyHint: t.scope === 'read', destructiveHint: t.scope === 'delete' } })) });
      case 'tools/call': {
        try {
          const result = await app.callTool(m.params?.name, m.params?.arguments ?? {}, caller, base);
          return reply({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result });
        } catch (e) {
          if (e instanceof ToolError) return reply({ isError: true, content: [{ type: 'text', text: `${e.code}: ${e.message}` }] });
          throw e;
        }
      }
      default:
        return error(-32601, `Unknown method ${m.method}`);
    }
  }
}

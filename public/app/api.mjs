// The one way screens reach the server: callTool(name, input) posts to /api/tools/<name>, the same handler
// agents use over MCP. A meeting ticket (what a guest gets on joining) rides along in x-meet-ticket.
let ticket = null;
export const setTicket = (t) => { ticket = t; };
export const getTicket = () => ticket;

export class ToolFailed extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

export async function callTool(name, input = {}) {
  const headers = { 'content-type': 'application/json' };
  if (ticket) headers['x-meet-ticket'] = ticket;
  let r;
  try {
    r = await fetch(`/api/tools/${name}`, { method: 'POST', headers, body: JSON.stringify(input), credentials: 'same-origin' });
  } catch {
    throw new ToolFailed('offline', 'Could not reach the server. Check your connection.', 0);
  }
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new ToolFailed(d.error?.code ?? 'server', d.error?.message ?? 'Something went wrong.', r.status);
  return d.result;
}

// Media signalling is not a tool: it is the call's own traffic, under /media (CONTRACTS.md, non-tool traffic).
export async function mediaJoin(body) {
  const r = await fetch('/media/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new ToolFailed(d.error?.code ?? 'server', d.error?.message ?? 'Could not join the call.', r.status);
  return d;
}

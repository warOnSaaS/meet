// The whiteboard: Excalidraw in every browser in the call, merged with Yjs over the call's encrypted channel.
// The board is saved to the meeting (its Yjs state, the drawing as JSON, and a picture as SVG and PNG made in
// the browser), can be exported, and attached to a CRM record or a board task.
export function boardTools(H) {
  const { fail, str, MEETING, meetingRow, me, isOwner, requireHost, requireIn, joinUrl, now, id } = H;

  async function reader(ctx, m) {
    const p = await me(ctx, m);
    if (p && (p.status === 'admitted' || (p.status === 'left' && p.joined_at))) return p;
    if (isOwner(ctx, m) || (ctx.teamId && ctx.caller.user && m.team_id === ctx.teamId)) return null;
    fail('forbidden', 'Only people in this meeting can see its whiteboard.', 403);
  }
  const boardOf = (ctx, m) => ctx.db.get('SELECT * FROM meet_boards WHERE meeting_id = ? ORDER BY created_at LIMIT 1', [m.id]);
  const texts = (els) => els.filter((e) => e.type === 'text' && !e.isDeleted && e.text).map((e) => String(e.text).trim());
  const out = (ctx, m, b, full = false) => {
    if (!b) return { meeting: m.id, board: null };
    const els = JSON.parse(b.elements || '[]').filter((e) => !e.isDeleted);
    return {
      meeting: m.id, board: b.id, title: b.title, open: !!b.is_open, opened_by: b.opened_by, updated_at: b.updated_at ? new Date(Number(b.updated_at)).toISOString() : null,
      shapes: els.length, text: texts(els), attached: b.attached ? JSON.parse(b.attached) : [], link: `${joinUrl(ctx, m)}#board`,
      ...(full ? { state: b.state ?? null, elements: els } : {}),
    };
  };

  const tools = [
    {
      name: 'meet.open_whiteboard', scope: 'write', confirm: 'none', events: ['meet.board.opened'],
      description: 'Open the meeting\'s whiteboard for everyone in the call (it is made the first time). Everyone draws on the same board; strokes go between browsers encrypted with the meeting key.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, title: str('A name for the board') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        let b = await boardOf(ctx, m);
        const by = p?.display_name ?? ctx.caller.user?.name ?? 'Someone';
        if (!b) {
          const bid = id('wb_');
          await ctx.db.run('INSERT INTO meet_boards (id, meeting_id, title, elements, is_open, opened_by, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)', [bid, m.id, String(a.title || `${m.title}: whiteboard`).slice(0, 140), '[]', by, now(), now()]);
        } else await ctx.db.run('UPDATE meet_boards SET is_open = 1, opened_by = ?, title = COALESCE(?, title) WHERE id = ?', [by, a.title ? String(a.title).slice(0, 140) : null, b.id]);
        b = await boardOf(ctx, m);
        await ctx.room.changed(m.id, 'board');
        return out(ctx, m, b);
      },
    },
    {
      name: 'meet.close_whiteboard', scope: 'write', confirm: 'none', events: ['meet.board.closed'],
      description: 'Put the whiteboard away for everyone in the call. It stays saved with the meeting. The person who opened it or a host.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        const p = await requireIn(ctx, m);
        const b = await boardOf(ctx, m);
        if (!b) fail('no_board', 'This meeting has no whiteboard.', 404);
        if (b.opened_by !== p?.display_name) await requireHost(ctx, m);
        await ctx.db.run('UPDATE meet_boards SET is_open = 0 WHERE id = ?', [b.id]);
        await ctx.room.changed(m.id, 'board');
        return { open: false };
      },
    },
    {
      name: 'meet.get_whiteboard', scope: 'read', confirm: 'none', events: [],
      description: 'The meeting\'s whiteboard: whether it is open, its text, how many shapes, where it was attached; with full: true, also the drawing (Excalidraw elements) and its merge state.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, full: { type: 'boolean', description: 'Also return the drawing and its state' } } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await reader(ctx, m);
        return out(ctx, m, await boardOf(ctx, m), !!a.full);
      },
    },
    {
      name: 'meet.save_whiteboard', scope: 'write', confirm: 'none', events: ['meet.board.saved'],
      description: 'Save the whiteboard to the meeting: its merge state, the drawing as Excalidraw elements, and pictures (SVG, and PNG when small). Browsers in the call do this by themselves a few seconds after each change; an agent can draw by sending elements.',
      input: { type: 'object', required: ['meeting'], properties: { meeting: MEETING, state: str('Yjs state, base64'), elements: { type: 'array', items: { type: 'object' }, description: 'Excalidraw elements' }, svg: str('The drawing as SVG'), png_base64: str('The drawing as PNG, base64') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await requireIn(ctx, m);
        const b = await boardOf(ctx, m);
        if (!b) fail('no_board', 'Open the whiteboard first.', 404);
        const f = { updated_at: now() };
        if (a.state != null) f.state = String(a.state).slice(0, 4e6);
        if (a.elements) f.elements = JSON.stringify(a.elements).slice(0, 4e6);
        if (a.svg != null) f.svg = String(a.svg).slice(0, 4e6);
        if (a.png_base64 != null) f.png = String(a.png_base64).slice(0, 4e6);
        await ctx.db.run(`UPDATE meet_boards SET ${Object.keys(f).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...Object.values(f), b.id]);
        return { saved: true, updated_at: new Date(f.updated_at).toISOString() };
      },
    },
    {
      name: 'meet.export_whiteboard', scope: 'read', confirm: 'none', events: [],
      description: 'The whiteboard as a picture: SVG (text) or PNG (base64), as last saved.',
      input: { type: 'object', required: ['meeting', 'format'], properties: { meeting: MEETING, format: { type: 'string', enum: ['svg', 'png'] } } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await reader(ctx, m);
        const b = await boardOf(ctx, m);
        if (!b) fail('no_board', 'This meeting has no whiteboard.', 404);
        if (a.format === 'svg') { if (!b.svg) fail('not_saved', 'The whiteboard has no picture yet. Draw something first.', 404); return { format: 'svg', mime: 'image/svg+xml', svg: b.svg, file_name: `${b.title}.svg` }; }
        if (!b.png) fail('not_saved', 'No PNG was saved (the board may be too large). Export SVG, or export PNG from the board on screen.', 404);
        return { format: 'png', mime: 'image/png', png_base64: b.png, file_name: `${b.title}.png` };
      },
    },
    {
      name: 'meet.attach_whiteboard', scope: 'write', confirm: 'none', events: ['meet.board.attached'],
      description: 'Attach the whiteboard to a CRM record (as a note with its text and a link) or a board task (as a comment). Inside wOS.',
      input: { type: 'object', required: ['meeting', 'to'], properties: { meeting: MEETING, to: str('crm:deal:<id or name>, crm:contact:..., crm:org:..., or board:task:<id>') } },
      async handler(ctx, a) {
        const m = await meetingRow(ctx, a.meeting);
        await reader(ctx, m);
        const b = await boardOf(ctx, m);
        if (!b) fail('no_board', 'This meeting has no whiteboard.', 404);
        if (!ctx.callTool) fail('needs_suite', 'Attaching the whiteboard to the CRM or the board works inside wOS. Here, export it as PNG or SVG.', 409);
        const o = out(ctx, m, b);
        const body = `Whiteboard from the meeting "${m.title}" (${o.shapes} shapes).${o.text.length ? `\n\nText on the board:\n${o.text.map((t) => `- ${t}`).join('\n')}` : ''}\n\nOpen it: ${o.link}`;
        const [app, kind, ...rest] = String(a.to).split(':');
        const ref = rest.join(':');
        if (!ref) fail('bad_input', 'Say where: crm:deal:<id>, crm:contact:<id>, crm:org:<id> or board:task:<id>.');
        const call = async (tool, input) => {
          try { return await ctx.callTool(tool, input); }
          catch (e) { if (e.code === 'no_tool' || e.status === 404) fail('app_off', `${app === 'crm' ? 'The CRM' : 'The board'} is off for this team.`, 409); fail(e.code ?? 'other_app', e.message, e.status ?? 502); }
        };
        let result;
        if (app === 'crm') result = await call('crm.log_activity', { type: 'note', subject: `Whiteboard: ${b.title}`.slice(0, 200), body, [{ org: 'org', organization: 'org', contact: 'contact' }[kind] ?? 'deal']: ref });
        else if (app === 'board' && kind === 'task') result = await call('board.update_task', { task: ref, comment: body });
        else fail('bad_input', 'Attach to crm:deal:..., crm:contact:..., crm:org:... or board:task:....');
        const att = [...(b.attached ? JSON.parse(b.attached) : []), { to: a.to, at: new Date().toISOString() }];
        await ctx.db.run('UPDATE meet_boards SET attached = ? WHERE id = ?', [JSON.stringify(att), b.id]);
        return { attached: a.to, result };
      },
    },
  ];
  for (const t of tools) t.test = 'test/e2e/whiteboard.test.mjs';
  return { tools };
}

export const BOARD_TITLES = {
  'meet.open_whiteboard': 'Open the whiteboard', 'meet.close_whiteboard': 'Close the whiteboard', 'meet.get_whiteboard': 'Get the whiteboard',
  'meet.save_whiteboard': 'Save the whiteboard', 'meet.export_whiteboard': 'Export the whiteboard', 'meet.attach_whiteboard': 'Attach the whiteboard',
};

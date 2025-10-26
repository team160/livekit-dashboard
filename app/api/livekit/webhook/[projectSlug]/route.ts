// app/api/livekit/webhook/[projectSlug]/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// LiveKit SDK dynamisch laden (Build-Probleme vermeiden)
async function getLiveKitReceiver() {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error('Missing LiveKit API credentials');
  const { WebhookReceiver } = await import('livekit-server-sdk');
  return new WebhookReceiver(key, secret);
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await context.params;

  const rawBody = await req.text();
  const authHeader = req.headers.get('authorization') || '';

  // 1) verifizieren
  let event: any;
  try {
    const receiver = await getLiveKitReceiver();
    event = await receiver.receive(rawBody, authHeader);
  } catch (e: any) {
    console.error('LiveKit webhook verify failed:', e?.message);
    return new NextResponse('invalid signature', { status: 401 });
  }

  // 2) passendes LiveKit-Projekt holen
  const sb = getSupabaseAdmin();
  const { data: lkproj, error: lkErr } = await sb
    .from('livekit_projects')
    .select('id, org_id, slug, is_active')
    .eq('slug', projectSlug)
    .single();

  if (lkErr || !lkproj || !lkproj.is_active) {
    console.error('Unknown or inactive project slug:', projectSlug, lkErr);
    return NextResponse.json({ ok: true }, { status: 204 });
  }

  // 3) loggen + calls mappen
  try {
    // immer loggen
    const { error: logErr } = await sb.from('agent_logs').insert({
      org_id: lkproj.org_id,
      level: 'debug',
      event: event.event ?? 'unknown_event',
      meta: event,
    });
    if (logErr) console.error('agent_logs insert failed:', logErr.message);

    // room infos
    const room = (event && (event.room || event.data?.room || event.payload?.room)) ?? {};
    const roomSid: string | undefined = room.sid || room.room_sid || event.room_sid;
    const roomName: string | undefined = room.name || event.room?.name;
    const createdAtMs: number | undefined =
      (typeof event.created_at === 'number' ? event.created_at : undefined) ||
      (typeof event.timestamp === 'number' ? event.timestamp : undefined);
    const nowIso = new Date().toISOString();
    const tsIso = createdAtMs ? new Date(createdAtMs).toISOString() : nowIso;

    switch (event.event) {
      case 'room_started': {
        const { error } = await sb.from('calls').upsert(
          {
            org_id: lkproj.org_id,
            external_ref: roomSid ?? roomName ?? `room-${nowIso}`,
            started_at: tsIso,
            summary: null,
            tags: [],
          },
          { onConflict: 'external_ref' }
        );
        if (error) console.error('calls upsert (room_started) failed:', error.message);
        break;
      }
      case 'room_finished': {
        if (!roomSid && !roomName) {
          console.warn('room_finished without roomSid/roomName');
          break;
        }
        const ref = roomSid ?? roomName!;
        const { error } = await sb
          .from('calls')
          .update({ ended_at: tsIso })
          .eq('external_ref', ref)
          .eq('org_id', lkproj.org_id);
        if (error) console.error('calls update (room_finished) failed:', error.message);
        break;
      }
      default:
        // andere Events nur geloggt
        break;
    }
  } catch (dbErr: any) {
    console.error('Unexpected DB error:', dbErr?.message);
    return new NextResponse('db error', { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

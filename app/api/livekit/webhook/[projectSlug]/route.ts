export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { WebhookReceiver } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const LK_API_KEY = process.env.LIVEKIT_API_KEY!;
const LK_API_SECRET = process.env.LIVEKIT_API_SECRET!;

function supabaseAdmin() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export async function POST(req: NextRequest, context: { params: { projectSlug: string } }) {
  const { projectSlug } = context.params;
  const rawBody = await req.text();
  const authHeader = req.headers.get('authorization') || '';

  let event: any;
  try {
    const receiver = new WebhookReceiver(LK_API_KEY, LK_API_SECRET);
    event = await receiver.receive(rawBody, authHeader);
  } catch (e: any) {
    console.error('LiveKit webhook verify failed:', e?.message);
    return new NextResponse('invalid signature', { status: 401 });
  }

  const sb = supabaseAdmin();
  const { data: lkproj, error: lkErr } = await sb
    .from('livekit_projects')
    .select('id, org_id, slug, is_active')
    .eq('slug', projectSlug)
    .single();

  if (lkErr || !lkproj || !lkproj.is_active) {
    console.error('Unknown or inactive project slug:', projectSlug, lkErr);
    return NextResponse.json({ ok: true }, { status: 204 });
  }

  try {
    await sb.from('agent_logs').insert({
      org_id: lkproj.org_id,
      level: 'debug',
      event: event.event ?? 'unknown_event',
      meta: event,
    });
  } catch (dbErr: any) {
    console.error('DB insert failed:', dbErr?.message);
    return new NextResponse('db error', { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true });
}

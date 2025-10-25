// app/api/livekit/webhook/[projectSlug]/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ---- Helpers --------------------------------------------------------------

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// LiveKit SDK dynamisch laden, damit der Bundler es nicht zur Build-Zeit auflöst
async function getLiveKitReceiver() {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) throw new Error('Missing LiveKit API credentials');

  const { WebhookReceiver } = await import('livekit-server-sdk');
  return new WebhookReceiver(key, secret);
}

// ---- Route Handlers -------------------------------------------------------

// Achtung: In Next 15 können params als Promise typisiert sein → awaiten!
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ projectSlug: string }> }
) {
  const { projectSlug } = await context.params;

  // 1) Raw body (für Signaturprüfung)
  const rawBody = await req.text();
  const authHeader = req.headers.get('authorization') || '';

  // 2) LiveKit Webhook verifizieren
  let event: any;
  try {
    const receiver = await getLiveKitReceiver();
    event = await receiver.receive(rawBody, authHeader);
  } catch (e: any) {
    console.error('LiveKit webhook verify failed:', e?.message);
    return new NextResponse('invalid signature', { status: 401 });
  }

  // 3) Projektzuordnung aus Supabase holen
  let sb;
  try {
    sb = getSupabaseAdmin();
  } catch (e: any) {
    console.error('Server env misconfig:', e?.message);
    return new NextResponse('server env misconfig', { status: 500 });
  }

  const { data: lkproj, error: lkErr } = await sb
    .from('livekit_projects')
    .select('id, org_id, slug, is_active')
    .eq('slug', projectSlug)
    .single();

  if (lkErr || !lkproj || !lkproj.is_active) {
    console.error('Unknown or inactive project slug:', projectSlug, lkErr);
    return NextResponse.json({ ok: true }, { status: 204 });
  }

  // 4) Vorerst alles in agent_logs protokollieren
  const { error: insErr } = await sb.from('agent_logs').insert({
    org_id: lkproj.org_id,
    level: 'debug',
    event: event.event ?? 'unknown_event',
    meta: event,
  });
  if (insErr) {
    console.error('DB insert failed:', insErr.message);
    return new NextResponse('db error', { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET() {
  // einfacher Healthcheck
  return NextResponse.json({ ok: true });
}

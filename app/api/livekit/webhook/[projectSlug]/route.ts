// app/api/livekit/webhook/[projectSlug]/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ⚙️ Hilfsfunktionen für Supabase + LiveKit
function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('Missing Supabase environment variables');
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// 🔑 Dynamischer Import: LiveKit SDK nur bei Bedarf laden
async function getLiveKitReceiver() {
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!key || !secret) {
    throw new Error('Missing LiveKit API credentials');
  }
  const { WebhookReceiver } = await import('livekit-server-sdk');
  return new WebhookReceiver(key, secret);
}

// 📨 Haupt-Webhook-Handler
export async function POST(req: NextRequest, context: { params: { projectSlug: string } }) {
  const { projectSlug } = context.params;

  // 1️⃣ Roh-Body lesen (nicht json())
  const rawBody = await req.text();
  const authHeader = req.headers.get('authorization') || '';

  // 2️⃣ Webhook verifizieren
  let event: any;
  try {
    const receiver = await getLiveKitReceiver();
    event = await receiver.receive(rawBody, authHeader);
  } catch (e: any) {
    console.error('LiveKit webhook verify failed:', e?.message);
    return new NextResponse('invalid signature', { status: 401 });
  }

  // 3️⃣ Projektzuordnung prüfen
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

  // 4️⃣ Ereignis protokollieren
  try {
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
  } catch (dbErr: any) {
    console.error('Unexpected DB error:', dbErr?.message);
    return new NextResponse('db error', { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

// 🌐 Health-Check-Route
export async function GET() {
  return NextResponse.json({ ok: true });
}

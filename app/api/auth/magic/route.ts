// app/api/auth/magic/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const email = await req.text();
  if (!email) return NextResponse.json({ error: 'email missing' }, { status: 400 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error } = await sb.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo:
        process.env.NEXT_PUBLIC_SITE_URL ||
        'http://localhost:3000'
    }
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

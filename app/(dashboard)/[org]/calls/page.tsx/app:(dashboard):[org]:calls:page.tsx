import { createClient } from '@supabase/supabase-js';

export default async function CallsPage({ params }: { params: { org: string } }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sb = createClient(url, anon);

  const { data: org } = await sb.from('organizations').select('id,name').eq('slug', params.org).maybeSingle();
  if (!org) return <main style={{padding:24}}>Organization not found</main>;

  const { data: calls } = await sb
    .from('calls')
    .select('id,caller_name,caller_phone,started_at,ended_at,duration_seconds,summary,tags,external_ref')
    .eq('org_id', org.id)
    .order('started_at', { ascending: false });

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>{org.name} — Calls</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th align="left">Caller</th>
            <th align="left">Phone</th>
            <th align="left">Start</th>
            <th align="left">End</th>
            <th align="right">Duration (s)</th>
            <th align="left">Summary</th>
            <th align="left">Tags</th>
            <th align="left">Ref</th>
          </tr>
        </thead>
        <tbody>
          {(calls ?? []).map((c) => (
            <tr key={c.id} style={{ borderTop: '1px solid #eee' }}>
              <td>{c.caller_name || '—'}</td>
              <td>{c.caller_phone || '—'}</td>
              <td>{new Date(c.started_at).toLocaleString()}</td>
              <td>{c.ended_at ? new Date(c.ended_at).toLocaleString() : '—'}</td>
              <td align="right">{c.duration_seconds ?? '—'}</td>
              <td>{(c.summary ?? '').slice(0, 120)}</td>
              <td>{(c.tags ?? []).join(', ')}</td>
              <td>{c.external_ref}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 16 }}>
        <a href={`/api/export/calls?org=${params.org}`}>CSV exportieren</a>
      </div>
    </main>
  );
}

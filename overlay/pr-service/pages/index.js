import { useState, useEffect } from 'react';

export default function Dashboard() {
  const [origin, setOrigin] = useState('');
  useEffect(() => { setOrigin(window.location.origin); }, []);

  return (
    <main style={s.main}>
      <div style={s.card}>
        <h1 style={s.title}>Inline Edit Tool</h1>
        <p style={s.sub}>PR service is running.</p>

        <div style={s.row}>
          <span style={s.label}>Service URL</span>
          <code style={s.code}>{origin || '…'}</code>
        </div>

        <p style={s.hint}>
          Open the browser extension, enter this Service URL in the popup, then click{' '}
          <strong>"Connect with GitHub"</strong> on any page to start creating pull requests.
        </p>
      </div>
    </main>
  );
}

const s = {
  main:  { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif' },
  card:  { background: '#fff', borderRadius: 12, padding: '32px 28px', width: 460, boxShadow: '0 1px 3px rgba(0,0,0,.1),0 4px 16px rgba(0,0,0,.06)' },
  title: { fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 },
  sub:   { fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 },
  row:   { display: 'flex', alignItems: 'center', gap: 10, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 14px', marginBottom: 20 },
  label: { fontSize: 12, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' },
  code:  { fontSize: 13, color: '#1d4ed8', fontFamily: 'Menlo,Consolas,monospace', wordBreak: 'break-all' },
  hint:  { fontSize: 13, color: '#6b7280', lineHeight: 1.6 },
};

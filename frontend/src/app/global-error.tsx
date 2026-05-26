'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 32, background: '#f8fafc' }}>
        <div style={{
          maxWidth: 480,
          margin: '80px auto',
          padding: 32,
          background: '#fff',
          border: '1px solid #fca5a5',
          borderRadius: 16,
          boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
        }}>
          <h2 style={{ color: '#b91c1c', margin: '0 0 12px' }}>Application Error</h2>
          <p style={{ color: '#475569', fontSize: 14 }}>{error.message}</p>
          <pre style={{
            marginTop: 16,
            padding: 12,
            background: '#f1f5f9',
            borderRadius: 8,
            fontSize: 11,
            overflow: 'auto',
            maxHeight: 200,
            color: '#334155',
          }}>
            {error.stack}
          </pre>
          <button
            onClick={reset}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

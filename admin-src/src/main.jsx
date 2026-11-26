import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import '@astryxdesign/theme-neutral/theme.css';
import './styles.css';
import { Component, useEffect, useState } from 'react';
import { ThemeModeContext } from './themeMode.js';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import App from './App.jsx';
import logoUrl from './logo.png';

// Favicon = Webflow Extractor icon
const fav = document.createElement('link');
fav.rel = 'icon'; fav.href = logoUrl;
document.head.appendChild(fav);

function Root() {
  const [mode, setModeState] = useState(() => {
    try { return localStorage.getItem('fx-theme') || 'system'; } catch { return 'system'; }
  });
  const setMode = m => { setModeState(m); try { localStorage.setItem('fx-theme', m); } catch {} };

  // Our own CSS reads html[data-fx-dark] so it matches Astryx's mode
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => { document.documentElement.dataset.fxDark = (mode === 'dark' || (mode === 'system' && mq.matches)) ? '1' : '0'; };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  return (
    <ThemeModeContext.Provider value={{ mode, setMode }}>
      <Theme theme={neutralTheme} mode={mode}>
        <App />
      </Theme>
    </ThemeModeContext.Provider>
  );
}

// Safety net: a crash must never leave a white page. Show what happened and
// offer to clear this browser's unpublished CMS data (drafts, publish memory);
// published content and the login are untouched.
async function resetLocalCms() {
  await new Promise(res => {
    const r = indexedDB.open('fx-admin', 1);
    r.onsuccess = () => {
      try {
        const db = r.result, tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
        const k = st.getAllKeys();
        k.onsuccess = () => { k.result.filter(x => /^(drafts|published):/.test(String(x))).forEach(x => st.delete(x)); };
        tx.oncomplete = res; tx.onerror = res;
      } catch { res(); }
    };
    r.onerror = res;
  });
  try { const regs = await navigator.serviceWorker?.getRegistrations(); for (const g of regs || []) await g.unregister(); } catch {}
  location.reload();
}
class Safe extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[cms] crashed', error, info?.componentStack); }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    const box = { fontFamily: 'system-ui, sans-serif', maxWidth: 480, margin: '15vh auto', padding: 28, borderRadius: 14, border: '1px solid #e5e5e5', background: '#fff', color: '#111', lineHeight: 1.5 };
    const btn = { font: 'inherit', fontWeight: 600, padding: '9px 16px', borderRadius: 8, border: 0, cursor: 'pointer', marginRight: 8 };
    return (
      <div style={{ minHeight: '100vh', background: '#f5f5f5', padding: 16 }}>
        <div style={box}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>The CMS hit a problem</h2>
          <p style={{ margin: '0 0 16px', color: '#555', fontSize: 14 }}>Unpublished changes saved in this browser may be out of date. Resetting clears only those — everything you published stays, and you stay signed in.</p>
          <button style={{ ...btn, background: '#0b63f6', color: '#fff' }} onClick={resetLocalCms}>Reset this browser's CMS data</button>
          <button style={{ ...btn, background: '#eee', color: '#111' }} onClick={() => location.reload()}>Reload</button>
          <pre style={{ marginTop: 18, fontSize: 11, color: '#888', whiteSpace: 'pre-wrap' }}>{String(e?.message || e)}</pre>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById('root')).render(<Safe><Root /></Safe>);

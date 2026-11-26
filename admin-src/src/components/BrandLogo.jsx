import { useState } from 'react';

// Official brand marks (Simple Icons CDN) on a white tile so they read in
// light and dark mode. Falls back to the brand's initial when offline.
// App-icon style tile: brand colour background with the white mark, so
// every logo is clear in light and dark mode.
export function BrandLogo({ slug, color = '000000', tile, name, size = 20 }) {
  const [bad, setBad] = useState(false);
  const bg = `#${tile || color}`;
  return (
    <span className="fx-brand-tile" style={{ background: bg }} aria-hidden="true">
      {bad ? <b style={{ color: '#fff' }}>{(name || slug)[0].toUpperCase()}</b>
        : <img src={`https://cdn.simpleicons.org/${slug}/ffffff`} alt="" width={size} height={size} onError={() => setBad(true)} />}
    </span>
  );
}

export const BRANDS = {
  github: { slug: 'github', color: '1E1E1E', name: 'GitHub' },
  vercel: { slug: 'vercel', color: '1E1E1E', name: 'Vercel' },
  netlify: { slug: 'netlify', color: '00C7B7', name: 'Netlify' },
  cloudflare: { slug: 'cloudflarepages', color: 'F38020', name: 'Cloudflare Pages' },
  wordpress: { slug: 'wordpress', color: '21759B', name: 'WordPress' },
  notion: { slug: 'notion', color: '1E1E1E', name: 'Notion' },
  airtable: { slug: 'airtable', color: '18BFFF', name: 'Airtable' },
  webflow: { slug: 'webflow', color: '146EF5', name: 'Webflow' },
  sheets: { slug: 'googlesheets', color: '34A853', name: 'Google Sheets' },
  json: { slug: 'json', color: '1E1E1E', name: 'JSON' },
};
// Marks drawn locally where the flat white version loses the real shape
const CUSTOM = {
  // Current Google Sheets icon: green sheet, folded corner, white table
  sheets: (
    <svg width="22" height="28" viewBox="0 0 22 30" aria-hidden="true">
      <path d="M14 0H3a3 3 0 0 0-3 3v24a3 3 0 0 0 3 3h16a3 3 0 0 0 3-3V8z" fill="#0F9D58" />
      <path d="M14 0v6a2 2 0 0 0 2 2h6z" fill="#87CEAC" />
      <path d="M5 13h12v10H5z" fill="#fff" />
      <path d="M5 16.3h12M5 19.6h12M10 13v10" stroke="#0F9D58" strokeWidth="1.3" />
    </svg>
  ),
  // JSON / developers: code brackets
  json: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4.5l-3 15" />
    </svg>
  ),
};
const CUSTOM_BG = { sheets: 'transparent', json: '#1E1E1E' };

export const Brand = ({ id, size }) => CUSTOM[id]
  ? <span className={`fx-brand-tile ${id === 'sheets' ? 'is-plain' : ''}`} style={{ background: CUSTOM_BG[id] }} aria-hidden="true">{CUSTOM[id]}</span>
  : <BrandLogo {...BRANDS[id]} size={size} />;

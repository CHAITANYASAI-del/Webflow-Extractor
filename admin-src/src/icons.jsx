// Small stroke icon set (Lucide-style, 24×24) so the admin never depends on
// icon names that may differ between Astryx themes.
const I = ({ d, size = 16, children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

export const IconPlus = p => <I {...p} d="M12 5v14M5 12h14" />;
export const IconSearch = p => <I {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>;
export const IconTrash = p => <I {...p} d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />;
export const IconCopy = p => <I {...p}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></I>;
export const IconExternal = p => <I {...p} d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />;
export const IconUndo = p => <I {...p} d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />;
export const IconDesktop = p => <I {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></I>;
export const IconTablet = p => <I {...p}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M11 18h2" /></I>;
export const IconPhone = p => <I {...p}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" /></I>;
export const IconRefresh = p => <I {...p} d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />;
export const IconDatabase = p => <I {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></I>;
export const IconPlug = p => <I {...p} d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8ZM12 17v5" />;
export const IconSettings = p => <I {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></I>;
export const IconImage = p => <I {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></I>;
export const IconUpload = p => <I {...p} d="M12 16V4M7 9l5-5 5 5M4 20h16" />;
export const IconDownload = p => <I {...p} d="M12 4v12M7 11l5 5 5-5M4 20h16" />;
export const IconLock = p => <I {...p}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></I>;
export const IconGithub = p => <I {...p} d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />;
export const IconFolder = p => <I {...p} d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />;
export const IconCloud = p => <I {...p} d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 1 0 6 18.9h11.5Z" />;
export const IconArchive = p => <I {...p}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11h14V8M10 12h4" /></I>;
export const IconCheck = p => <I {...p} d="M5 12l5 5L20 7" />;
export const IconArrowUp = p => <I {...p} d="M12 19V5M6 11l6-6 6 6" />;
export const IconArrowDown = p => <I {...p} d="M12 5v14M6 13l6 6 6-6" />;
export const IconBold = p => <I {...p} d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />;
export const IconItalic = p => <I {...p} d="M19 4h-9M14 20H5M15 4 9 20" />;
export const IconLink = p => <I {...p} d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />;
export const IconList = p => <I {...p} d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />;
export const IconListOl = p => <I {...p} d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />;
export const IconQuote = p => <I {...p} d="M3 21c3 0 7-1 7-8V5H3v7h4M14 21c3 0 7-1 7-8V5h-7v7h4" />;
export const IconWordpress = p => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M4.5 8.5 9 20M7 8h4M13 8h4M9.5 8 13 18l3.5-10M17.5 12.5 15 19" /></I>;
export const IconTable = p => <I {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></I>;
export const IconNotion = p => <I {...p}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 16V8l6 8V8" /></I>;
export const IconCode = p => <I {...p} d="m16 18 6-6-6-6M8 6l-6 6 6 6" />;
export const IconSheet = p => <I {...p}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h8M12 11v8" /></I>;
export const IconWebflow = p => <I {...p} d="M3 8l3 9 3-6 3 6 3-9M15 8l2 5 4-5" />;
export const IconLogout = p => <I {...p} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />;
export const IconEye = p => <I {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></I>;
export const IconChevron = p => <I {...p} d="m9 6 6 6-6 6" />;
export const IconPage = p => <I {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></I>;
export const IconTarget = p => <I {...p}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></I>;
export const IconChevronDown = p => <I {...p} d="m6 9 6 6 6-6" />;
export const IconExport = p => <I {...p} d="M12 15V3M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />;
export const IconSun = p => <I {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></I>;
export const IconMoon = p => <I {...p} d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />;

// Tiny IndexedDB key/value store (drafts, folder handle). Never throws.
const DB = 'fx-admin', STORE = 'kv';
let dbp;
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }).catch(() => null);
  }
  return dbp;
}
export async function idbGet(key) {
  try {
    const d = await db(); if (!d) return undefined;
    return await new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  } catch { return undefined; }
}
export async function idbSet(key, value) {
  try {
    const d = await db(); if (!d) return;
    await new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(value, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  } catch {}
}
export async function idbDel(key) {
  try {
    const d = await db(); if (!d) return;
    await new Promise(res => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(key); t.oncomplete = res; t.onerror = res; });
  } catch {}
}

const ledgerKey = 'tutoring_data';
const preferenceKeys = ['workie_milestones_v1', 'workie_disclosures_v1',
  'workie_schedule_view', 'workie_budget_view_v1'];
const format = 'workie-legacy-snapshot';
const database = 'workie-nextgen-recovery';

// Keep the original strings: normalization belongs to a later, reversible migration.
export function readLegacy(storage) {
  const rawLedger = storage.getItem(ledgerKey);
  if (rawLedger === null) return null;
  const preferences = Object.fromEntries(preferenceKeys.flatMap(key => {
    const value = storage.getItem(key);
    return value === null ? [] : [[key, value]];
  }));
  return {format, version: 1, rawLedger, preferences};
}

export async function snapshotId(snapshot) {
  const canonical = JSON.stringify([snapshot.format, snapshot.version, snapshot.rawLedger,
    Object.entries(snapshot.preferences).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifySnapshot(entry) {
  if (entry?.format !== format || entry.version !== 1 || typeof entry.rawLedger !== 'string' ||
      !entry.preferences || typeof entry.preferences !== 'object' || Array.isArray(entry.preferences) ||
      !Object.entries(entry.preferences).every(([key, value]) => preferenceKeys.includes(key) && typeof value === 'string') ||
      entry.id !== await snapshotId(entry)) throw new Error('The recovery copy is invalid or its checksum does not match.');
  return entry;
}

export function inspectLedger(raw) {
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The legacy ledger must be a JSON object.');
  const keys = ['sources', 'records', 'expenses', 'scheduled', 'smartExpenses', 'tripCategories'];
  const counts = Object.fromEntries(keys.map(key => {
    if (Object.hasOwn(value, key) && !Array.isArray(value[key])) throw new Error(`Legacy field ${key} must be an array.`);
    // Missing is different from an explicit empty array.
    return [key, Object.hasOwn(value, key) ? value[key].length : null];
  }));
  return {value, counts};
}

async function openVault() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('snapshots', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close other Workie tabs and try again.'));
  });
}

export async function stageLegacy(storage) {
  const snapshot = readLegacy(storage);
  if (!snapshot) return null;
  const entry = {...snapshot, id: await snapshotId(snapshot), createdAt: new Date().toISOString()};
  const db = await openVault();
  try {
    const saved = await new Promise((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      let result;
      const read = store.get(entry.id);
      read.onsuccess = () => {
        result = read.result ?? entry;
        if (!read.result) store.add(entry);
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('Could not save the recovery copy.'));
    });
    return await verifySnapshot(saved);
  } finally {
    db.close();
  }
}

function connectBackupUI() {
  const button = document.querySelector('#nextgen-legacy-snapshot');
  if (!button) return;
  const status = document.querySelector('#nextgen-snapshot-status');
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Preparing recovery copy…';
    try {
      const entry = await stageLegacy(localStorage);
      if (!entry) {
        status.textContent = 'No legacy ledger was found in this browser and site. Existing backups can be kept separately.';
        return;
      }
      const url = URL.createObjectURL(new Blob([JSON.stringify(entry)], {type: 'application/json'}));
      const link = document.createElement('a');
      link.href = url;
      link.download = `workie-recovery-${entry.id.slice(0, 12)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status.textContent = 'Recovery copy saved in this browser. Check that the separate download also arrived.';
    } catch (error) {
      status.textContent = `Recovery copy could not be saved. Your ledger was not changed. ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });
}

if (typeof document !== 'undefined') connectBackupUI();

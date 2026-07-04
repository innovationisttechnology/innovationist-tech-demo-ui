const DATABASE_NAME = "content-sync";
const DATABASE_VERSION = 1;
const STORE_NAME = "meta";
const SESSION_KEY = "session-id";

// Sliding TTL: each read pushes the expiry out, so active browsers keep their
// id and idle ones expire. Drop the refresh-on-read below to make it absolute.
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

type SessionRecord = {
  value: string;
  expiresAt: number;
};

function generateSessionId(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  // Set the version (4) and variant bits per RFC 4122.
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40;
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80;

  const hex = Array.from(randomBytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  );
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    openRequest.onupgradeneeded = () => {
      const database = openRequest.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    openRequest.onsuccess = () => resolve(openRequest.result);
    openRequest.onerror = () => reject(openRequest.error);
  });
}

function isSessionRecord(candidate: unknown): candidate is SessionRecord {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof (candidate as SessionRecord).value === "string" &&
    typeof (candidate as SessionRecord).expiresAt === "number"
  );
}

function readRecord(
  database: IDBDatabase,
  key: string,
): Promise<SessionRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const getRequest = transaction.objectStore(STORE_NAME).get(key);

    getRequest.onsuccess = () => {
      const storedRecord = getRequest.result;
      resolve(isSessionRecord(storedRecord) ? storedRecord : undefined);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

function writeRecord(
  database: IDBDatabase,
  key: string,
  value: string,
  ttlMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const record: SessionRecord = { value, expiresAt: Date.now() + ttlMs };
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(record, key);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function deleteRecord(database: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(key);

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// This browser's stable session id, minted and persisted in IndexedDB on first
// call and reused across reloads/tabs. Client-only: resolves to "" on the
// server or when IndexedDB is unavailable, so call it from effects/handlers.
export async function getSessionId(): Promise<string> {
  if (typeof indexedDB === "undefined") {
    return "";
  }

  const database = await openDatabase();
  try {
    const existingRecord = await readRecord(database, SESSION_KEY);

    if (existingRecord && existingRecord.expiresAt > Date.now()) {
      // Still valid — slide the expiry forward and reuse the id.
      await writeRecord(
        database,
        SESSION_KEY,
        existingRecord.value,
        SESSION_TTL_MS,
      );
      return existingRecord.value;
    }

    if (existingRecord) {
      // Present but expired — evict before minting a replacement.
      await deleteRecord(database, SESSION_KEY);
    }

    const sessionId = generateSessionId();
    await writeRecord(database, SESSION_KEY, sessionId, SESSION_TTL_MS);
    return sessionId;
  } finally {
    database.close();
  }
}

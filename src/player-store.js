const DB_NAME = "sleeper-draft-viewer";
const STORE_NAME = "datasets";
const PLAYER_KEY = "nfl-players";

function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readPlayerCache() {
  try {
    const db = await openDatabase();
    if (!db) return null;
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(PLAYER_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch (error) {
    console.warn("Player cache could not be read:", error);
    return null;
  }
}

export async function writePlayerCache(players, savedAt = Date.now()) {
  try {
    const db = await openDatabase();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ players, savedAt }, PLAYER_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  } catch (error) {
    console.warn("Player cache could not be written:", error);
  }
}

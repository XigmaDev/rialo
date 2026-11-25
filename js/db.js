/*
  db.js — لایه دسترسی به داده (Repository Pattern) روی IndexedDB
  تمام داده‌ها فقط داخل مرورگر/گوشی ذخیره می‌شوند. هیچ درخواست شبکه‌ای وجود ندارد.

  جداول (Object Store ها):
    - banks        : بانک‌ها
    - accounts      : حساب‌ها/کارت‌ها
    - transactions  : تراکنش‌ها
    - units         : واحدها
    - categories    : دسته‌بندی‌ها
    - tags          : برچسب‌ها
    - settings      : تنظیمات (تک‌رکوردی به‌ازای هر کلید)
    - backups       : تاریخچه فایل‌های پشتیبان (فقط ابرداده)
*/

const DB_NAME = 'daftar-tarakonesh-db';
const DB_VERSION = 1;

const DB = (() => {
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        // بانک‌ها
        if (!db.objectStoreNames.contains('banks')) {
          const s = db.createObjectStore('banks', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_name', 'name', { unique: true });
        }

        // حساب‌ها / کارت‌ها
        if (!db.objectStoreNames.contains('accounts')) {
          const s = db.createObjectStore('accounts', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_bank', 'bankId');
          s.createIndex('by_card', 'cardNumber');
          s.createIndex('by_accountNumber', 'accountNumber');
        }

        // واحدها (مالی، فروش، پروژه...)
        if (!db.objectStoreNames.contains('units')) {
          const s = db.createObjectStore('units', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_name', 'name', { unique: true });
        }

        // دسته‌بندی‌ها
        if (!db.objectStoreNames.contains('categories')) {
          const s = db.createObjectStore('categories', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_name', 'name');
          s.createIndex('by_unit', 'unitId');
        }

        // برچسب‌ها
        if (!db.objectStoreNames.contains('tags')) {
          const s = db.createObjectStore('tags', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_name', 'name', { unique: true });
        }

        // تراکنش‌ها — هسته اصلی برنامه
        if (!db.objectStoreNames.contains('transactions')) {
          const s = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_status', 'status');
          s.createIndex('by_date', 'date');
          s.createIndex('by_bank', 'bankName');
          s.createIndex('by_account', 'accountId');
          s.createIndex('by_unit', 'unitId');
          s.createIndex('by_category', 'categoryId');
          s.createIndex('by_type', 'type');
          s.createIndex('by_amount', 'amount');
          s.createIndex('by_trackingCode', 'trackingCode');
        }

        // تنظیمات
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        // ابرداده نسخه‌های پشتیبان
        if (!db.objectStoreNames.contains('backups')) {
          const s = db.createObjectStore('backups', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_date', 'createdAt');
        }
      };

      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
    return dbPromise;
  }

  /* ---------- کش حافظه برای getAll ----------
     تقریباً هر صفحه کل جدول تراکنش‌ها و جداول مرجع را می‌خواند. به‌جای باز کردن
     تراکنش IndexedDB در هر ناوبری، نتیجه‌ی getAll هر Store در حافظه نگه داشته
     می‌شود و با هر نوشتن روی همان Store باطل می‌شود. */
  const cache = new Map(); // store -> Promise<Array>
  function invalidate(stores) {
    (Array.isArray(stores) ? stores : [stores]).forEach((s) => cache.delete(s));
  }

  // اجرای یک تراکنش کامل؛ resolve فقط پس از commit شدن (oncomplete)
  function run(storeNames, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      if (mode === 'readwrite') invalidate(storeNames);
      const t = db.transaction(storeNames, mode);
      let result;
      t.oncomplete = () => { if (mode === 'readwrite') invalidate(storeNames); resolve(result); };
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
      try {
        result = fn(t, (r) => { r.onsuccess = () => { result = r.result; }; return r; });
      } catch (e) { try { t.abort(); } catch (_) {} reject(e); }
    }));
  }

  // --- عملیات عمومی CRUD قابل استفاده مجدد برای هر Store ---
  function add(store, value) {
    return run(store, 'readwrite', (t, capture) => { capture(t.objectStore(store).add(value)); });
  }

  function put(store, value) {
    return run(store, 'readwrite', (t, capture) => { capture(t.objectStore(store).put(value)); });
  }

  function get(store, key) {
    return run(store, 'readonly', (t, capture) => { capture(t.objectStore(store).get(key)); });
  }

  function del(store, key) {
    return run(store, 'readwrite', (t) => { t.objectStore(store).delete(key); }).then(() => undefined);
  }

  // حذف چند رکورد در «یک» تراکنش (به‌جای N تراکنش پشت‌سرهم)
  function bulkDelete(store, keys) {
    return run(store, 'readwrite', (t) => {
      const os = t.objectStore(store);
      for (const k of keys) os.delete(k);
    }).then(() => undefined);
  }

  // خواندن + تغییر + نوشتن چند رکورد در یک تراکنش. mutate(record) رکورد را درجا تغییر می‌دهد.
  function bulkUpdate(store, keys, mutate) {
    return run(store, 'readwrite', (t) => {
      const os = t.objectStore(store);
      for (const k of keys) {
        const r = os.get(k);
        r.onsuccess = () => { const rec = r.result; if (!rec) return; mutate(rec); os.put(rec); };
      }
    }).then(() => undefined);
  }

  function rawGetAll(store, indexName, query) {
    return run(store, 'readonly', (t, capture) => {
      const os = indexName ? t.objectStore(store).index(indexName) : t.objectStore(store);
      capture(query !== undefined ? os.getAll(query) : os.getAll());
    }).then((r) => r || []);
  }

  // نسخه‌ی بدون index از کش خوانده می‌شود. خروجی یک کپی سطحی از آرایه است تا
  // sort/filter درجای فراخواننده روی کش اثر نگذارد.
  function getAll(store, indexName, query) {
    if (indexName) return rawGetAll(store, indexName, query);
    let p = cache.get(store);
    if (!p) {
      p = rawGetAll(store);
      cache.set(store, p);
      p.catch(() => { if (cache.get(store) === p) cache.delete(store); });
    }
    return p.then((rows) => rows.slice());
  }

  function clearStore(store) {
    return run(store, 'readwrite', (t) => { t.objectStore(store).clear(); }).then(() => undefined);
  }

  // خروجی کامل دیتابیس برای پشتیبان‌گیری
  const ALL_STORES = ['banks', 'accounts', 'units', 'categories', 'tags', 'transactions', 'settings'];

  async function exportAll() {
    const rows = await Promise.all(ALL_STORES.map((s) => getAll(s)));
    const out = {};
    ALL_STORES.forEach((s, i) => { out[s] = rows[i]; });
    out.__meta = { app: 'daftar-tarakonesh', version: DB_VERSION, exportedAt: new Date().toISOString() };
    return out;
  }

  // بازیابی «اتمیک»: پاک‌سازی و درج همه‌ی Store ها در یک تراکنش واحد انجام می‌شود؛
  // اگر هر ردیفی خطا بدهد کل عملیات rollback می‌شود و داده‌های فعلی دست‌نخورده می‌مانند.
  async function importAll(data) {
    if (!data || typeof data !== 'object') throw new Error('invalid backup');
    const stores = ALL_STORES.filter((s) => Array.isArray(data[s]));
    if (!stores.length) throw new Error('backup has no known stores');
    await run(stores, 'readwrite', (t) => {
      for (const store of stores) {
        const os = t.objectStore(store);
        os.clear();
        for (const row of data[store]) os.put(row);
      }
    });
    return true;
  }

  async function wipeAll() {
    await run(ALL_STORES, 'readwrite', (t) => {
      for (const store of ALL_STORES) t.objectStore(store).clear();
    });
  }

  return { open, add, put, get, del, bulkDelete, bulkUpdate, getAll, clearStore, exportAll, importAll, wipeAll };
})();

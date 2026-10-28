const DEFAULT_MAX_ENTRIES = 1000;

class MemoryCache {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.store = new Map();
    this.maxEntries = maxEntries;
    this.now = now;
  }

  get(key) {
    const hit = this.store.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key);
      return null;
    }
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.store.delete(key);
    if (this.store.size >= this.maxEntries) this.evict();
    this.store.set(key, {
      value,
      expiresAt: this.now() + Math.max(1000, Number(ttlMs) || 1000),
    });
    return value;
  }

  /** Drop expired entries; if still full, drop oldest inserted (Map keeps insertion order). */
  evict() {
    const now = this.now();
    for (const [key, hit] of this.store) {
      if (hit.expiresAt <= now) this.store.delete(key);
    }
    while (this.store.size >= this.maxEntries) {
      this.store.delete(this.store.keys().next().value);
    }
  }
}

module.exports = {
  MemoryCache,
};

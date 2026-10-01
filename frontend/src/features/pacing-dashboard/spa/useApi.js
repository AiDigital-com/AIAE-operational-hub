import { useState, useEffect, useCallback, useRef } from 'react';

const TTL_MS = 30_000;
const cache = new Map();
const inflight = new Map();
const listeners = new Map();

function readCache(key) {
  const entry = cache.get(key);
  if (entry && entry.expiresAt > Date.now()) return entry.data;
  if (entry) cache.delete(key);
  return undefined;
}

export function invalidateCache(prefix) {
  for (const key of new Set([...cache.keys(), ...inflight.keys(), ...listeners.keys()])) {
    if (prefix && !key.startsWith(prefix)) continue;
    cache.delete(key);
    const request = inflight.get(key);
    if (request) request.valid = false;
    inflight.delete(key);
    for (const listener of listeners.get(key) || []) listener({ invalidated: true });
  }
}

function requestData(key, fetcher) {
  if (key && inflight.has(key)) return inflight.get(key);
  const request = { valid: true, promise: null };
  request.promise = Promise.resolve().then(fetcher).then((data) => {
    if (key && request.valid && inflight.get(key) === request) {
      cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
      for (const listener of listeners.get(key) || []) listener({ data });
    }
    return data;
  }, (error) => {
    if (key && request.valid && inflight.get(key) === request) {
      for (const listener of listeners.get(key) || []) listener({ error: error.message });
    }
    throw error;
  });
  if (key) {
    inflight.set(key, request);
    // Handle both outcomes on this cleanup branch: an ignored finally() would
    // create a second rejected promise when the GET fails.
    const finish = () => { if (inflight.get(key) === request) inflight.delete(key); };
    request.promise.then(finish, finish);
  }
  return request;
}

export function useApi(fetcher, deps = [], opts = {}) {
  const cacheKey = opts.cacheKey || null;
  const initial = cacheKey ? readCache(cacheKey) : undefined;
  const [data, setData] = useState(initial !== undefined ? initial : null);
  const [loading, setLoading] = useState(initial === undefined);
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const sequence = useRef(0);

  const run = useCallback(() => {
    const token = ++sequence.current;
    setLoading(true);
    setError(null);
    const request = requestData(cacheKey, fetcherRef.current);
    const current = () => token === sequence.current && request.valid;
    return request.promise.then((next) => {
      if (current()) { setData(next); setError(null); setLoading(false); }
      return next;
    }, (failure) => {
      if (current()) { setError(failure.message); setLoading(false); }
      throw failure;
    });
  }, [cacheKey]);

  useEffect(() => {
    let subscribed = true;
    // A refresh in another mounted reader also settles this reader's older,
    // deduplicated request. It must not leave that reader loading forever.
    const receive = (result) => {
      if (result.invalidated) {
        // Let an explicit refetch immediately after invalidation start first.
        // Otherwise one mounted reader starts the replacement; its peers receive
        // the same result through the listeners instead of issuing duplicate GETs.
        Promise.resolve().then(() => {
          if (!subscribed || inflight.has(cacheKey) || readCache(cacheKey) !== undefined) return;
          run().catch(() => {});
        });
        return;
      }
      if ('data' in result) { setData(result.data); setError(null); }
      else setError(result.error);
      setLoading(false);
    };
    if (cacheKey) {
      if (!listeners.has(cacheKey)) listeners.set(cacheKey, new Set());
      listeners.get(cacheKey).add(receive);
    }
    const cached = cacheKey ? readCache(cacheKey) : undefined;
    if (cached !== undefined) {
      ++sequence.current;
      setData(cached); setLoading(false); setError(null);
    } else {
      setData(null);
      run().catch(() => {});
    }
    return () => {
      subscribed = false;
      ++sequence.current;
      const set = listeners.get(cacheKey);
      set?.delete(receive);
      if (set?.size === 0) listeners.delete(cacheKey);
    };
    // The caller names the values that require a new read; fetcher identity is
    // deliberately irrelevant (most callers pass an inline function).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, ...deps]);

  const refetch = useCallback(() => {
    if (cacheKey) {
      cache.delete(cacheKey);
      const previous = inflight.get(cacheKey);
      if (previous) previous.valid = false;
      inflight.delete(cacheKey);
    }
    const promise = run();
    // Button handlers commonly ignore the returned promise. Keep rejection
    // available to awaiting callers without an unhandled browser rejection.
    promise.catch(() => {});
    return promise;
  }, [cacheKey, run]);

  return { data, loading, error, refetch };
}

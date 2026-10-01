// workspace/src/hooks/useUrlFilters.js
import { useSearchParams } from 'react-router-dom';
import { useMemo, useCallback, startTransition } from 'react';

function normalizeCustomRange(from, to) {
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

// Explicit array keys distinguish one label containing a comma from old shared
// links whose single value was a comma-separated list.
export function readFilterList(params, key) {
  return params.has(`${key}[]`)
    ? params.getAll(`${key}[]`).filter(Boolean)
    : (params.get(key)?.split(',').filter(Boolean) || []);
}

export function writeFilterList(params, key, values) {
  params.delete(key);
  params.delete(`${key}[]`);
  const list = (values || []).filter(Boolean);
  if (list.some((value) => value.includes(','))) {
    for (const value of list) params.append(`${key}[]`, value);
  } else if (list.length) params.set(key, list.join(','));
}

export function useUrlFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchKey = searchParams.toString();

  const filters = useMemo(() => {
    const params = new URLSearchParams(searchKey);
    const customRange = normalizeCustomRange(params.get('from') || '', params.get('to') || '');
    // Parse cols param: comma-separated visible column keys (conv, pcConv, pvConv)
    const colsRaw = params.get('cols');
    const cols = colsRaw ? colsRaw.split(',').filter(Boolean) : null; // null = not in URL

    return {
      range: params.get('range') || 'all',
      customRange,
      channels: readFilterList(params, 'ch'),
      labels: readFilterList(params, 'label'),
      platforms: readFilterList(params, 'platform'),
      selection: params.get('li')?.split(',').filter(Boolean) || [],
      brk: params.get('brk') || '',
      brkf: params.getAll('brkf').filter(Boolean),
      cols,  // string[] | null — null means "not set in URL, fall back to display config"
    };
  }, [searchKey]);

  const setFilters = useCallback((patch) => {
    // Wrap URL update in startTransition so heavy downstream selectors
    // (campM, buildScopedPlans, recharts) don't block the click handler.
    startTransition(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (patch.range !== undefined) {
          if (patch.range === 'all') next.delete('range');
          else next.set('range', patch.range);
          if (patch.range !== 'custom') { next.delete('from'); next.delete('to'); }
        }
        if (patch.customRange !== undefined) {
          const normalized = normalizeCustomRange(patch.customRange.from || '', patch.customRange.to || '');
          if (normalized.from) next.set('from', normalized.from);
          else next.delete('from');
          if (normalized.to) next.set('to', normalized.to);
          else next.delete('to');
        }
        if (patch.channels !== undefined) {
          writeFilterList(next, 'ch', patch.channels);
        }
        if (patch.labels !== undefined) {
          writeFilterList(next, 'label', patch.labels);
        }
        if (patch.platforms !== undefined) {
          writeFilterList(next, 'platform', patch.platforms);
        }
        if (patch.selection !== undefined) {
          patch.selection.length ? next.set('li', patch.selection.join(',')) : next.delete('li');
        }
        if (patch.brk !== undefined) {
          patch.brk ? next.set('brk', patch.brk) : next.delete('brk');
        }
        if (patch.brkf !== undefined) {
          next.delete('brkf');
          for (const v of (patch.brkf || [])) {
            if (v) next.append('brkf', v);
          }
        }
        if (patch.cols !== undefined) {
          if (Array.isArray(patch.cols) && patch.cols.length > 0) {
            next.set('cols', patch.cols.join(','));
          } else {
            next.delete('cols');
          }
        }

        return next.toString() === prev.toString() ? prev : next;
      }, { replace: true });
    });
  }, [setSearchParams]);

  return { filters, setFilters };
}

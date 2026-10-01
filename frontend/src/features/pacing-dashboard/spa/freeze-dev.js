const isDev = !!import.meta.env?.DEV;

export function freezeDev(value) {
  if (isDev && value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
  }
  return value;
}

export function freezeDevArray(values) {
  if (!isDev) return values;
  for (const value of values) freezeDev(value);
  return freezeDev(values);
}

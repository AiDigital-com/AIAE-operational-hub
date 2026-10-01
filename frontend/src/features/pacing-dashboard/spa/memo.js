// workspace/src/lib/dashboard/memo.js
export function createSelector(inputSelectors, combiner) {
  let lastInputs = null;
  let lastResult = null;

  return (...args) => {
    const inputs = inputSelectors.map((sel) => sel(...args));
    if (lastInputs && inputs.every((v, i) => v === lastInputs[i])) {
      return lastResult;
    }
    lastInputs = inputs;
    lastResult = combiner(...inputs);
    return lastResult;
  };
}

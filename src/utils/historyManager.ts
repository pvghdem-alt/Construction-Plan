export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const DEFAULT_MAX_HISTORY = 60;

export function createHistory<T>(initial: T): HistoryState<T> {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function pushHistory<T>(
  state: HistoryState<T>,
  next: T,
  maxEntries = DEFAULT_MAX_HISTORY
): HistoryState<T> {
  if (Object.is(state.present, next)) {
    return state;
  }
  const nextPast = [...state.past, state.present];
  if (nextPast.length > maxEntries) {
    nextPast.splice(0, nextPast.length - maxEntries);
  }
  return {
    past: nextPast,
    present: next,
    future: [],
  };
}

export function replacePresentHistory<T>(
  state: HistoryState<T>,
  next: T
): HistoryState<T> {
  if (Object.is(state.present, next)) {
    return state;
  }
  return {
    ...state,
    present: next,
  };
}

export function commitBaselineToHistory<T>(
  state: HistoryState<T>,
  baseline: T,
  next: T,
  maxEntries = DEFAULT_MAX_HISTORY
): HistoryState<T> {
  if (Object.is(baseline, next)) {
    return state;
  }
  const nextPast = [...state.past, baseline];
  if (nextPast.length > maxEntries) {
    nextPast.splice(0, nextPast.length - maxEntries);
  }
  return {
    past: nextPast,
    present: next,
    future: [],
  };
}

export function undoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.past.length === 0) {
    return state;
  }
  const previous = state.past[state.past.length - 1];
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future],
  };
}

export function redoHistory<T>(state: HistoryState<T>): HistoryState<T> {
  if (state.future.length === 0) {
    return state;
  }
  const next = state.future[0];
  return {
    past: [...state.past, state.present],
    present: next,
    future: state.future.slice(1),
  };
}

export function resetHistory<T>(next: T): HistoryState<T> {
  return {
    past: [],
    present: next,
    future: [],
  };
}

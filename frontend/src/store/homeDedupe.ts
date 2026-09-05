// @ts-nocheck
import { create } from "zustand";

// Which titles each home row is showing, so lower rows can skip titles already shown above them.
export const useHomeDedupe = create((set) => ({
  rows: {},
  claim: (key, index, ids) =>
    set((s) => {
      const prev = s.rows[key];
      if (prev && prev.index === index && prev.ids.length === ids.length && prev.ids.every((v, i) => v === ids[i])) return s;
      return { rows: { ...s.rows, [key]: { index, ids } } };
    }),
  release: (key) => set((s) => { if (!s.rows[key]) return s; const rows = { ...s.rows }; delete rows[key]; return { rows }; }),
}));

export const itemKey = (i) => `${i.type || "movie"}-${i.tmdbId || i.id}`;

export function claimedAbove(rows, index) {
  const set = new Set();
  Object.values(rows).forEach((r) => { if (r.index < index) r.ids.forEach((id) => set.add(id)); });
  return set;
}

// @ts-nocheck
import { create } from "zustand";

export const useAuthModal = create((set) => ({
  open: false,
  mode: "login",
  openModal: (mode = "login") => set({ open: true, mode }),
  setMode: (mode) => set({ mode }),
  close: () => set({ open: false }),
}));

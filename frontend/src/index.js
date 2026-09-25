// @ts-nocheck
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import "./CustomClassNameSetup";
import "./playerQualityBootstrap";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "react-redux";
import { RouterProvider } from "react-router-dom";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import "@/index.css";
import "@/scroll-stability.css";

import store from "./store";
import { extendedApi } from "./store/slices/configuration";
import palette from "./theme/palette";
import router from "./routes";
import MainLoadingScreen from "./components/MainLoadingScreen";
import GlobalErrorBoundary from "./components/GlobalErrorBoundary";

function installPublicCatalogueRequestBudget() {
  if (typeof window === "undefined" || window.__flixitCatalogueBudgetInstalled) return;
  window.__flixitCatalogueBudgetInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const memo = new Map();
  const MAX_HOME_TMDB_PAGE = 2;
  const MAX_CATALOGUE_CONCURRENCY = 4;
  const queue = [];
  let activeCatalogueRequests = 0;

  const abortError = () => {
    try {
      return new DOMException("The operation was aborted.", "AbortError");
    } catch {
      const error = new Error("The operation was aborted.");
      error.name = "AbortError";
      return error;
    }
  };

  const drainQueue = () => {
    while (activeCatalogueRequests < MAX_CATALOGUE_CONCURRENCY && queue.length) {
      const job = queue.shift();
      if (!job || job.settled) continue;
      if (job.signal?.aborted) {
        job.settled = true;
        job.cleanup();
        job.reject(abortError());
        continue;
      }

      activeCatalogueRequests += 1;
      job.started = true;
      Promise.resolve()
        .then(job.run)
        .then(job.resolve, job.reject)
        .finally(() => {
          job.settled = true;
          job.cleanup();
          activeCatalogueRequests = Math.max(0, activeCatalogueRequests - 1);
          drainQueue();
        });
    }
  };

  const runBudgeted = (run, signal) => {
    if (signal?.aborted) return Promise.reject(abortError());

    return new Promise((resolve, reject) => {
      const job = {
        run,
        signal,
        resolve,
        reject,
        started: false,
        settled: false,
        cleanup: () => {},
      };

      const onAbort = () => {
        if (job.started || job.settled) return;
        const index = queue.indexOf(job);
        if (index >= 0) queue.splice(index, 1);
        job.settled = true;
        job.cleanup();
        reject(abortError());
      };

      job.cleanup = () => signal?.removeEventListener?.("abort", onAbort);
      signal?.addEventListener?.("abort", onAbort, { once: true });
      queue.push(job);
      drainQueue();
    });
  };

  const isHome = () => {
    const raw = String(window.location.pathname || "/");
    const pathname = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
    return (
      pathname === "/" ||
      pathname === "/browse" ||
      pathname === "/browse/genre/movie" ||
      pathname === "/browse/genre/tv" ||
      pathname === "/browse/latest" ||
      pathname === "/browse/trending"
    );
  };

  const isSafeCataloguePath = (pathname) =>
    pathname.startsWith("/api/public/tmdb/") ||
    pathname.startsWith("/api/public/homepage/") ||
    pathname.startsWith("/api/public/new-releases/") ||
    pathname === "/api/public/sections" ||
    pathname === "/api/public/available-sections" ||
    pathname === "/api/public/flixit-top10";

  const ttlFor = (pathname) => {
    if (pathname === "/api/public/flixit-top10") return 60_000;
    if (pathname === "/api/public/sections" || pathname === "/api/public/available-sections") return 5 * 60_000;
    return 10 * 60_000;
  };

  const cacheKeyFor = (url) => {
    const normalized = new URL(url.toString());
    normalized.searchParams.delete("_flix_window");
    normalized.searchParams.sort();
    return normalized.toString();
  };

  window.fetch = async (input, init = undefined) => {
    let url;
    try {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      url = new URL(raw, window.location.origin);
    } catch {
      return nativeFetch(input, init);
    }

    const method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    if (method !== "GET" || url.origin !== window.location.origin || !isSafeCataloguePath(url.pathname)) {
      return nativeFetch(input, init);
    }

    const homeRequest = isHome();
    if (homeRequest && url.pathname.startsWith("/api/public/tmdb/")) {
      const page = Number(url.searchParams.get("page") || 1);
      if (page > MAX_HOME_TMDB_PAGE) {
        return new Response(
          JSON.stringify({ items: [], results: [], page, total: 0, total_pages: MAX_HOME_TMDB_PAGE }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const key = cacheKeyFor(url);
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && hit.expiresAt > now) {
      try {
        const response = await hit.promise;
        return response.clone();
      } catch {
        memo.delete(key);
      }
    }

    const signal = init?.signal || (input instanceof Request ? input.signal : undefined);
    const request = () => nativeFetch(input, init);
    const promise = (homeRequest ? runBudgeted(request, signal) : request())
      .then((response) => {
        if (!response.ok) memo.delete(key);
        return response;
      })
      .catch((error) => {
        memo.delete(key);
        throw error;
      });

    memo.set(key, { expiresAt: now + ttlFor(url.pathname), promise });
    const response = await promise;
    return response.clone();
  };
}

function installPlayerResolutionCoalescing() {
  if (typeof window === "undefined" || window.__flixitPlayerRequestCacheInstalled) return;
  window.__flixitPlayerRequestCacheInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const memo = new Map();
  const PLAYER_TTL_MS = 2 * 60 * 1000;
  const MAX_ENTRIES = 40;

  const isPlayerResolution = (pathname) =>
    /^\/api\/player\/(?:movie\/\d+|tv\/\d+\/\d+\/\d+)$/.test(pathname);

  window.fetch = async (input, init = undefined) => {
    let url;
    try {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      url = new URL(raw, window.location.origin);
    } catch {
      return nativeFetch(input, init);
    }

    const method = String(init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    if (method !== "GET" || url.origin !== window.location.origin || !isPlayerResolution(url.pathname)) {
      return nativeFetch(input, init);
    }

    const key = url.pathname;
    const now = Date.now();
    const hit = memo.get(key);
    if (hit && hit.expiresAt > now) {
      try {
        const response = await hit.promise;
        return response.clone();
      } catch {
        memo.delete(key);
      }
    }

    // Deliberately do not share the caller's AbortSignal with the underlying
    // resolver. Hero/Detail may unmount immediately after navigation to Watch;
    // allowing that unmount to abort the shared request would force Watch to
    // resolve the same title from scratch again.
    let sharedInit = init;
    if (init?.signal) {
      const { signal: _ignored, ...rest } = init;
      sharedInit = rest;
    }

    const promise = nativeFetch(input, sharedInit)
      .then((response) => {
        if (!response.ok) memo.delete(key);
        return response;
      })
      .catch((error) => {
        memo.delete(key);
        throw error;
      });

    memo.set(key, { expiresAt: now + PLAYER_TTL_MS, promise });
    if (memo.size > MAX_ENTRIES) {
      [...memo.entries()]
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)
        .slice(0, memo.size - MAX_ENTRIES)
        .forEach(([oldKey]) => memo.delete(oldKey));
    }

    const response = await promise;
    return response.clone();
  };
}

installPublicCatalogueRequestBudget();
installPlayerResolutionCoalescing();

const warmConfiguration = () => {
  try { store.dispatch(extendedApi.endpoints.getConfiguration.initiate(undefined)); } catch {}
};
if (typeof window !== "undefined" && "requestIdleCallback" in window) {
  window.requestIdleCallback(warmConfiguration, { timeout: 2200 });
} else if (typeof window !== "undefined") {
  window.setTimeout(warmConfiguration, 1200);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <GlobalErrorBoundary>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createTheme({ palette })}>
          <RouterProvider
            router={router}
            fallbackElement={<MainLoadingScreen />}
          />
        </ThemeProvider>
      </QueryClientProvider>
    </Provider>
  </GlobalErrorBoundary>
);
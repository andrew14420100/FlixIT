// @ts-nocheck
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import "./CustomClassNameSetup";
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

// Availability is now annotated by the backend and enhanced only on TV detail
// routes. The previous global episode interceptor blocked every season response
// while it opened one player request per episode, so it is intentionally gone.

/**
 * Home used to ask the same public TMDB/catalogue pages from HomePage and
 * HomeSmartSections at the same time (and requested up to 8-10 pages per row).
 * Four TMDB pages already provide up to ~80 candidates — more than the 50 cards
 * a row can expose. Keep a strict Home request budget and coalesce identical
 * public GETs in memory. This wrapper never touches player, trailer, artwork,
 * account or season-availability requests.
 */
function installPublicCatalogueRequestBudget() {
  if (typeof window === "undefined" || window.__flixitCatalogueBudgetInstalled) return;
  window.__flixitCatalogueBudgetInstalled = true;

  const nativeFetch = window.fetch.bind(window);
  const memo = new Map();
  const MAX_HOME_TMDB_PAGE = 4;

  const isHome = () => window.location.pathname === "/" || window.location.pathname === "/browse";
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

    if (isHome() && url.pathname.startsWith("/api/public/tmdb/")) {
      const page = Number(url.searchParams.get("page") || 1);
      if (page > MAX_HOME_TMDB_PAGE) {
        return new Response(
          JSON.stringify({ items: [], results: [], page, total: 0, total_pages: MAX_HOME_TMDB_PAGE }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    const key = url.toString();
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

    const promise = nativeFetch(input, init).then((response) => {
      if (!response.ok) memo.delete(key);
      return response;
    }).catch((error) => {
      memo.delete(key);
      throw error;
    });
    memo.set(key, { expiresAt: now + ttlFor(url.pathname), promise });
    const response = await promise;
    return response.clone();
  };
}

installPublicCatalogueRequestBudget();

queueMicrotask(() => {
  store.dispatch(extendedApi.endpoints.getConfiguration.initiate(undefined));
});

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
);

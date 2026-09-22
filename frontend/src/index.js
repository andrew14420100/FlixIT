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
// routes. The previous global fetch interceptor blocked every season response
// while it opened one player request per episode, which was a major source of
// slow Detail loads and duplicated network work.
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

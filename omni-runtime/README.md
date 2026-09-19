# FlixIT local Node runtime

This directory contains a minimal Stremio-compatible staging harness used only to validate process management and localhost networking between FastAPI (`:8001`) and Node (`:7001`).

It exposes `GET /manifest.json`, `GET /health`, and empty `GET /stream/{movie|series}/{id}.json` responses. It contains no provider or scraping logic.

Enable it in Emergent with the variables shown in `backend/.env.omni.example`. The FastAPI lifespan starts `npm start`, waits until `/manifest.json` is healthy, and terminates only the Node process it created during shutdown.

A compatible authorized Node runtime can later replace this directory without changing the FastAPI lifecycle integration.

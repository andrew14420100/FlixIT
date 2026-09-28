// @ts-nocheck

// Installed before the public catalogue renders. Some valid StreamingCommunity
// title logos were being discarded client-side when the provider title was a
// parent/variant of the catalogue title. If SC actually returned a logo, keep
// that asset eligible and force remote SC CDN logos through the local artwork
// proxy so browser CORS/CDN quirks cannot make an existing logo disappear.

const FLAG = "__flixitScLogoRecoveryV1";
const ARTWORK_PROXY = "/api/public/artwork-proxy";

function isScLogoEntry(value: any) {
  const source = String(value?.logo_source || "").trim().toLowerCase();
  const url = String(value?.logo_url || "").trim();
  if (!url) return false;
  return (
    source === "streamingcommunity" ||
    source.startsWith("streamingcommunity_") ||
    /streamingcommunity|streamingunity/i.test(url)
  );
}

function proxiedScUrl(value: any) {
  const url = String(value || "").trim();
  if (!url) return url;
  if (url.startsWith(`${ARTWORK_PROXY}?`) || url.startsWith("/")) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  if (!/streamingcommunity|streamingunity/i.test(url)) return url;
  return `${ARTWORK_PROXY}?url=${encodeURIComponent(url)}`;
}

function normalizeEntry(value: any) {
  if (!value || typeof value !== "object" || !isScLogoEntry(value)) return value;
  return {
    ...value,
    active: true,
    logo_url: proxiedScUrl(value.logo_url),
    logo_source: value.logo_source || "streamingcommunity",
    // The old generic-parent guard uses this field to null the logo. The backend
    // has already resolved the SC asset, so do not reject it a second time.
    sc_provider_name: null,
    logo_identity_rejected: false,
  };
}

function normalizePayload(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload?.items)) {
    return { ...payload, items: payload.items.map(normalizeEntry) };
  }
  return normalizeEntry(payload);
}

function shouldPatch(url: URL) {
  return (
    url.pathname === "/api/public/sc-artwork/batch" ||
    url.pathname.startsWith("/api/public/official-artwork/")
  );
}

if (typeof window !== "undefined" && !(window as any)[FLAG]) {
  (window as any)[FLAG] = true;
  const nativeFetch = window.fetch.bind(window);

  window.fetch = async (input: any, init?: RequestInit) => {
    const response = await nativeFetch(input, init);

    let url: URL;
    try {
      const raw = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
      url = new URL(raw, window.location.origin);
    } catch {
      return response;
    }

    if (!response.ok || url.origin !== window.location.origin || !shouldPatch(url)) {
      return response;
    }

    try {
      const payload = await response.clone().json();
      const normalized = normalizePayload(payload);
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch {
      return response;
    }
  };
}

export {};

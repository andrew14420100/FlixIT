// @ts-nocheck
import { useEffect } from "react";

const LEGACY_HOST_RE = /^https?:\/\/cdn\.streamingcommunityz\.ninja\/images\/([^?#]+)([?#].*)?$/i;
const CANDIDATE_BASES = [
  "https://cdn.streamingunity-premium.to/images/",
  "https://cdn.streamingunity.win/images/",
  "https://cdn.streamingunity.vip/images/",
];

function imageName(url: string) {
  const legacy = String(url || "").match(LEGACY_HOST_RE);
  if (legacy?.[1]) return legacy[1];
  for (const base of CANDIDATE_BASES) {
    if (String(url || "").startsWith(base)) {
      return String(url || "").slice(base.length).split(/[?#]/, 1)[0];
    }
  }
  return "";
}

function candidate(name: string, index: number) {
  const base = CANDIDATE_BASES[Math.max(0, Math.min(index, CANDIDATE_BASES.length - 1))];
  return `${base}${String(name || "").replace(/^\/+/, "")}`;
}

function repairSrcset(value: string) {
  return String(value || "")
    .split(",")
    .map((part) => {
      const [url, ...descriptor] = part.trim().split(/\s+/);
      const name = imageName(url);
      const next = name ? candidate(name, 0) : url;
      return [next, ...descriptor].filter(Boolean).join(" ");
    })
    .join(", ");
}

function primeElement(node: Element) {
  if (node instanceof HTMLImageElement) {
    const current = node.getAttribute("src") || node.currentSrc || "";
    const name = imageName(current);
    if (name && LEGACY_HOST_RE.test(current)) {
      node.dataset.flixitScImageName = name;
      node.dataset.flixitScCdnAttempt = "0";
      node.removeAttribute("srcset");
      node.src = candidate(name, 0);
    }

    const srcset = node.getAttribute("srcset");
    if (srcset && /cdn\.streamingcommunityz\.ninja/i.test(srcset)) {
      node.setAttribute("srcset", repairSrcset(srcset));
    }
  }

  if (node instanceof HTMLSourceElement) {
    const srcset = node.getAttribute("srcset");
    if (srcset && /cdn\.streamingcommunityz\.ninja/i.test(srcset)) {
      node.setAttribute("srcset", repairSrcset(srcset));
    }
  }
}

function scan(root: ParentNode) {
  if (root instanceof Element) primeElement(root);
  root.querySelectorAll?.("img, source").forEach((node) => primeElement(node));
}

export default function ScCdnRecovery() {
  useEffect(() => {
    const onError = (event: Event) => {
      const img = event.target as HTMLImageElement | null;
      if (!(img instanceof HTMLImageElement)) return;

      const src = img.getAttribute("src") || img.currentSrc || "";
      const name = img.dataset.flixitScImageName || imageName(src);
      if (!name) return;

      const currentAttempt = Number(img.dataset.flixitScCdnAttempt || 0);
      const nextAttempt = currentAttempt + 1;
      if (nextAttempt >= CANDIDATE_BASES.length) return;

      img.dataset.flixitScImageName = name;
      img.dataset.flixitScCdnAttempt = String(nextAttempt);
      img.removeAttribute("srcset");
      img.src = candidate(name, nextAttempt);
    };

    // One initial pass repairs legacy URLs already present at shell mount. For
    // images created later we do not need a document-wide MutationObserver:
    // the capture-phase error event identifies both legacy and current SC CDN
    // URLs and switches to the next healthy CDN only when a request actually
    // fails. This removes work from every card insertion/slider movement.
    scan(document);
    document.addEventListener("error", onError, true);

    return () => {
      document.removeEventListener("error", onError, true);
    };
  }, []);

  return null;
}

// @ts-nocheck
import { lazy, Suspense } from "react";
import { usePortalData } from "src/providers/PortalProvider";

const VideoPortalContainer = lazy(() => import("./VideoPortalContainer"));

/**
 * The legacy portal imports framer-motion and several animation modules. Modern
 * Home cards use their own lightweight ExpandOverlay, so load this old portal
 * only if a legacy consumer actually puts media data in PortalProvider.
 */
export default function LazyVideoPortalContainer() {
  const { miniModalMediaData, anchorElement } = usePortalData();
  if (!miniModalMediaData || !anchorElement) return null;
  return (
    <Suspense fallback={null}>
      <VideoPortalContainer />
    </Suspense>
  );
}

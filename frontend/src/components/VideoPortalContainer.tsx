// @ts-nocheck
import { useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import Portal from "@mui/material/Portal";

import VideoCardPortal from "./VideoCardPortal";
import MotionContainer from "./animate/MotionContainer";
import {
  varZoomIn,
  varZoomInLeft,
  varZoomInRight,
} from "./animate/variants/zoom/ZoomIn";
import { usePortalData } from "src/providers/PortalProvider";

export default function VideoPortalContainer() {
  const { miniModalMediaData, anchorElement, mediaType } = usePortalData();
  const container = useRef(null);
  const rect = anchorElement?.getBoundingClientRect();

  const hasToRender = !!miniModalMediaData && !!anchorElement;
  let isFirstElement = false;
  let isLastElement = false;
  let variant = varZoomIn;
  
  if (hasToRender) {
    const parentElement = anchorElement.closest(".slick-active");
    const nextSiblingOfParentElement = parentElement?.nextElementSibling;
    const previousSiblingOfParentElement =
      parentElement?.previousElementSibling;
    if (!previousSiblingOfParentElement?.classList.contains("slick-active")) {
      isFirstElement = true;
      variant = varZoomInLeft;
    } else if (
      !nextSiblingOfParentElement?.classList.contains("slick-active")
    ) {
      isLastElement = true;
      variant = varZoomInRight;
    }
  }

  return (
    <>
      <AnimatePresence mode="wait">
        {hasToRender && (
          <Portal container={container.current}>
            <VideoCardPortal
              video={miniModalMediaData}
              anchorElement={anchorElement}
              mediaType={mediaType}
            />
          </Portal>
        )}
      </AnimatePresence>
      <MotionContainer open={hasToRender} initial="initial">
        <motion.div
          ref={container}
          variants={variant}
          data-portal-container="true"
          style={{
            // ✅ Very high z-index to appear above everything
            zIndex: 10000,
            position: "absolute",
            display: "inline-block",
            // ✅ Ensure pointer events work
            pointerEvents: hasToRender ? "auto" : "none",
            // ✅ Smooth transition
            transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            ...(rect && {
              // ✅ Position portal EXACTLY over the card (no gap!)
              // The card is scaled 1.5x, so we position to match
              top: rect.top + window.pageYOffset - 0.75 * rect.height,
              ...(isLastElement
                ? {
                    right: document.documentElement.clientWidth - rect.right,
                  }
                : {
                    left: isFirstElement
                      ? rect.left
                      : rect.left - 0.25 * rect.width,
                  }),
            }),
          }}
        />
      </MotionContainer>
    </>
  );
}

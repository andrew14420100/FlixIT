// @ts-nocheck
const DISTANCE = 0;
const IN = { scale: 1, opacity: 1 };
const OUT = { scale: 0, opacity: 0 };

// ✅ OPTIMIZED: Faster, smoother transitions like Streaming Community
const TRANSITION_ENTER = {
  duration: 0.25, // 1s → 0.25s (4x faster!)
  ease: [0.4, 0, 0.2, 1], // Material Design easing
};

const TRANSITION_EXIT = {
  duration: 0.2, // Fast exit
  ease: [0.4, 0, 1, 1], // Accelerated easing for exit
};

export const varZoomIn = {
  initial: OUT,
  animate: { ...IN, transition: TRANSITION_ENTER },
  exit: { ...OUT, transition: TRANSITION_EXIT },
};

export const varZoomInLeft = {
  initial: { ...OUT, translateX: -DISTANCE },
  animate: { ...IN, translateX: 0, transition: TRANSITION_ENTER },
  exit: { ...OUT, translateX: -DISTANCE, transition: TRANSITION_EXIT },
};

export const varZoomInRight = {
  initial: { ...OUT, translateX: DISTANCE },
  animate: { ...IN, translateX: 0, transition: TRANSITION_ENTER },
  exit: { ...OUT, translateX: DISTANCE, transition: TRANSITION_EXIT },
};

function MainLoadingScreen() {
  // Route chunks are prefetched aggressively; while React waits for the last few
  // bytes, keep the exact app background instead of flashing a spinner overlay.
  // This makes cached/fast navigations visually continuous and removes an
  // unnecessary animation from the main thread during startup.
  return (
    <div
      aria-hidden="true"
      data-testid="route-loading-surface"
      style={{
        position: "fixed",
        inset: 0,
        background: "#141414",
        pointerEvents: "none",
        zIndex: 0,
      }}
    />
  );
}

export default MainLoadingScreen;

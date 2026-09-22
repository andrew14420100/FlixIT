// @ts-nocheck
import { lazy, Suspense } from "react";
import { useAuthModal } from "src/store/authModal";

const AuthModal = lazy(() => import("./AuthModal"));

/**
 * AuthModal pulls in forms + framer-motion. None of that is needed until the
 * user actually opens Login/Register, so keep it out of the startup request and
 * parse path entirely.
 */
export default function LazyAuthModalMount() {
  const open = useAuthModal((state) => state.open);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <AuthModal />
    </Suspense>
  );
}

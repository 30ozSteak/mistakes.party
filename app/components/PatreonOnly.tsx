import type { ReactNode } from "react";
import { hasPatreonAccess } from "../lib/patreonAccess";

type PatreonOnlyProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

/**
 * Server-side visibility gate for Patreon-only content and feature controls.
 * Sensitive reads and mutations must also call hasPatreonAccess or
 * requirePatreonAccess at their own server boundary.
 */
export async function PatreonOnly({
  children,
  fallback = null,
}: PatreonOnlyProps) {
  return (await hasPatreonAccess()) ? children : fallback;
}

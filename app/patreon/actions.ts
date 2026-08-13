"use server";

import { redirect } from "next/navigation";
import {
  checkPatreonPassword,
  grantPatreonAccess,
  normalizePatreonReturnTo,
  revokePatreonAccess,
} from "../lib/patreonAccess";

export type PatreonUnlockState = {
  error: string | null;
};

export async function unlockPatreonAccess(
  _state: PatreonUnlockState,
  formData: FormData,
): Promise<PatreonUnlockState> {
  const passwordCheck = checkPatreonPassword(formData.get("password"));

  if (passwordCheck === "unconfigured") {
    return {
      error: "Member access is not configured yet. Please try again later.",
    };
  }
  if (passwordCheck !== "valid") {
    return { error: "That password did not open the door." };
  }
  if (!(await grantPatreonAccess())) {
    return {
      error: "Member access is not configured yet. Please try again later.",
    };
  }

  redirect(normalizePatreonReturnTo(formData.get("returnTo")));
}

export async function lockPatreonAccess(): Promise<void> {
  await revokePatreonAccess();
  redirect("/patreon");
}

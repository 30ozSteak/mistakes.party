"use client";

import { useActionState } from "react";
import { unlockPatreonAccess } from "../patreon/actions";

type PatreonUnlockFormProps = {
  returnTo: string;
};

export function PatreonUnlockForm({ returnTo }: PatreonUnlockFormProps) {
  const [state, action, pending] = useActionState(
    unlockPatreonAccess,
    { error: null },
  );

  return (
    <form action={action} className="patreon-unlock-form">
      <input name="returnTo" type="hidden" value={returnTo} />
      <label className="mono-label" htmlFor="patreon-password">
        MEMBER PASSWORD
      </label>
      <p className="patreon-password-hint" id="patreon-password-hint">
        Enter the shared password from the latest Patreon member post.
      </p>
      <input
        aria-describedby={
          state.error
            ? "patreon-password-hint patreon-password-error"
            : "patreon-password-hint"
        }
        aria-invalid={state.error ? true : undefined}
        autoComplete="current-password"
        disabled={pending}
        id="patreon-password"
        maxLength={512}
        name="password"
        required
        type="password"
      />
      {state.error ? (
        <p className="patreon-form-error" id="patreon-password-error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button disabled={pending} type="submit">
        {pending ? "CHECKING…" : "ENTER THE ROOM →"}
      </button>
    </form>
  );
}

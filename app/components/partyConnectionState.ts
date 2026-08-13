export type PartyConnectionState = "connecting" | "live" | "reconnecting";

const PARTY_CONNECTION_STATUS = {
  connecting: "CONNECTING…",
  reconnecting: "RECONNECTING…",
} as const;

export function getPartyConnectionStatus(
  state: PartyConnectionState,
): (typeof PARTY_CONNECTION_STATUS)[keyof typeof PARTY_CONNECTION_STATUS] | null {
  return state === "live" ? null : PARTY_CONNECTION_STATUS[state];
}

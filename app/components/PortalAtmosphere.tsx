export function PortalAtmosphere() {
  return (
    <div
      aria-hidden="true"
      className="portal-atmosphere"
      data-testid="portal-atmosphere"
    >
      <svg
        className="portal-blob"
        data-testid="ambient-blob"
        focusable="false"
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
      >
        <rect fill="currentColor" height="100" width="100" />
      </svg>
      <div className="portal-frost" />
    </div>
  );
}

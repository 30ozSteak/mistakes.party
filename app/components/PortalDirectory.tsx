import type { ReactNode } from "react";
import { ArrowIcon } from "./ArrowIcon";

export type PortalDestination = {
  href?: string;
  label: string;
  preview: {
    label: string;
    meta: string;
  };
  previewLabel: string;
  source:
    | "projects"
    | "games"
    | "websites"
    | "blogs"
    | "shop";
};

export function PortalDirectory({
  destinations,
  previews,
}: {
  destinations: PortalDestination[];
  previews?: ReactNode[];
}) {
  return (
    <nav aria-label="Elsewhere" className="portal-destinations" id="elsewhere">
      <ol>
        {destinations.map((destination, index) => {
          const panelId = `portal-panel-${destination.source}`;

          return (
            <li data-portal-section={destination.source} key={destination.source}>
              <details name="portal-directory">
                <summary aria-controls={panelId} className="portal-link">
                  <span className="portal-link-copy">
                    <span className="portal-name">{destination.label}</span>
                    <span className="portal-link-meta">
                      <span aria-hidden="true" className="portal-summary">
                        {destination.preview.meta}
                      </span>
                    </span>
                  </span>
                  <span className="portal-link-end">
                    <span aria-hidden="true" className="portal-arrow">
                      <ArrowIcon direction="right" />
                    </span>
                  </span>
                </summary>

                <div className="portal-panel" id={panelId}>
                  <div className="portal-preview">
                    <span className="portal-preview-label">
                      {destination.previewLabel}
                    </span>
                    {previews?.[index] ?? (
                      <div className="portal-preview-item">
                        <strong>{destination.preview.label}</strong>
                        <span>{destination.preview.meta}</span>
                      </div>
                    )}
                  </div>

                  {destination.href ? (
                    <div className="portal-panel-actions">
                      <a className="portal-external" href={destination.href}>
                        OPEN {destination.label} <ArrowIcon />
                      </a>
                    </div>
                  ) : null}
                </div>
              </details>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

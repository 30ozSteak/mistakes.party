import type { HomeCategory, HomeCategoryItem } from "../data";
import { ArrowIcon } from "./ArrowIcon";

function CategoryItem({ item }: { item: HomeCategoryItem }) {
  const content = (
    <>
      <strong>{item.title}</strong>
      <span>{item.meta}</span>
    </>
  );

  return item.href ? (
    <a className="portal-preview-item" href={item.href}>
      {content}
    </a>
  ) : (
    <div className="portal-preview-item">{content}</div>
  );
}

export function PortalDirectory({
  categories,
}: {
  categories: HomeCategory[];
}) {
  return (
    <nav aria-label="Elsewhere" className="portal-destinations" id="elsewhere">
      <ol>
        {categories.map((category) => {
          const panelId = `portal-panel-${category.source}`;

          return (
            <li data-portal-section={category.source} key={category.source}>
              <details name="portal-directory">
                <summary aria-controls={panelId} className="portal-link">
                  <span className="portal-link-copy">
                    <span className="portal-name">{category.label}</span>
                    <span className="portal-link-meta">
                      <span aria-hidden="true" className="portal-summary">
                        {category.items.length} ITEMS / {category.previewLabel}
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
                      {category.previewLabel}
                    </span>
                    <ol className="portal-preview-list">
                      {category.items.map((item) => (
                        <li key={item.id}>
                          <CategoryItem item={item} />
                        </li>
                      ))}
                    </ol>
                  </div>

                  {category.href ? (
                    <div className="portal-panel-actions">
                      <a className="portal-external" href={category.href}>
                        OPEN {category.label} <ArrowIcon />
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

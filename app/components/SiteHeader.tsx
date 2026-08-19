import Link from "next/link";
import { ArrowIcon } from "./ArrowIcon";

type SiteHeaderProps = {
  currentPage?: "blogs" | "patreon";
};

type NavigationLink = {
  arrow?: "left" | "up-right";
  href: string;
  label: string;
  next?: boolean;
};

export function SiteHeader({ currentPage }: SiteHeaderProps) {
  const links: NavigationLink[] = [
    { arrow: "left", href: "/", label: "INDEX", next: true },
    { href: "/blogs", label: "BLOGS", next: true },
    { href: "/patreon/room", label: "MEMBERS", next: true },
    {
      arrow: "up-right",
      href: "https://github.com/30ozSteak",
      label: "GITHUB",
    },
  ];

  function navigationLinks() {
    return links.map((link) =>
      link.next ? (
        <Link
          aria-current={
            (currentPage === "blogs" && link.href === "/blogs") ||
            (currentPage === "patreon" && link.href === "/patreon/room")
              ? "page"
              : undefined
          }
          href={link.href}
          key={link.href}
        >
          {link.arrow === "left" ? (
            <>
              <ArrowIcon direction="left" />{" "}
            </>
          ) : null}
          {link.label}
        </Link>
      ) : (
        <a href={link.href} key={link.href}>
          {link.label} {link.arrow ? <ArrowIcon direction={link.arrow} /> : null}
        </a>
      ),
    );
  }

  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        MISTAKES.PARTY
      </Link>

      <nav className="site-nav" aria-label="Primary navigation">
        {navigationLinks()}
        <a href="mailto:hello@mistakes.party">
          CONTACT <ArrowIcon />
        </a>
      </nav>

      <details className="mobile-menu">
        <summary aria-label="Open primary navigation" className="mobile-menu-toggle">
          <span aria-hidden="true" className="menu-icon">
            <span />
            <span />
            <span />
          </span>
        </summary>
        <nav aria-label="Mobile navigation" className="mobile-nav">
          {navigationLinks()}
          <a href="mailto:hello@mistakes.party">
            CONTACT <ArrowIcon />
          </a>
        </nav>
      </details>
    </header>
  );
}

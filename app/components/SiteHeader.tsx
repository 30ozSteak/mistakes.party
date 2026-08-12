"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type SiteHeaderProps = {
  currentPage?: "blogs";
  indexLink?: boolean;
};

type NavigationLink = {
  href: string;
  label: string;
  next?: boolean;
};

export function SiteHeader({ currentPage, indexLink = false }: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const desktopLinks: NavigationLink[] = indexLink
    ? [
        { href: "/", label: "← INDEX", next: true },
        { href: "/#work", label: "WORK", next: true },
        { href: "/blogs", label: "BLOGS", next: true },
        { href: "/#github", label: "GITHUB", next: true },
        { href: "/#about", label: "ABOUT", next: true },
      ]
    : [
        { href: "#work", label: "WORK" },
        { href: "/blogs", label: "BLOGS", next: true },
        { href: "#github", label: "GITHUB" },
        { href: "#about", label: "ABOUT" },
      ];
  const mobileLinks: NavigationLink[] = indexLink
    ? [
        { href: "/", label: "← INDEX", next: true },
        { href: "/#work", label: "WORK", next: true },
        { href: "/blogs", label: "BLOGS", next: true },
        { href: "/#github", label: "GITHUB", next: true },
        { href: "/#about", label: "ABOUT", next: true },
      ]
    : desktopLinks;

  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousRootOverflow = document.documentElement.style.overflow;
    const firstLink = menuRef.current?.querySelector<HTMLAnchorElement>("a");
    const backgroundElements = [
      ...document.querySelectorAll<HTMLElement>("main, footer, .skip-link"),
    ];
    const previousInertStates = backgroundElements.map((element) =>
      element.hasAttribute("inert"),
    );

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    backgroundElements.forEach((element) => {
      element.inert = true;
    });
    firstLink?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !menuRef.current) return;

      const focusable: HTMLElement[] = [
        ...(toggleRef.current ? [toggleRef.current] : []),
        ...menuRef.current.querySelectorAll<HTMLAnchorElement>("a"),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.style.overflow = previousRootOverflow;
      backgroundElements.forEach((element, index) => {
        element.inert = previousInertStates[index];
      });
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    const mobileQuery = window.matchMedia("(max-width: 700px)");

    function handleViewportChange(event: MediaQueryListEvent) {
      if (!event.matches) setMenuOpen(false);
    }

    mobileQuery.addEventListener("change", handleViewportChange);
    return () => mobileQuery.removeEventListener("change", handleViewportChange);
  }, []);

  function closeMenuForLink() {
    setMenuOpen(false);
    requestAnimationFrame(() => {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && menuRef.current?.contains(activeElement)) {
        activeElement.blur();
      }
    });
  }

  return (
    <header className="site-header" data-menu-open={menuOpen}>
      <Link
        aria-hidden={menuOpen || undefined}
        className="brand"
        href="/"
        inert={menuOpen || undefined}
        onClick={closeMenuForLink}
      >
        <span className="brand-mark" aria-hidden="true" />
        MISTAKES.PARTY
      </Link>

      <nav className="site-nav" aria-label="Primary navigation">
        {desktopLinks.map((link) =>
          link.next ? (
            <Link
              aria-current={
                currentPage === "blogs" && link.href === "/blogs"
                  ? "page"
                  : undefined
              }
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ) : (
            <a href={link.href} key={link.href}>
              {link.label}
            </a>
          ),
        )}
        <a href="mailto:hello@mistakes.party">CONTACT ↗</a>
      </nav>

      <button
        aria-controls="mobile-navigation"
        aria-expanded={menuOpen}
        aria-label={
          menuOpen ? "Close primary navigation" : "Open primary navigation"
        }
        className="mobile-menu-toggle"
        onClick={() => setMenuOpen((open) => !open)}
        ref={toggleRef}
        type="button"
      >
        <span aria-hidden="true" className="menu-icon">
          <span />
          <span />
          <span />
        </span>
      </button>

      <nav
        aria-hidden={!menuOpen}
        aria-label="Mobile navigation"
        className="mobile-nav"
        id="mobile-navigation"
        inert={!menuOpen ? true : undefined}
        ref={menuRef}
      >
        {mobileLinks.map((link) =>
          link.next ? (
            <Link
              aria-current={
                currentPage === "blogs" && link.href === "/blogs"
                  ? "page"
                  : undefined
              }
              href={link.href}
              key={link.href}
              onClick={closeMenuForLink}
            >
              {link.label}
            </Link>
          ) : (
            <a href={link.href} key={link.href} onClick={closeMenuForLink}>
              {link.label}
            </a>
          ),
        )}
        <a href="mailto:hello@mistakes.party" onClick={closeMenuForLink}>
          CONTACT <span aria-hidden="true">↗</span>
        </a>
      </nav>
    </header>
  );
}

import Link from "next/link";

type SiteHeaderProps = {
  indexLink?: boolean;
};

export function SiteHeader({ indexLink = false }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        MISTAKES.PARTY
      </Link>

      <nav className="site-nav" aria-label="Primary navigation">
        {indexLink ? (
          <Link href="/">← INDEX</Link>
        ) : (
          <>
            <a href="#work">WORK</a>
            <a href="#github">GITHUB</a>
            <a href="#about">ABOUT</a>
          </>
        )}
        <a href="mailto:hello@mistakes.party">CONTACT ↗</a>
      </nav>
    </header>
  );
}

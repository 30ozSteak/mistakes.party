export type Project = {
  slug: string;
  title: string;
  description: string;
  category: "WEBSITES" | "TOOLS" | "EXPERIMENTS";
  year: string;
  kind: string;
  role: string;
  stack: string;
  status: string;
  context: string;
  move: string;
  outcome: string;
  source: string;
  launch?: string;
};

export type ArchiveSourceProvider = "GITHUB" | "X" | "EMAIL";

export type ArchiveLink = {
  slug: string;
  label: string;
  category: "WEBSITES" | "TOOLS" | "EXPERIMENTS" | "PUBLIC CODE" | "ELSEWHERE";
  meta: string;
  description: string;
  href: string;
  sourceProvider: ArchiveSourceProvider;
  sourceLabel: string;
};

export const projects: Project[] = [
  {
    slug: "mistakes-party",
    title: "THIS INDEX",
    description:
      "The site you are looking at: a loud, responsive home for work, code, experiments, and the occasional useful mistake.",
    category: "WEBSITES",
    year: "2026",
    kind: "WEB / INDEX",
    role: "DESIGN + DEVELOPMENT",
    stack: "NEXT / TYPESCRIPT / CSS",
    status: "ONGOING",
    context:
      "Most portfolios make the work fight through polish, panels, and presentation. This one needed to feel more like a poster you can use.",
    move:
      "Make navigation the visual language: enormous type, hard rules, numbered links, one acid marker, and nothing ornamental that cannot earn its space.",
    outcome:
      "A responsive single-page index with durable internal routes, live GitHub data, and a deliberately small visual vocabulary.",
    source: "https://github.com/30ozSteak/mistakes.party",
  },
  {
    slug: "lighthouse-checker",
    title: "LIGHTHOUSE CHECKER",
    description:
      "A small public tool for keeping web performance checks close at hand.",
    category: "TOOLS",
    year: "PUBLIC",
    kind: "TOOL / CODE",
    role: "DEVELOPMENT",
    stack: "OPEN SOURCE",
    status: "ARCHIVE",
    context:
      "Performance checks are useful. Performance-checking workflows are often buried beneath more ceremony than the task needs.",
    move:
      "Keep the utility focused and keep the implementation public, so the source is as easy to inspect as the idea is to understand.",
    outcome:
      "A compact artifact in the public code archive. The repository is the launch page, changelog, and record of the experiment.",
    source: "https://github.com/30ozSteak/lighthouse-checker",
    launch: "https://github.com/30ozSteak/lighthouse-checker",
  },
  {
    slug: "itadw",
    title: "ITADW",
    description:
      "An early code experiment preserved with its attempts and useful mistakes intact.",
    category: "EXPERIMENTS",
    year: "PUBLIC",
    kind: "EXPERIMENT / CODE",
    role: "DEVELOPMENT",
    stack: "OPEN SOURCE",
    status: "ARCHIVE",
    context:
      "Some projects begin as a question rather than a brief. The useful part is often the attempt, not a manufactured success story.",
    move:
      "Keep the scope small, publish the source, and let the artifact remain open-ended rather than rewriting it as something more finished.",
    outcome:
      "A public-code experiment preserved as part of the wider archive: available to inspect, fork, or simply leave as evidence of the work.",
    source: "https://github.com/30ozSteak/ITADW",
    launch: "https://github.com/30ozSteak/ITADW",
  },
];

export const archiveLinks = [
  {
    slug: "gists-and-scraps",
    label: "GISTS + SCRAPS",
    category: "PUBLIC CODE",
    meta: "NOTES / SNIPPETS",
    description: "Smaller ideas, utility fragments, tests, and code that never needed a full repository.",
    href: "https://gist.github.com/30ozSteak",
    sourceProvider: "GITHUB",
    sourceLabel: "VIEW ON GITHUB ↗",
  },
  {
    slug: "ezrig",
    label: "EZRIG",
    category: "EXPERIMENTS",
    meta: "FORK / RIGGING",
    description: "A rigging project fork kept in the public working set.",
    href: "https://github.com/30ozSteak/Ezrig",
    sourceProvider: "GITHUB",
    sourceLabel: "VIEW ON GITHUB ↗",
  },
  {
    slug: "applause-button",
    label: "APPLAUSE BUTTON",
    category: "WEBSITES",
    meta: "FORK / WEB",
    description: "A small web-interaction fork saved for reference and reuse.",
    href: "https://github.com/30ozSteak/applause-button",
    sourceProvider: "GITHUB",
    sourceLabel: "VIEW ON GITHUB ↗",
  },
  {
    slug: "teller",
    label: "TELLER",
    category: "TOOLS",
    meta: "FORK / TOOLING",
    description: "A tooling fork from the wider public code archive.",
    href: "https://github.com/30ozSteak/teller",
    sourceProvider: "GITHUB",
    sourceLabel: "VIEW ON GITHUB ↗",
  },
  {
    slug: "interviews",
    label: "INTERVIEWS",
    category: "PUBLIC CODE",
    meta: "FORK / REFERENCE",
    description: "A practical reference collection for interviews and preparation.",
    href: "https://github.com/30ozSteak/interviews",
    sourceProvider: "GITHUB",
    sourceLabel: "VIEW ON GITHUB ↗",
  },
  {
    slug: "dispatches",
    label: "DISPATCHES",
    category: "ELSEWHERE",
    meta: "X / NOTES",
    description: "Short updates, works in progress, links, and the occasional mistake.",
    href: "https://x.com/iaaafm",
    sourceProvider: "X",
    sourceLabel: "VIEW ON X ↗",
  },
  {
    slug: "start-a-conversation",
    label: "START A CONVERSATION",
    category: "ELSEWHERE",
    meta: "EMAIL / HELLO",
    description: "For collaborations, useful problems, and mistakes worth making.",
    href: "mailto:hello@mistakes.party",
    sourceProvider: "EMAIL",
    sourceLabel: "SEND AN EMAIL ↗",
  },
] as const satisfies readonly ArchiveLink[];

const archiveSlugs = new Set<string>();
for (const link of archiveLinks) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(link.slug)) {
    throw new Error(`Unsafe archive slug: ${link.slug}`);
  }
  if (archiveSlugs.has(link.slug)) {
    throw new Error(`Duplicate archive slug: ${link.slug}`);
  }
  archiveSlugs.add(link.slug);
}

export function getProject(slug: string) {
  return projects.find((project) => project.slug === slug);
}

export function getArchiveLink(slug: string) {
  return archiveLinks.find((link) => link.slug === slug);
}

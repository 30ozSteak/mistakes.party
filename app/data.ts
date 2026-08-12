export type Project = {
  slug: string;
  title: string;
  description: string;
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

export const projects: Project[] = [
  {
    slug: "mistakes-party",
    title: "THIS INDEX",
    description:
      "The site you are looking at: a loud, responsive index for work, code, experiments, and useful detours.",
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
    source: "https://github.com/30ozSteak",
  },
  {
    slug: "lighthouse-checker",
    title: "LIGHTHOUSE CHECKER",
    description:
      "A small public tool for keeping web performance checks close at hand.",
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
      "An early code experiment preserved in public instead of polished out of history.",
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
    label: "ALL PUBLIC CODE",
    meta: "GITHUB / SOURCE",
    description: "The complete public repository index, including active work and old experiments.",
    href: "https://github.com/30ozSteak",
  },
  {
    label: "GISTS + SCRAPS",
    meta: "NOTES / SNIPPETS",
    description: "Smaller ideas, utility fragments, tests, and code that never needed a full repository.",
    href: "https://gist.github.com/30ozSteak",
  },
  {
    label: "LIGHTHOUSE CHECKER",
    meta: "TOOL / PERFORMANCE",
    description: "A focused utility for keeping web performance checks easy to reach.",
    href: "https://github.com/30ozSteak/lighthouse-checker",
  },
  {
    label: "ITADW",
    meta: "EXPERIMENT / ARCHIVE",
    description: "An early public-code experiment kept visible as part of the working history.",
    href: "https://github.com/30ozSteak/ITADW",
  },
  {
    label: "EZRIG",
    meta: "FORK / RIGGING",
    description: "A rigging project fork kept in the public working set.",
    href: "https://github.com/30ozSteak/Ezrig",
  },
  {
    label: "APPLAUSE BUTTON",
    meta: "FORK / WEB",
    description: "A small web-interaction fork saved for reference and reuse.",
    href: "https://github.com/30ozSteak/applause-button",
  },
  {
    label: "TELLER",
    meta: "FORK / TOOLING",
    description: "A tooling fork from the wider public code archive.",
    href: "https://github.com/30ozSteak/teller",
  },
  {
    label: "INTERVIEWS",
    meta: "FORK / REFERENCE",
    description: "A practical reference collection for interviews and preparation.",
    href: "https://github.com/30ozSteak/interviews",
  },
  {
    label: "DISPATCHES",
    meta: "X / NOTES",
    description: "Short updates, works in progress, links, and occasional internet noise.",
    href: "https://x.com/iaaafm",
  },
  {
    label: "START A CONVERSATION",
    meta: "EMAIL / HELLO",
    description: "For collaborations, useful problems, and the right weird thing.",
    href: "mailto:hello@mistakes.party",
  },
] as const;

export function getProject(slug: string) {
  return projects.find((project) => project.slug === slug);
}

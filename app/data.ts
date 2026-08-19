import rawContent from "../content/site-content.json";

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
  visibility: "PUBLIC" | "PRIVATE";
  featured: boolean;
  context: string;
  move: string;
  outcome: string;
  sourceUrl?: string;
  sourceLabel?: string;
  launchUrl?: string;
};

export type BlogPost = {
  id: string;
  title: string;
  publishedAt: string;
  source: string;
  url?: string;
};

export type HomeCategorySource =
  | "projects"
  | "games"
  | "websites"
  | "blogs"
  | "shop";

export type HomeCategoryItem = {
  id: string;
  title: string;
  meta: string;
  href?: string;
};

export type HomeCategory = {
  source: HomeCategorySource;
  label: string;
  href?: string;
  previewLabel: string;
  items: HomeCategoryItem[];
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

type SiteContent = {
  profiles: {
    github: string;
    medium: string;
  };
  homeCategories: HomeCategory[];
  projects: Project[];
  blogPosts: BlogPost[];
  archiveLinks: ArchiveLink[];
};

const content = rawContent as SiteContent;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function assertUniqueSlugs(items: readonly { slug: string }[], label: string) {
  const slugs = new Set<string>();

  for (const item of items) {
    if (!slugPattern.test(item.slug)) {
      throw new Error(`Unsafe ${label} slug: ${item.slug}`);
    }
    if (slugs.has(item.slug)) {
      throw new Error(`Duplicate ${label} slug: ${item.slug}`);
    }
    slugs.add(item.slug);
  }
}

assertUniqueSlugs(content.projects, "project");
assertUniqueSlugs(content.archiveLinks, "archive");

const homeSources = new Set<HomeCategorySource>();
for (const category of content.homeCategories) {
  if (homeSources.has(category.source)) {
    throw new Error(`Duplicate homepage category: ${category.source}`);
  }
  homeSources.add(category.source);

  const itemIds = new Set<string>();
  for (const item of category.items) {
    if (itemIds.has(item.id)) {
      throw new Error(`Duplicate homepage item: ${category.source}/${item.id}`);
    }
    itemIds.add(item.id);
  }
}

export const profiles = content.profiles;
export const homeCategories = content.homeCategories;
export const projects = content.projects;
export const blogPosts = [...content.blogPosts].sort(
  (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
);
export const archiveLinks = content.archiveLinks;

export function getProject(slug: string) {
  return projects.find((project) => project.slug === slug);
}

export function getArchiveLink(slug: string) {
  return archiveLinks.find((link) => link.slug === slug);
}

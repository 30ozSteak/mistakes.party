import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contentUrl = new URL("../content/site-content.json", import.meta.url);

test("keeps projects and posts in one local content source", async () => {
  const content = JSON.parse(await readFile(contentUrl, "utf8"));

  assert.ok(Array.isArray(content.projects));
  assert.ok(content.projects.length > 0);
  assert.ok(Array.isArray(content.blogPosts));
  assert.ok(Array.isArray(content.archiveLinks));

  const projectSlugs = content.projects.map(({ slug }) => slug);
  assert.equal(new Set(projectSlugs).size, projectSlugs.length);

  for (const project of content.projects) {
    assert.match(project.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(["PUBLIC", "PRIVATE"].includes(project.visibility));
    assert.equal(typeof project.featured, "boolean");
  }
});

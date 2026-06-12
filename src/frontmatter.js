// Split leading YAML frontmatter (--- ... ---) off a markdown document.
// Hugo/Jekyll/Obsidian docs all carry it; rendering it as body text is garbage.
export function stripFrontmatter(markdown) {
  const m = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { frontmatter: null, body: markdown };
  return { frontmatter: m[1], body: markdown.slice(m[0].length) };
}

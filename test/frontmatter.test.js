import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stripFrontmatter } from '../src/frontmatter.js';

test('splits yaml frontmatter from the body', () => {
  const { frontmatter, body } = stripFrontmatter('---\ntitle: Hi\ntags: [a]\n---\n# Doc\n');
  assert.equal(frontmatter, 'title: Hi\ntags: [a]');
  assert.equal(body, '# Doc\n');
});

test('returns null frontmatter when none present', () => {
  const { frontmatter, body } = stripFrontmatter('# Just a doc\n');
  assert.equal(frontmatter, null);
  assert.equal(body, '# Just a doc\n');
});

test('ignores --- that is not at the start of the document', () => {
  const doc = '# Doc\n\n---\n\nmore\n';
  assert.equal(stripFrontmatter(doc).frontmatter, null);
});

test('handles crlf line endings', () => {
  const { frontmatter, body } = stripFrontmatter('---\r\ntitle: Hi\r\n---\r\nbody\n');
  assert.equal(frontmatter, 'title: Hi');
  assert.equal(body, 'body\n');
});

test('does not treat a thematic break after text as frontmatter', () => {
  const doc = 'intro\n---\nnot yaml\n---\n';
  assert.equal(stripFrontmatter(doc).frontmatter, null);
});

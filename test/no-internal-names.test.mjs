// Guard: no organisation-internal names may leak into tracked files or commit messages.
// Terms are base64-encoded so this file doesn't contain them either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DENY = [
  'cXVlc3Rpb25wcm8=', 'cGVhcmwtY3g=', 'Y3hvdGc=', 'Y3VzdG9tZXIgZXhwZXJpZW5jZQ==',
  'ZGF0dGEga3VuZGU=', 'bWVoZWRpLmhhc2FuQA==',
].map(b => Buffer.from(b, 'base64').toString());
const CX = /\bcx\b/i;

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const hits = (text) => [...DENY.filter(t => text.toLowerCase().includes(t)), ...(CX.test(text) ? ['cx'] : [])];

test('tracked and untracked files contain no internal names', () => {
  const files = git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter(Boolean);
  const bad = [];
  for (const f of files.filter(f => f !== 'test/no-internal-names.test.mjs')) {
    let text;
    try { text = readFileSync(path.join(ROOT, f), 'utf8'); } catch { continue; }
    const h = hits(text);
    if (h.length) bad.push(`${f}: ${h.length} hit(s)`);
  }
  assert.deepEqual(bad, []);
});

test('commit messages contain no internal names', () => {
  assert.deepEqual(hits(git('log', '--format=%B')), []);
});

test('commit identities contain no internal names', () => {
  assert.deepEqual(hits(git('log', '--format=%an %ae %cn %ce')), []);
});

test('commits carry no AI co-author trailers', () => {
  assert.doesNotMatch(git('log', '--format=%B'), /co-authored-by|noreply@anthropic|generated with/i);
});

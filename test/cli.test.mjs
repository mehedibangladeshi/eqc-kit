import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');

// Temp repo with `.git` and the given files ({ 'path': 'content' }).
function repo(files = {}, { git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eqc-cli-'));
  if (git) fs.mkdirSync(path.join(root, '.git'));
  for (const [f, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    fs.writeFileSync(path.join(root, f), c);
  }
  return root;
}
const cli = (root, args, input = '') => spawnSync('node', [CLI, ...args, '--cwd', root], { encoding: 'utf8', input });
const rd = (root, f) => fs.readFileSync(path.join(root, f), 'utf8');
const cfgOf = root => JSON.parse(rd(root, '.eqc/config.json'));
const ex = (root, f) => fs.existsSync(path.join(root, f));
const pkg = deps => JSON.stringify({ dependencies: deps });
const detected = (files) => { const r = repo(files); assert.equal(cli(r, ['init', '--yes']).status, 0); return cfgOf(r); };
const writeCfg = (root, o) => { const p = path.join(root, '..', `answers-${path.basename(root)}.json`); fs.writeFileSync(p, JSON.stringify(o)); return p; };
const mtimes = root => {
  const out = {};
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    e.isDirectory() ? (e.name !== '.git' && walk(p)) : (out[p] = fs.statSync(p).mtimeMs);
  });
  walk(root);
  return out;
};

test('detect: Next.js repo', () => {
  const c = detected({ 'package.json': pkg({ next: '1', react: '1' }), 'package-lock.json': '{}', '.github/workflows/ci.yml': 'x' });
  assert.deepEqual(['nextjs', 'react', 'web'].filter(t => !c.stack.detected.includes(t)), []);
  assert.deepEqual(c.package_manager, ['npm']);
  assert.deepEqual(c.ci_paths, ['.github/workflows']);
  assert.ok(c.stack.tags.includes('all'));
});

test('detect: React Native repo', () => {
  const c = detected({
    'package.json': pkg({ 'react-native': '1', react: '1' }), 'yarn.lock': '', 'ios/Podfile': '', 'android/build.gradle': "classpath 'com.android.tools.build:gradle'",
    'codemagic.yaml': '', 'fastlane/Fastfile': '',
  });
  for (const t of ['react-native', 'ios', 'android', 'mobile']) assert.ok(c.stack.detected.includes(t), t);
  assert.ok(!c.stack.detected.includes('java'));
  assert.ok(c.ci_paths.includes('codemagic.yaml'));
});

test('detect: Go service and Python fastapi', () => {
  const go = detected({ 'go.mod': 'module x', 'go.sum': '' });
  assert.ok(go.stack.detected.includes('go') && go.stack.detected.includes('backend'));
  assert.deepEqual(go.package_manager, ['go']);
  const py = detected({ 'requirements.txt': 'fastapi==1\n', 'uv.lock': '' });
  assert.ok(py.stack.detected.includes('python') && py.stack.detected.includes('backend'));
  assert.deepEqual(py.package_manager, ['uv']);
});

test('init --yes: tree, config, AGENTS.md created, no model in neutral files', () => {
  const r = repo();
  const res = cli(r, ['init', '--yes']);
  assert.equal(res.status, 0, res.stderr);
  for (const f of ['.eqc/config.json', '.eqc/bin/eqc.mjs', '.eqc/prompts/check.md', '.eqc/manifest.json', '.eqc/standard/example.md', '.eqc/.gitignore',
    '.claude/skills/eqc-check/SKILL.md', '.claude/skills/eqc-fix/SKILL.md', '.claude/agents/eqc-fixer.md', 'AGENTS.md']) assert.ok(ex(r, f), f);
  assert.equal(rd(r, '.eqc/.gitignore').trim(), 'tmp/');
  const c = cfgOf(r);
  assert.equal(c.schema, 1);
  assert.equal(c.standard.path, '.eqc/standard/example.md');
  assert.equal(c.report_path, 'docs/eqc/COMPLIANCE.md');
  assert.equal(c.cheap_model, null);
  assert.deepEqual(c.adapters, ['claude-code', 'agents-md']);
  assert.deepEqual(c.gates, { package_install: true, ci_config: true, architecture: true, top_tier: true, auto_commit: false });
  assert.ok(Array.isArray(c.package_manager));
  assert.match(rd(r, 'AGENTS.md'), /eqc-kit:start[\s\S]*eqc check[\s\S]*docs\/eqc\/COMPLIANCE\.md[\s\S]*eqc-kit:end/);
  const m = JSON.parse(rd(r, '.eqc/manifest.json'));
  assert.ok(m.files['.eqc/bin/eqc.mjs'] && m.files['AGENTS.md#eqc-kit']);
  assert.match(res.stdout, /\/eqc-check/);
  const get = spawnSync('node', ['.eqc/bin/eqc.mjs', 'config', 'get', 'package_manager'], { cwd: r, encoding: 'utf8' });
  assert.equal(get.stdout.trim(), '[]');
  for (const f of ['.claude/skills/eqc-check/SKILL.md', '.claude/skills/eqc-fix/SKILL.md', '.claude/agents/eqc-audit.md'])
    assert.doesNotMatch(rd(r, f), /^model:|opus|sonnet|haiku/im);
  assert.match(rd(r, '.claude/agents/eqc-audit.md'), /^---\nname: eqc-audit\n[\s\S]*tools: Read, Bash, Grep, Glob\n---\n<!-- eqc-kit:managed v1/);
});

test('init appends AGENTS.md block preserving user content; adapters default from existing files', () => {
  const r = repo({ 'AGENTS.md': '# Mine\n\nkeep me\n' });
  assert.equal(cli(r, ['init', '--yes']).status, 0);
  assert.deepEqual(cfgOf(r).adapters, ['agents-md']);
  assert.ok(!ex(r, '.claude'));
  const t = rd(r, 'AGENTS.md');
  assert.ok(t.startsWith('# Mine\n\nkeep me\n'));
  assert.match(t, /eqc-kit:start/);
});

test('--config: cheap_model lands in claude-code skill; partial answers', () => {
  const r = repo();
  const f = writeCfg(r, { cheap_model: 'my-cheap-model', report_path: 'docs/q.md', gates: { auto_commit: true }, adapters: ['claude-code'] });
  const res = cli(r, ['init', '--yes', '--config', f]);
  assert.equal(res.status, 0, res.stderr);
  const c = cfgOf(r);
  assert.equal(c.cheap_model, 'my-cheap-model');
  assert.equal(c.report_path, 'docs/q.md');
  assert.equal(c.gates.auto_commit, true);
  assert.equal(c.gates.ci_config, true);
  assert.match(rd(r, '.claude/skills/eqc-fix/SKILL.md'), /model: my-cheap-model/);
  assert.ok(!ex(r, 'AGENTS.md'));
  assert.doesNotMatch(rd(r, '.claude/agents/eqc-fixer.md'), /^model:/m);
});

test('interactive run via piped stdin', () => {
  const r = repo({ 'package.json': pkg({ react: '1' }) });
  const answers = ['example', 'web, react', '.github/workflows', 'pnpm', 'y', 'n', 'y', 'y', 'y', 'claude-code', 'cheapy', 'docs/rep.md'].join('\n') + '\n';
  const res = cli(r, ['init'], answers);
  assert.equal(res.status, 0, res.stderr);
  const c = cfgOf(r);
  assert.deepEqual(c.stack.tags, ['web', 'react', 'all']);
  assert.deepEqual(c.package_manager, ['pnpm']);
  assert.equal(c.gates.ci_config, false);
  assert.equal(c.gates.auto_commit, true);
  assert.deepEqual(c.adapters, ['claude-code']);
  assert.equal(c.cheap_model, 'cheapy');
  assert.equal(c.report_path, 'docs/rep.md');
});

test('init refuses outside git without --force; twice exits 1', () => {
  const r = repo({}, { git: false });
  const res = cli(r, ['init', '--yes']);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /git/);
  assert.equal(cli(r, ['init', '--yes', '--force']).status, 0);
  const again = cli(r, ['init', '--yes', '--force']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /update/);
});

test('update with no changes performs zero writes', async () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  const before = mtimes(r);
  await new Promise(res => setTimeout(res, 30));
  const res = cli(r, ['update', '--yes']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(mtimes(r), before);
  assert.match(res.stdout, /0 written/);
});

test('update keeps a user-edited managed file with --yes and warns; overwrites unedited', () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  const skill = path.join(r, '.claude/skills/eqc-check/SKILL.md');
  fs.appendFileSync(skill, '\nmy edit\n');
  fs.appendFileSync(path.join(r, '.eqc/prompts/audit.md'), '\nstale\n');
  fs.writeFileSync(path.join(r, '.eqc/prompts/audit.md'), 'old'); // edited too: also kept
  const res = cli(r, ['update', '--yes']);
  assert.match(res.stderr, /kept your edited .*SKILL\.md/);
  assert.match(fs.readFileSync(skill, 'utf8'), /my edit/);
  assert.equal(rd(r, '.eqc/prompts/audit.md'), 'old');
  // unedited managed file deleted by user is restored
  fs.rmSync(path.join(r, '.eqc/prompts/check.md'));
  cli(r, ['update', '--yes']);
  assert.ok(ex(r, '.eqc/prompts/check.md'));
  // interactive answer y overwrites
  cli(r, ['update'], 'y\ny\n');
  assert.doesNotMatch(fs.readFileSync(skill, 'utf8'), /my edit/);
});

test('uninstall keeps state, removes managed files and AGENTS.md; --purge removes .eqc', () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  fs.writeFileSync(path.join(r, '.eqc/rules.json'), '{}');
  assert.equal(cli(r, ['uninstall'], 'n\n').status, 0);
  assert.ok(ex(r, '.eqc/bin'));
  assert.equal(cli(r, ['uninstall', '--yes']).status, 0);
  assert.ok(ex(r, '.eqc/rules.json') && ex(r, '.eqc/standard/example.md') && ex(r, '.eqc/config.json'));
  for (const f of ['.eqc/bin', '.eqc/prompts', '.eqc/manifest.json', 'AGENTS.md', '.claude/skills/eqc-check', '.claude/agents/eqc-fixer.md']) assert.ok(!ex(r, f), f);
  assert.equal(cli(r, ['uninstall', '--yes', '--purge']).status, 0);
  assert.ok(!ex(r, '.eqc'));
});

test('uninstall strips only the AGENTS.md block when user content exists', () => {
  const r = repo({ 'AGENTS.md': '# Mine\n\nkeep\n' });
  cli(r, ['init', '--yes']);
  cli(r, ['uninstall', '--yes']);
  assert.equal(rd(r, 'AGENTS.md'), '# Mine\n\nkeep\n');
});

test('doctor: pass, then fail when engine is broken', () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  const ok = cli(r, ['doctor']);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /✔ engine selftest passes/);
  assert.match(ok.stdout, /⚠ not indexed yet: run eqc check/);
  fs.writeFileSync(path.join(r, '.eqc/bin/eqc.mjs'), 'throw new Error("boom")');
  const bad = cli(r, ['doctor']);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /✖ engine selftest failed/);
  assert.match(bad.stdout, /⚠ 1 managed file\(s\) modified: .eqc\/bin\/eqc.mjs/);
});

test('engine selftest works inside the installed repo', () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  const s = spawnSync('node', ['.eqc/bin/eqc.mjs', 'selftest'], { cwd: r, encoding: 'utf8' });
  assert.equal(s.status, 0, s.stderr);
  assert.match(s.stdout, /selftest ok/);
});

test('URL standard source via local http server', async () => {
  const server = http.createServer((q, s) => {
    if (q.url === '/std/My-Standard.md') { s.setHeader('content-type', 'text/markdown'); s.end('# Std\n\n## Low\n1. **Rule**\n'); } else { s.statusCode = 404; s.end('no'); }
  });
  await new Promise(res => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = (root, args) => new Promise(res => {
    const p = spawn('node', [CLI, ...args, '--cwd', root]);
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    p.on('close', code => res({ status: code, out, err }));
  });
  try {
    const r = repo();
    const f = writeCfg(r, { standard: { source: `${base}/std/My-Standard.md` } });
    const res = await run(r, ['init', '--yes', '--config', f]);
    assert.equal(res.status, 0, res.err);
    assert.equal(cfgOf(r).standard.path, '.eqc/standard/My-Standard.md');
    assert.match(rd(r, '.eqc/standard/My-Standard.md'), /## Low/);
    const r2 = repo();
    const bad = await run(r2, ['init', '--yes', '--config', writeCfg(r2, { standard: { source: `${base}/missing.md` } })]);
    assert.equal(bad.status, 1);
    assert.ok(!ex(r2, '.eqc'));
  } finally { server.close(); }
});

test('--help and --version', () => {
  assert.match(spawnSync('node', [CLI, '--help'], { encoding: 'utf8' }).stdout, /usage: eqc-kit/);
  assert.match(spawnSync('node', [CLI, '--version'], { encoding: 'utf8' }).stdout, /^\d+\.\d+\.\d+/);
});

test('init never clobbers pre-existing files: --yes skips, interactive n keeps, --force overwrites', () => {
  const SK = '.claude/skills/eqc-check/SKILL.md';
  const mk = () => repo({ [SK]: 'MY OWN SKILL' });
  const r = mk();
  const res = cli(r, ['init', '--yes']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(rd(r, SK), 'MY OWN SKILL');
  assert.match(res.stderr, /kept your existing .*SKILL\.md/);
  assert.equal(JSON.parse(rd(r, '.eqc/manifest.json')).files[SK], undefined);
  assert.ok(ex(r, '.claude/skills/eqc-fix/SKILL.md'));
  const r2 = mk();
  cli(r2, ['init'], ['example', '', '', '', '', '', '', '', '', '', '', '', 'n'].join('\n') + '\n');
  assert.equal(rd(r2, SK), 'MY OWN SKILL');
  const r3 = mk();
  assert.equal(cli(r3, ['init', '--yes', '--force']).status, 0);
  assert.match(rd(r3, SK), /eqc-kit:managed/);
});

test('init replaces an existing eqc-kit AGENTS.md block without duplicating it', () => {
  const r = repo({ 'AGENTS.md': 'top\n\n<!-- eqc-kit:start -->\nold\n<!-- eqc-kit:end -->\n\nbottom\n' });
  assert.equal(cli(r, ['init', '--yes']).status, 0);
  const t = rd(r, 'AGENTS.md');
  assert.equal(t.split('eqc-kit:start').length, 2);
  assert.match(t, /^top[\s\S]*eqc check[\s\S]*bottom\n$/);
  assert.doesNotMatch(t, /\nold\n/);
});

test('uninstall keeps edited files/blocks with a warning; --force removes; empty .claude pruned', () => {
  const SK = '.claude/skills/eqc-check/SKILL.md';
  const r = repo({ 'AGENTS.md': '# Mine\n' });
  cli(r, ['init', '--yes', '--config', writeCfg(r, { adapters: ['claude-code', 'agents-md'] })]);
  fs.appendFileSync(path.join(r, SK), 'my edit\n');
  fs.writeFileSync(path.join(r, 'AGENTS.md'), rd(r, 'AGENTS.md').replace('Don\'t regress', 'Never regress'));
  const res = cli(r, ['uninstall', '--yes']);
  assert.match(res.stderr, /kept edited .claude\/skills\/eqc-check\/SKILL.md/);
  assert.match(res.stderr, /kept edited eqc-kit block/);
  assert.ok(ex(r, SK) && !ex(r, '.claude/skills/eqc-fix'));
  assert.match(rd(r, 'AGENTS.md'), /Never regress/);
  assert.ok(ex(r, '.claude/skills'));
});

test('uninstall interactive: y removes edited file, .claude pruned when empty', () => {
  const r = repo({ 'AGENTS.md': '# Mine\n' });
  cli(r, ['init', '--yes', '--config', writeCfg(r, { adapters: ['claude-code', 'agents-md'] })]);
  fs.appendFileSync(path.join(r, '.claude/skills/eqc-check/SKILL.md'), 'my edit\n');
  cli(r, ['uninstall'], 'y\ny\n');
  assert.ok(!ex(r, '.claude'));
  assert.equal(rd(r, 'AGENTS.md'), '# Mine\n');
});

test('uninstall --force removes edited files; unrelated .claude content survives', () => {
  const r = repo({ '.claude/settings.json': '{}' });
  cli(r, ['init', '--yes']);
  fs.appendFileSync(path.join(r, '.claude/agents/eqc-fixer.md'), 'edit');
  cli(r, ['uninstall', '--yes', '--force']);
  assert.ok(!ex(r, '.claude/agents') && !ex(r, '.claude/skills') && ex(r, '.claude/settings.json'));
});

test('update --force overwrites edited files; --yes keeps them', () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  const f = path.join(r, '.eqc/prompts/fix.md');
  fs.appendFileSync(f, 'edit');
  cli(r, ['update', '--yes']);
  assert.match(fs.readFileSync(f, 'utf8'), /edit$/);
  const res = cli(r, ['update', '--force']);
  assert.equal(res.status, 0);
  assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /edit$/);
});

test('doctor: missing managed file is an error', () => {
  const r = repo();
  cli(r, ['init', '--yes']);
  fs.rmSync(path.join(r, '.eqc/prompts/fix.md'));
  const res = cli(r, ['doctor']);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /✖ managed file missing: .eqc\/prompts\/fix.md/);
});

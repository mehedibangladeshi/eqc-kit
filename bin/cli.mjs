#!/usr/bin/env node
// eqc-kit installer: init | update | uninstall | doctor. Node >=18, stdlib only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(PKG, 'package.json'), 'utf8')).version;
const USAGE = `eqc-kit ${VERSION}
usage: eqc-kit <init|update|uninstall|doctor|hooks> [--yes] [--config file.json] [--force] [--purge] [--off] [--cwd dir]`;
const HOOKS = '.eqc/hooks';
const START = '<!-- eqc-kit:start -->', END = '<!-- eqc-kit:end -->';
const AGENTS = {
  'eqc-index': { prompt: 'index', tools: 'Read, Write, Bash', description: 'Indexes the standard doc into rules.json.' },
  'eqc-audit': { prompt: 'audit', tools: 'Read, Bash, Grep, Glob', description: 'Audits a list of rule IDs against the codebase.' },
  'eqc-planner': { prompt: 'plan', tools: 'Read, Grep, Glob, Bash, Write', description: 'Writes a chunked fix plan for one rule.' },
  'eqc-fixer': { prompt: 'fixer', tools: 'Read, Write, Edit, Bash, Grep, Glob', description: 'Implements one fix or plan chunk and self-verifies.' },
};
const GATES = [['package_install', 'Package installs need approval?', true], ['ci_config', 'CI config changes need approval?', true],
  ['architecture', 'Architecture changes need approval?', true], ['top_tier', 'Top-tier rules need approval?', true], ['auto_commit', 'Auto-commit each fix?', false]];
const REQUIRED_KEYS = ['schema', 'standard', 'stack', 'ci_paths', 'package_manager', 'gates', 'adapters', 'report_path', 'cheap_model', 'installed_version'];

class Fail extends Error {}
const die = m => { throw new Fail(m); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const list = (dir, withTypes) => { try { return fs.readdirSync(dir, { withFileTypes: withTypes }); } catch { return []; } };
const csv = s => [...new Set(String(s).split(',').map(x => x.trim()).filter(Boolean))];

// ---------- detection ----------

const IGNORE = new Set(['node_modules', '.git']);
const CI = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', 'codemagic.yaml', 'azure-pipelines.yml', '.circleci', 'bitbucket-pipelines.yml', 'fastlane', '.buildkite', '.travis.yml'];
const LOCKS = { 'package-lock.json': 'npm', 'yarn.lock': 'yarn', 'pnpm-lock.yaml': 'pnpm', 'bun.lockb': 'bun', 'poetry.lock': 'poetry', 'uv.lock': 'uv',
  'Pipfile.lock': 'pipenv', 'go.sum': 'go', 'Cargo.lock': 'cargo', 'composer.lock': 'composer', 'Gemfile.lock': 'bundler' };

// Root + one level deep. Returns entries {name, rel, abs}.
function scan(root) {
  const out = [];
  for (const e of list(root, true)) {
    out.push({ name: e.name, rel: e.name, abs: path.join(root, e.name) });
    if (e.isDirectory() && !IGNORE.has(e.name) && !e.name.startsWith('.'))
      for (const c of list(path.join(root, e.name), true)) out.push({ name: c.name, rel: `${e.name}/${c.name}`, abs: path.join(root, e.name, c.name) });
  }
  return out;
}

export function detect(root) {
  const es = scan(root);
  const find = re => es.filter(e => re.test(e.name));
  const has = re => find(re).length > 0;
  const text = re => find(re).map(e => read(e.abs) ?? '').join('\n');
  const deps = new Set();
  for (const e of find(/^package\.json$/)) {
    const j = readJson(e.abs) || {};
    Object.keys({ ...j.dependencies, ...j.devDependencies }).forEach(d => deps.add(d));
  }
  const dep = (...n) => n.some(x => deps.has(x));
  const t = new Set(), broad = new Set();
  const add = (tag, b) => { t.add(tag); if (b) broad.add(b); };
  const gradle = text(/^build\.gradle(\.kts)?$/);
  const py = text(/^(pyproject\.toml|requirements.*\.txt)$/).toLowerCase();
  const androidish = has(/^AndroidManifest\.xml$/) || /com\.android|android\s*\{/.test(gradle) || es.some(e => /^android\/build\.gradle/.test(e.rel));
  if (dep('react-native')) add('react-native', 'mobile');
  if (dep('expo')) add('expo', 'mobile');
  if (has(/^pubspec\.yaml$/)) add('flutter', 'mobile');
  if (androidish) add('android', 'mobile');
  if (has(/\.xcodeproj$|^Package\.swift$|^Podfile$/)) add('ios', 'mobile');
  if (dep('react')) add('react', 'web');
  if (dep('next')) add('nextjs', 'web');
  if (dep('vue')) add('vue', 'web');
  if (dep('nuxt')) add('nuxt', 'web');
  if (dep('@angular/core')) add('angular', 'web');
  if (dep('svelte')) add('svelte', 'web');
  if (dep('express', 'fastify', '@nestjs/core', 'koa', '@hapi/hapi', 'hapi')) add('node', 'backend');
  if (py) { t.add('python'); if (/django|flask|fastapi/.test(py)) broad.add('backend'); }
  if (has(/^go\.mod$/)) add('go', 'backend');
  if ((has(/^pom\.xml$/) || gradle) && !androidish) { add('java', 'backend'); if (/kotlin/.test(gradle) || has(/^build\.gradle\.kts$/)) t.add('kotlin'); }
  if (has(/^Cargo\.toml$/)) t.add('rust');
  if (has(/^composer\.json$/)) t.add('php');
  if (has(/^Gemfile$/)) { t.add('ruby'); if (/rails/.test(text(/^Gemfile$/))) broad.add('backend'); }
  if (has(/\.csproj$/)) t.add('dotnet');
  const pm = new Set(es.filter(e => LOCKS[e.name]).map(e => LOCKS[e.name]));
  if (has(/^build\.gradle(\.kts)?$/)) pm.add('gradle');
  if (has(/^pom\.xml$/)) pm.add('maven');
  return {
    tags: [...new Set([...t, ...broad])],
    ci: CI.filter(c => fs.existsSync(path.join(root, c))),
    pm: [...pm],
  };
}

// ---------- io helpers ----------

function makeAsker() {
  let rl = null, lines = null;
  const ask = async (q, def = '') => {
    const shown = `${q}${def !== '' ? ` [${def}]` : ''} `;
    let a;
    if (process.stdin.isTTY) {
      rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
      a = await rl.question(shown);
    } else {
      if (!lines) { const chunks = []; for await (const c of process.stdin) chunks.push(c); lines = Buffer.concat(chunks).toString('utf8').split(/\r?\n/); }
      process.stdout.write(`${shown}\n`);
      a = lines.shift() ?? '';
    }
    return a.trim() || def;
  };
  const yn = async (q, def) => /^y/i.test(await ask(`${q} (y/n)`, def ? 'y' : 'n'));
  return { ask, yn, close: () => rl?.close() };
}

function findGitRoot(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (d === path.dirname(d)) return null;
  }
}

function simpleDiff(oldT, newT) {
  const o = oldT.split('\n'), n = newT.split('\n'), os = new Set(o), ns = new Set(n);
  const d = [...o.filter(l => !ns.has(l)).map(l => `- ${l}`), ...n.filter(l => !os.has(l)).map(l => `+ ${l}`)];
  return d.slice(0, 20).join('\n') + (d.length > 20 ? `\n... ${d.length - 20} more lines` : '');
}

// ---------- generation ----------

const tpl = (rel, vars) => Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{{${k}}}`, v), fs.readFileSync(path.join(PKG, rel), 'utf8'));

// Returns [{rel, content, block?}] for every managed file/block, from config.
function generate(cfg, root) {
  const out = [{ rel: '.eqc/bin/eqc.mjs', content: fs.readFileSync(path.join(PKG, 'engine/eqc.mjs'), 'utf8') }];
  for (const f of list(path.join(PKG, 'prompts')).filter(f => f.endsWith('.md')).sort())
    out.push({ rel: `.eqc/prompts/${f}`, content: fs.readFileSync(path.join(PKG, 'prompts', f), 'utf8') });
  for (const h of ['pre-commit', 'pre-push'])
    out.push({ rel: `${HOOKS}/${h}`, mode: 0o755, content: fs.readFileSync(path.join(PKG, 'adapters/git-hooks', h), 'utf8') });
  const vars = { report_path: cfg.report_path };
  const block = tpl('adapters/agents-md/block.md', vars).trimEnd();
  if (cfg.adapters.includes('claude-code')) {
    const note = cfg.cheap_model
      ? `- Dispatch \`[mechanical]\` chunks with \`model: ${cfg.cheap_model}\` (config \`cheap_model\`, read via \`node .eqc/bin/eqc.mjs config get cheap_model\`); use the session model for \`[judgment]\` chunks and retries.`
      : '- No cheaper model is configured: do not pass a `model` when dispatching; inherit the session model.';
    for (const s of ['eqc-check', 'eqc-fix'])
      out.push({ rel: `.claude/skills/${s}/SKILL.md`, content: tpl(`adapters/claude-code/skills/${s}.md`, { ...vars, cheap_model_note: note }) });
    for (const [name, a] of Object.entries(AGENTS))
      out.push({ rel: `.claude/agents/${name}.md`, content: tpl('adapters/claude-code/agent.md', { name, ...a }) });
    // Claude Code reads AGENTS.md only when there is no CLAUDE.md. Creating one would hide the user's AGENTS.md,
    // so the block goes into CLAUDE.md only when it already exists or no AGENTS.md block is written.
    if (fs.existsSync(path.join(root, 'CLAUDE.md')) || !cfg.adapters.includes('agents-md')) out.push({ rel: 'CLAUDE.md#eqc-kit', block: true, content: block });
  }
  if (cfg.adapters.includes('agents-md')) out.push({ rel: 'AGENTS.md#eqc-kit', block: true, content: block });
  return out;
}

// Managed blocks are keyed '<file>#eqc-kit'; everything else is a whole file.
const target = e => e.block ? e.rel.split('#')[0] : e.rel;
const blockRange = t => { const s = t.indexOf(START), e = t.indexOf(END); return s === -1 || e < s ? null : [s, e + END.length]; };

function current(root, e) {
  const t = read(path.join(root, target(e)));
  if (!e.block || t === null) return t;
  const r = blockRange(t);
  return r ? t.slice(...r) : null;
}

function put(root, e, content) {
  const p = path.join(root, target(e));
  let out = content;
  if (e.block) {
    const t = read(p);
    const r = t === null ? null : blockRange(t);
    out = t === null ? `${content}\n` : r ? t.slice(0, r[0]) + content + t.slice(r[1]) : `${t.replace(/\s*$/, '')}\n\n${content}\n`;
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, out);
  if (e.mode) fs.chmodSync(p, e.mode);
}

// Writes entries honouring user edits; returns the new manifest files map.
async function sync(root, entries, oldFiles, { yes, force, io }) {
  const files = {}, res = { written: [], kept: [], same: 0 };
  for (const e of entries) {
    const cur = current(root, e), mh = oldFiles[e.rel];
    if (cur === e.content) { files[e.rel] = sha(e.content); res.same++; continue; }
    let write = true;
    const foreign = mh === undefined && !e.block; // exists, not ours (no manifest entry)
    if (cur !== null && !force && (foreign || (mh !== undefined && sha(cur) !== mh))) {
      console.log(`\n${e.rel} ${foreign ? 'already exists and is not managed by eqc-kit' : 'was edited locally'}:\n${simpleDiff(cur, e.content)}`);
      write = yes ? false : await io.yn(`Overwrite ${e.rel}?`, false);
      if (!write) { console.warn(`warning: kept your ${foreign ? 'existing' : 'edited'} ${e.rel} (rerun without --yes to review${foreign ? ', or use --force' : ''})`); res.kept.push(e.rel); if (mh) files[e.rel] = mh; continue; }
    }
    put(root, e, e.content);
    files[e.rel] = sha(e.content);
    res.written.push(e.rel);
  }
  res.files = files;
  return res;
}

const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };

// ---------- init ----------

async function resolveStandard(src) {
  if (src === 'example') return { name: 'example.md', content: fs.readFileSync(path.join(PKG, 'standards/example.md'), 'utf8') };
  let name, content;
  if (/^https?:\/\//i.test(src)) {
    let r;
    try { r = await fetch(src); } catch (err) { die(`could not fetch ${src}: ${err.message}`); }
    if (!r.ok) die(`could not fetch ${src}: HTTP ${r.status}`);
    content = await r.text();
    name = path.basename(new URL(src).pathname) || 'standard';
  } else {
    content = read(path.resolve(src));
    if (content === null) die(`cannot read standard file: ${src}`);
    name = path.basename(src);
  }
  return { name: `${name.replace(/\.[^.]*$/, '') || 'standard'}.md`, content };
}

async function init(root, opts) {
  if (!opts.force && !findGitRoot(root)) die(`${root} is not inside a git repo (use --force to install anyway).`);
  if (fs.existsSync(path.join(root, '.eqc/config.json'))) die('.eqc/config.json exists: run `eqc-kit update` instead.');
  const given = opts.config ? readJson(path.resolve(opts.config)) ?? die(`cannot read --config file ${opts.config}`) : {};
  const io = makeAsker();
  try {
    const d = detect(root);
    const pick = async (val, q, def, parse = csv) => val !== undefined ? val : opts.yes ? def : parse(await io.ask(q, Array.isArray(def) ? def.join(',') : def));
    const isList = v => Array.isArray(v) ? v : csv(v);
    const source = given.standard?.source ?? given.standard?.path
      ?? (opts.yes ? 'example' : await io.ask('Standard doc: local path, http(s) URL, or "example" (private Google Docs/Confluence: export to Markdown first).', 'example'));
    const std = await resolveStandard(source);
    const tags = await pick(given.stack?.tags, 'Stack tags (detected, edit as comma list):', d.tags, csv);
    const ci = await pick(given.ci_paths, 'CI paths:', d.ci, csv);
    const pm = await pick(given.package_manager, 'Package manager(s):', d.pm, csv);
    const gates = {};
    for (const [k, q, def] of GATES) gates[k] = given.gates?.[k] ?? (opts.yes ? def : await io.yn(q, def));
    const hasClaude = fs.existsSync(path.join(root, '.claude')) || fs.existsSync(path.join(root, 'CLAUDE.md'));
    const hasAgents = fs.existsSync(path.join(root, 'AGENTS.md'));
    const defAd = hasClaude || hasAgents ? [hasClaude && 'claude-code', hasAgents && 'agents-md'].filter(Boolean) : ['claude-code', 'agents-md'];
    const adapters = isList(await pick(given.adapters, 'Adapters (claude-code, agents-md):', defAd, csv));
    for (const a of adapters) if (!['claude-code', 'agents-md'].includes(a)) die(`unknown adapter: ${a}`);
    let cheap = given.cheap_model;
    if (cheap === undefined) cheap = adapters.includes('claude-code') && !opts.yes ? await io.ask('Cheaper model for mechanical fix chunks (blank = use your default):', '') : '';
    const report = given.report_path ?? (opts.yes ? 'docs/eqc/COMPLIANCE.md' : await io.ask('Report path:', 'docs/eqc/COMPLIANCE.md'));
    const cfg = {
      schema: 1,
      standard: { path: `.eqc/standard/${std.name}`, source },
      stack: { detected: d.tags, tags: [...new Set([...isList(tags), 'all'])] },
      ci_paths: isList(ci), package_manager: isList(pm), gates, adapters, report_path: report,
      cheap_model: cheap || null, installed_version: VERSION,
    };
    fs.mkdirSync(path.join(root, '.eqc/standard'), { recursive: true });
    fs.writeFileSync(path.join(root, cfg.standard.path), std.content);
    writeJson(path.join(root, '.eqc/config.json'), cfg);
    fs.writeFileSync(path.join(root, '.eqc/.gitignore'), 'tmp/\n');
    const res = await sync(root, generate(cfg, root), {}, { yes: opts.yes, force: opts.force, io });
    writeJson(path.join(root, '.eqc/manifest.json'), manifest(res.files));
    console.log(`\neqc-kit ${VERSION} installed in ${root}`);
    console.log(`  standard : ${cfg.standard.path}  (source: ${source})`);
    console.log(`  stack    : ${cfg.stack.tags.join(', ')}`);
    console.log(`  ci       : ${cfg.ci_paths.join(', ') || '(none)'}   package manager: ${cfg.package_manager.join(', ') || '(none)'}`);
    console.log(`  adapters : ${adapters.join(', ') || '(none)'}   report: ${report}`);
    if (res.kept.length) console.log(`  skipped ${res.kept.length} existing file(s): ${res.kept.join(', ')}`);
    console.log(`  wrote ${res.written.length} files: .eqc/{config.json,manifest.json,bin,prompts}${adapters.length ? ' + adapter files' : ''}`);
    console.log('\nNext step:');
    if (adapters.includes('claude-code')) console.log('  Claude Code: run /eqc-check');
    if (adapters.includes('agents-md')) console.log("  Any AGENTS.md tool: ask 'run eqc check'");
    console.log('The first check indexes the standard.');
  } finally { io.close(); }
}

const manifest = files => ({ version: VERSION, files: Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) });

// ---------- update ----------

const DEFAULTS = { ci_paths: [], package_manager: [], cheap_model: null, gates: Object.fromEntries(GATES.map(([k, , d]) => [k, d])) };

async function update(root, opts) {
  const cfgPath = path.join(root, '.eqc/config.json');
  const cfg = readJson(cfgPath) ?? die('no .eqc/config.json: run `eqc-kit init` first.');
  const old = readJson(path.join(root, '.eqc/manifest.json')) ?? { files: {} };
  const next = { ...cfg, gates: { ...DEFAULTS.gates, ...cfg.gates } };
  for (const k of Object.keys(DEFAULTS)) next[k] ??= DEFAULTS[k];
  next.installed_version = VERSION;
  if (JSON.stringify(next) !== JSON.stringify(cfg)) writeJson(cfgPath, next);
  const io = makeAsker();
  try {
    const entries = generate(next, root);
    const res = await sync(root, entries, old.files, { yes: opts.yes, force: opts.force, io });
    const nm = manifest(res.files);
    if (JSON.stringify(nm) !== JSON.stringify(old)) writeJson(path.join(root, '.eqc/manifest.json'), nm);
    console.log(`update: ${res.written.length} written, ${res.kept.length} kept (edited), ${res.same} unchanged`);
    res.written.forEach(f => console.log(`  wrote ${f}`));
  } finally { io.close(); }
}

// ---------- uninstall ----------

async function uninstall(root, opts) {
  if (!fs.existsSync(path.join(root, '.eqc'))) die('nothing to uninstall: no .eqc/ found.');
  const mf = readJson(path.join(root, '.eqc/manifest.json')) ?? { files: {} };
  const io = makeAsker();
  try {
    if (!opts.yes && !(await io.yn(opts.purge ? 'Remove ALL of .eqc/ (state included) and managed files?' : 'Remove managed files (state in .eqc/ is kept)?', false))) return console.log('aborted.');
    for (const [rel, h] of Object.entries(mf.files)) {
      const isBlock = rel.includes('#'), p = path.join(root, target({ rel, block: isBlock }));
      const t = read(p), r = isBlock && t !== null ? blockRange(t) : null;
      const cur = isBlock ? (r ? t.slice(...r) : null) : t;
      if (cur === null) continue;
      if (sha(cur) !== h && !opts.force) {
        const label = isBlock ? `edited eqc-kit block in ${target({ rel, block: true })}` : `edited ${rel}`;
        if (opts.yes || !(await io.yn(`remove ${label}?`, false))) { console.warn(`warning: kept ${label} (use --force to remove)`); continue; }
      }
      if (isBlock) {
        const rest = (t.slice(0, r[0]).replace(/\s+$/, '') + '\n\n' + t.slice(r[1]).replace(/^\s+/, '')).trim();
        if (rest) fs.writeFileSync(p, rest + '\n'); else fs.rmSync(p);
      } else fs.rmSync(p, { force: true });
    }
  } finally { io.close(); }
  for (const d of list(path.join(root, '.claude/skills')).filter(d => d.startsWith('eqc-'))) {
    const p = path.join(root, '.claude/skills', d);
    if (list(p).length === 0) fs.rmdirSync(p);
  }
  for (const d of ['.claude/skills', '.claude/agents', '.claude']) {
    const p = path.join(root, d);
    if (fs.existsSync(p) && list(p).length === 0) fs.rmdirSync(p);
  }
  if (gitHooksPath(root) === HOOKS) spawnSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: root });
  for (const s of ['bin', 'prompts', 'hooks', 'manifest.json']) fs.rmSync(path.join(root, '.eqc', s), { recursive: true, force: true });
  if (opts.purge) fs.rmSync(path.join(root, '.eqc'), { recursive: true, force: true });
  console.log(opts.purge ? 'uninstalled; .eqc/ removed.' : 'uninstalled; .eqc/ state kept (use --purge to remove).');
}

// ---------- hooks ----------

const gitHooksPath = root => spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: root, encoding: 'utf8' }).stdout?.trim() ?? '';

// Points git at .eqc/hooks (per clone: git config is never committed). Never clobbers another hook setup.
function hooks(root, opts) {
  const cur = gitHooksPath(root);
  if (opts.off) {
    if (cur !== HOOKS) return console.log('hooks: eqc-kit hooks are not enabled');
    spawnSync('git', ['config', '--unset', 'core.hooksPath'], { cwd: root });
    return console.log('hooks: off (core.hooksPath unset)');
  }
  if (!fs.existsSync(path.join(root, HOOKS, 'pre-commit'))) die(`no ${HOOKS}/: run \`eqc-kit update\` first.`);
  if (cur === HOOKS) return console.log(`hooks: already on (core.hooksPath = ${HOOKS})`);
  const gp = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root, encoding: 'utf8' });
  if (gp.status !== 0) die(`${root} is not a git repo.`);
  const existing = cur ? [] : list(path.resolve(root, gp.stdout.trim())).filter(f => !f.endsWith('.sample'));
  if ((cur || existing.length) && !opts.force)
    die(`${cur ? `core.hooksPath is already "${cur}"` : `existing git hooks found (${existing.join(', ')})`}; enabling would bypass them.
Add these lines to your pre-commit and pre-push hooks instead (or rerun with --force):
  sh ${HOOKS}/pre-commit
  sh ${HOOKS}/pre-push`);
  const r = spawnSync('git', ['config', 'core.hooksPath', HOOKS], { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) die(`git config failed: ${r.stderr.trim()}`);
  console.log(`hooks: on — pre-commit runs verify, pre-push runs verify + gate (core.hooksPath = ${HOOKS}).
Each teammate runs \`npx eqc-kit hooks\` once per clone. Disable with \`npx eqc-kit hooks --off\`.`);
}

// ---------- doctor ----------

function doctor(root) {
  let bad = 0;
  const out = (mark, msg) => { console.log(`${mark} ${msg}`); if (mark === '✖') bad++; };
  const major = Number(process.versions.node.split('.')[0]);
  out(major >= 18 ? '✔' : '✖', `node ${process.versions.node} (need >=18)`);
  const cfg = readJson(path.join(root, '.eqc/config.json'));
  if (!cfg) out('✖', '.eqc/config.json missing or not valid JSON');
  else {
    const miss = REQUIRED_KEYS.filter(k => !(k in cfg));
    out(miss.length ? '✖' : '✔', miss.length ? `config.json missing keys: ${miss.join(', ')}` : 'config.json valid');
    const sp = cfg.standard?.path;
    out(sp && fs.existsSync(path.join(root, sp)) ? '✔' : '✖', `standard file ${sp ?? '(none configured)'}`);
  }
  const eng = path.join(root, '.eqc/bin/eqc.mjs');
  if (!fs.existsSync(eng)) out('✖', 'engine .eqc/bin/eqc.mjs missing');
  else {
    const r = spawnSync(process.execPath, [eng, 'selftest'], { cwd: root, encoding: 'utf8' });
    out(r.status === 0 ? '✔' : '✖', r.status === 0 ? 'engine selftest passes' : `engine selftest failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
  }
  const mf = readJson(path.join(root, '.eqc/manifest.json'));
  if (!mf) out('✖', '.eqc/manifest.json missing or invalid');
  else {
    const c = cfg?.adapters ? generate(cfg, root) : [];
    const byRel = new Map(c.map(e => [e.rel, e]));
    let missing = 0;
    const modified = [];
    for (const [rel, h] of Object.entries(mf.files)) {
      const cur = byRel.has(rel) ? current(root, byRel.get(rel)) : read(path.join(root, rel));
      if (cur === null) { missing++; out('✖', `managed file missing: ${rel}`); } else if (sha(cur) !== h) modified.push(rel);
    }
    if (modified.length) out('⚠', `${modified.length} managed file(s) modified: ${modified.join(', ')}`);
    if (!missing && !modified.length) out('✔', `${Object.keys(mf.files).length} managed files present and unmodified`);
  }
  out(fs.existsSync(path.join(root, '.eqc/rules.json')) ? '✔' : '⚠', fs.existsSync(path.join(root, '.eqc/rules.json')) ? 'standard indexed (rules.json)' : 'not indexed yet: run eqc check');
  process.exitCode = bad ? 1 : 0;
}

// ---------- main ----------

export async function main(argv) {
  const { values: v, positionals: [cmd] } = parseArgs({
    args: argv, allowPositionals: true,
    options: { yes: { type: 'boolean', short: 'y' }, config: { type: 'string' }, force: { type: 'boolean' }, purge: { type: 'boolean' }, off: { type: 'boolean' }, cwd: { type: 'string' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  });
  if (v.version) return console.log(VERSION);
  if (v.help || !cmd) return console.log(USAGE);
  const root = path.resolve(v.cwd ?? process.cwd());
  switch (cmd) {
    case 'init': return init(root, v);
    case 'update': return update(root, v);
    case 'uninstall': return uninstall(root, v);
    case 'doctor': return doctor(root);
    case 'hooks': return hooks(root, v);
    default: die(`unknown command: ${cmd}\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch(e => {
  console.error(e instanceof Fail ? `error: ${e.message}` : e.stack ?? e);
  process.exit(1);
});

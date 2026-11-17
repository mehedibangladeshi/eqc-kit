import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildTierSummary, computeCurrentTier, rankCandidates, selectIds, groupByTier,
  parsePlanChunks, formatChunkStatus, checkIds, buildDigest, updateBaseline, findRegressions,
} from '../engine/eqc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(here, '..', 'engine', 'eqc.mjs');
const EXAMPLE_MD = path.join(here, '..', 'standards', 'example.md');
const fixture = name => path.join(here, 'fixtures', name);
const loadRules = name => JSON.parse(fs.readFileSync(path.join(fixture(name), 'rules.json'), 'utf8'));

// Fresh repo root in tmp with the fixture copied to <root>/.eqc; returns helpers.
function sandbox(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eqc-test-'));
  const dir = path.join(root, '.eqc');
  if (name) fs.cpSync(fixture(name), dir, { recursive: true });
  else fs.mkdirSync(dir);
  const run = (...args) => spawnSync('node', [ENGINE, ...args], { env: { ...process.env, EQC_DIR: dir }, encoding: 'utf8' });
  const readJson = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const writeTmp = (f, data) => { const p = path.join(root, f); fs.writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); return p; };
  return { root, dir, run, readJson, writeTmp };
}

const t3 = loadRules('example').tiers;
const t2 = loadRules('two-tier').tiers;
const t4 = loadRules('four-tier').tiers;
const fails = (ids, obj) => Object.fromEntries(ids.map(id => [id, { fail: obj[id] ?? 0 }]));

// ---------- tier maths ----------

test('3-tier: achieved tier walks up to first failing tier', () => {
  assert.equal(computeCurrentTier(fails(['BRONZE', 'SILVER', 'GOLD'], {}), t3), 'GOLD');
  assert.equal(computeCurrentTier(fails(['BRONZE', 'SILVER', 'GOLD'], { GOLD: 2 }), t3), 'SILVER');
  assert.equal(computeCurrentTier(fails(['BRONZE', 'SILVER', 'GOLD'], { SILVER: 1 }), t3), 'BRONZE');
});

test('HARD_FAIL when lowest tier has a fail', () => {
  assert.equal(computeCurrentTier(fails(['BRONZE', 'SILVER', 'GOLD'], { BRONZE: 1 }), t3), 'HARD_FAIL');
});

test('2-tier and 4-tier', () => {
  assert.equal(computeCurrentTier({ BASE: { fail: 0 }, TOP: { fail: 1 } }, t2), 'BASE');
  assert.equal(computeCurrentTier({ BASE: { fail: 1 }, TOP: { fail: 0 } }, t2), 'HARD_FAIL');
  const s = fails(['ONE', 'TWO', 'THREE', 'FOUR'], { FOUR: 1 });
  assert.equal(computeCurrentTier(s, t4), 'THREE');
  assert.equal(computeCurrentTier(fails(['ONE', 'TWO', 'THREE', 'FOUR'], { TWO: 1 }), t4), 'ONE');
});

test('partials do not block', () => {
  const s = { BRONZE: { fail: 0, partial: 5 }, SILVER: { fail: 0, partial: 3 }, GOLD: { fail: 0, partial: 1 } };
  assert.equal(computeCurrentTier(s, t3), 'GOLD');
});

test('unaudited rules block a tier; NONE when the lowest tier is not fully audited', () => {
  const { rules } = loadRules('example');
  const level = results => computeCurrentTier(buildTierSummary(rules, results, t3), t3);
  const all = tier => rules.filter(r => r.tier === tier).map(r => ({ id: r.id, status: 'pass' }));
  assert.equal(level([{ id: 'BRONZE-1', status: 'pass' }]), 'NONE');
  assert.equal(level([]), 'NONE');
  assert.equal(level([...all('BRONZE')]), 'BRONZE');
  assert.equal(level([...all('BRONZE'), { id: 'SILVER-1', status: 'pass' }]), 'BRONZE');
  assert.equal(level([...all('BRONZE'), ...all('SILVER'), ...all('GOLD')]), 'GOLD');
  // partial and na do not block
  const mixed = all('BRONZE'); mixed[0].status = 'partial'; mixed[1].status = 'na';
  assert.equal(level(mixed), 'BRONZE');
  // HARD_FAIL takes precedence over unaudited
  assert.equal(level([{ id: 'BRONZE-1', status: 'fail' }]), 'HARD_FAIL');
  const s = buildTierSummary(rules, [{ id: 'BRONZE-1', status: 'pass' }], t3);
  assert.deepEqual(s.BRONZE, { pass: 1, fail: 0, partial: 0, na: 0, total: 6 });
});

test('merge/report show unaudited count; NONE wording; heading printed once', () => {
  const sb = sandbox('example');
  const r = sb.run('merge', sb.writeTmp('m.json', { results: [{ id: 'SILVER-6', status: 'na', evidence: 'no DB deps' }, { id: 'BRONZE-1', status: 'pass', evidence: 'ci' }] }));
  assert.equal(r.stdout.split('\n')[0], 'merged 2 results · level: NONE · 15 rules not audited');
  const md = sb.run('report').stdout;
  assert.match(md, /Compliance level: not reached — 15 rules not audited/);
  assert.equal(md.split('## Not applicable').length - 1, 1);
  // full bronze audit, rest unaudited -> reached with an Unaudited line
  const bronze = loadRules('example').rules.filter(x => x.tier === 'BRONZE').map(x => ({ id: x.id, status: 'pass' }));
  const r2 = sb.run('merge', sb.writeTmp('b.json', bronze));
  assert.match(r2.stdout, /level: BRONZE · 10 rules not audited/);
  assert.match(sb.run('report').stdout, /Compliance level: Bronze\nUnaudited: 10 rules/);
});

test('tiers are ordered by `order`, not array position', () => {
  const shuffled = [t3[2], t3[0], t3[1]];
  assert.equal(computeCurrentTier(fails(['BRONZE', 'SILVER', 'GOLD'], { GOLD: 1 }), shuffled), 'SILVER');
});

// ---------- rank ----------

test('rank: tier, effort, file_count, rule order', () => {
  const { rules } = loadRules('example');
  const results = [
    { id: 'GOLD-1', status: 'fail', effort_tier: 'trivial', file_count: 1 },
    { id: 'SILVER-2', status: 'fail', effort_tier: 'large', file_count: 1 },
    { id: 'SILVER-1', status: 'fail', effort_tier: 'small', file_count: 9 },
    { id: 'BRONZE-3', status: 'fail' }, // unknown effort sorts last within tier
    { id: 'BRONZE-2', status: 'fail', effort_tier: 'small', file_count: 5 },
    { id: 'BRONZE-1', status: 'fail', effort_tier: 'small', file_count: 2 },
    { id: 'SILVER-3', status: 'fail', effort_tier: 'small', file_count: 9 },
  ];
  const order = rankCandidates(rules, results, t3).map(r => r.id);
  assert.deepEqual(order, ['BRONZE-1', 'BRONZE-2', 'BRONZE-3', 'SILVER-1', 'SILVER-3', 'SILVER-2', 'GOLD-1']);
});

test('rank CLI: fails first, partial only when no fails', () => {
  const sb = sandbox('example');
  const entries = [{ id: 'BRONZE-1', status: 'partial', effort_tier: 'small', file_count: 2 }];
  assert.equal(sb.run('merge', sb.writeTmp('m.json', entries)).status, 0);
  assert.match(sb.run('rank').stdout, /^BRONZE-1 — CI runs on every pull request — 2 files · small effort/);
  sb.run('merge', sb.writeTmp('m2.json', [{ id: 'SILVER-1', status: 'fail' }]));
  const out = sb.run('rank').stdout;
  assert.match(out, /SILVER-1/);
  assert.doesNotMatch(out, /BRONZE-1/);
});

// ---------- ids ----------

test('ids: recheck vs full vs tier vs list (pure)', () => {
  const { rules } = loadRules('example');
  const results = [
    { id: 'BRONZE-1', status: 'pass' },
    { id: 'BRONZE-2', status: 'fail' },
    { id: 'SILVER-1', status: 'partial' },
  ];
  const ids = a => selectIds(a, rules, results, t3);
  assert.equal(ids('full').length, 17);
  const re = ids('recheck');
  assert.ok(re.includes('BRONZE-2') && re.includes('SILVER-1') && re.includes('GOLD-1'));
  assert.ok(!re.includes('BRONZE-1'));
  assert.deepEqual(ids('gold'), ['GOLD-1', 'GOLD-2', 'GOLD-3', 'GOLD-4', 'GOLD-5']);
  assert.deepEqual(ids('BRONZE-1,SILVER-2'), ['BRONZE-1', 'SILVER-2']);
  assert.deepEqual(groupByTier(ids('BRONZE-1,GOLD-1,SILVER-2,BRONZE-2'), rules, t3),
    ['BRONZE: BRONZE-1,BRONZE-2', 'SILVER: SILVER-2', 'GOLD: GOLD-1']);
});

test('ids CLI output format', () => {
  const sb = sandbox('example');
  assert.equal(sb.run('ids', 'SILVER').stdout, 'SILVER: SILVER-1,SILVER-2,SILVER-3,SILVER-4,SILVER-5,SILVER-6\n');
  assert.equal(sb.run('ids', 'GOLD-2,BRONZE-1').stdout, 'BRONZE: BRONZE-1\nGOLD: GOLD-2\n');
  assert.equal(sb.run('ids', 'recheck').stdout.trim().split('\n').length, 3); // nothing audited -> all rules
});

// ---------- merge + report ----------

test('merge: validation rejects bad status and unknown id', () => {
  const sb = sandbox('example');
  let r = sb.run('merge', sb.writeTmp('a.json', { results: [{ id: 'BRONZE-1', status: 'ok' }] }));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /status must be one of pass\|partial\|fail\|na/);
  r = sb.run('merge', sb.writeTmp('b.json', [{ id: 'NOPE-9', status: 'pass' }]));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /unknown rule id "NOPE-9"/);
  r = sb.run('merge', sb.writeTmp('c.json', '{"x":1}'));
  assert.equal(r.status, 1);
  assert.equal(fs.existsSync(path.join(sb.dir, 'compliance.json')), false);
});

test('merge: writes compliance, strips effort on pass, regenerates report', () => {
  const sb = sandbox('example');
  const first = [
    { id: 'BRONZE-1', status: 'fail', evidence: 'no pipeline', file_count: 1, effort_tier: 'small', blast_radius: [] },
    { id: 'SILVER-1', status: 'partial', evidence: 'few tests' },
    { id: 'GOLD-1', status: 'pass', evidence: 'ok', effort_tier: 'small' },
  ];
  const r = sb.run('merge', sb.writeTmp('m.json', { results: first }));
  assert.equal(r.status, 0);
  const reportFile = path.join(sb.root, 'docs', 'eqc-report.md');
  assert.match(r.stdout, new RegExp(`report: ${reportFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  let c = sb.readJson('compliance.json');
  assert.equal(c.schema, 1);
  assert.match(c.audited_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(c.standard_version, '1.0');
  assert.equal(c.current_tier, 'HARD_FAIL');
  assert.equal(c.results.find(x => x.id === 'GOLD-1').effort_tier, undefined);
  assert.deepEqual(c.tier_summary.BRONZE, { pass: 0, fail: 1, partial: 0, na: 0, total: 6 });
  let md = fs.readFileSync(reportFile, 'utf8');
  assert.match(md, /Compliance level: HARD_FAIL/);
  assert.match(md, /\| Bronze \| 0 \| 0 \| 1 \| 0 \| 6 \|/);
  assert.match(md, /- \*\*BRONZE-1\*\* — CI runs on every pull request — no pipeline/);
  assert.match(md, /## Partials/);
  assert.match(md, /Generated by eqc-kit — do not edit by hand/);

  // replace by id: fix BRONZE-1
  sb.run('merge', sb.writeTmp('m2.json', [{ id: 'BRONZE-1', status: 'pass', effort_tier: 'small' }]));
  c = sb.readJson('compliance.json');
  assert.equal(c.results.length, 3);
  assert.equal(c.current_tier, 'NONE');
  md = fs.readFileSync(reportFile, 'utf8');
  assert.match(md, /Compliance level: not reached — 14 rules not audited/);
  assert.doesNotMatch(md, /## Fails/);
});

test('report prints markdown; --write writes it; no config -> error', () => {
  const sb = sandbox('example');
  sb.run('merge', sb.writeTmp('m.json', [{ id: 'BRONZE-2', status: 'pass' }]));
  fs.rmSync(path.join(sb.root, 'docs'), { recursive: true });
  assert.match(sb.run('report').stdout, /Standard: Example Engineering Quality Standard v1.0/);
  assert.equal(fs.existsSync(path.join(sb.root, 'docs')), false);
  assert.equal(sb.run('report', '--write').status, 0);
  assert.equal(fs.existsSync(path.join(sb.root, 'docs', 'eqc-report.md')), true);
  fs.rmSync(path.join(sb.dir, 'config.json'));
  assert.equal(sb.run('report', '--write').status, 1);
  assert.equal(sb.run('merge', sb.writeTmp('n.json', [{ id: 'BRONZE-3', status: 'pass' }])).stdout.includes('report:'), false);
});

// ---------- na + reset ----------

test('na: merge accepts, strips effort, counts in summary, does not fail; report shows it', () => {
  const sb = sandbox('example');
  const r = sb.run('merge', sb.writeTmp('n.json', [
    { id: 'BRONZE-1', status: 'na', evidence: 'no database in this service', effort_tier: 'small', file_count: 1, blast_radius: [] },
    { id: 'BRONZE-2', status: 'pass' },
  ]));
  assert.equal(r.status, 0, r.stdout);
  const c = sb.readJson('compliance.json');
  const na = c.results.find(x => x.id === 'BRONZE-1');
  assert.equal(na.status, 'na');
  assert.equal(na.effort_tier, undefined);
  assert.equal(na.file_count, undefined);
  assert.deepEqual(c.tier_summary.BRONZE, { pass: 1, fail: 0, partial: 0, na: 1, total: 6 });
  assert.equal(c.current_tier, 'NONE');
  const md = sb.run('report').stdout;
  assert.match(md, /\| Bronze \| 1 \| 0 \| 0 \| 1 \| 6 \|/);
  assert.match(md, /\| Tier \| Pass \| Partial \| Fail \| N\/A \| Total \|/);
  assert.match(md, /## Not applicable\n\n- \*\*BRONZE-1\*\* — .* — no database in this service/);
  assert.doesNotMatch(md, /## Fails/);
});

test('na: excluded from rank and ids recheck (ids recheck still lists unaudited)', () => {
  const sb = sandbox('example');
  sb.run('merge', sb.writeTmp('n.json', [{ id: 'BRONZE-1', status: 'na', evidence: 'x' }, { id: 'BRONZE-2', status: 'fail' }]));
  const rank = sb.run('rank').stdout;
  assert.match(rank, /BRONZE-2/);
  assert.doesNotMatch(rank, /BRONZE-1/);
  assert.doesNotMatch(sb.run('ids', 'recheck').stdout, /BRONZE-1\b/);
  const { rules } = loadRules('example');
  const re = selectIds('recheck', rules, [{ id: 'BRONZE-1', status: 'na' }], t3);
  assert.ok(!re.includes('BRONZE-1') && re.includes('BRONZE-2'));
  sb.run('merge', sb.writeTmp('n2.json', [{ id: 'BRONZE-2', status: 'pass' }]));
  assert.equal(sb.run('rank').stdout, '');
});

test('reset: removes rules/compliance/doc-meta, keeps milestones, plans, config, standard', () => {
  const sb = sandbox('example');
  sb.run('merge', sb.writeTmp('m.json', [{ id: 'BRONZE-1', status: 'pass' }]));
  sb.run('milestone', 'add', '{"rule_id":"BRONZE-1","tier":"BRONZE","status":"done","summary":"x"}');
  fs.mkdirSync(path.join(sb.dir, 'plans'));
  fs.writeFileSync(path.join(sb.dir, 'plans', 'P.md'), 'x');
  fs.writeFileSync(path.join(sb.dir, 'doc-meta.md'), 'x');
  const r = sb.run('reset');
  assert.equal(r.status, 0);
  for (const f of ['rules.json', 'compliance.json', 'doc-meta.md']) assert.equal(fs.existsSync(path.join(sb.dir, f)), false, f);
  for (const f of ['milestones.json', 'config.json', path.join('plans', 'P.md')]) assert.equal(fs.existsSync(path.join(sb.dir, f)), true, f);
  assert.equal(sb.run('reset').status, 0); // idempotent
  assert.equal(sb.run('report').status, 2);
});

// ---------- milestone ----------

test('milestone add: validation and auto-fill', () => {
  const sb = sandbox('example');
  let r = sb.run('milestone', 'add', '{"rule_id":"BRONZE-1","tier":"BRONZE","summary":"x"}');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing required field\(s\): status/);
  r = sb.run('milestone', 'add', '{"rule_id":"BRONZE-1","tier":"BRONZE","status":"nope","summary":"x"}');
  assert.equal(r.status, 1);
  assert.equal(sb.run('milestone', 'add', 'not json').status, 1);
  assert.equal(fs.existsSync(path.join(sb.dir, 'milestones.json')), false);

  r = sb.run('milestone', 'add', '{"rule_id":"BRONZE-1","tier":"BRONZE","status":"done","summary":"added CI"}');
  assert.equal(r.status, 0);
  sb.run('milestone', 'add', '{"id":"M-custom","date":"2026-02-02","rule_id":"BRONZE-2","tier":"BRONZE","status":"blocked","summary":"waiting"}');
  const list = sb.readJson('milestones.json');
  assert.equal(list.length, 2);
  assert.match(list[0].id, /^M-\d+$/);
  assert.match(list[0].date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(list[1], { id: 'M-custom', date: '2026-02-02', rule_id: 'BRONZE-2', tier: 'BRONZE', status: 'blocked', summary: 'waiting' });
});

// ---------- config ----------

test('config get', () => {
  const sb = sandbox('example');
  assert.equal(sb.run('config', 'get', 'report_path').stdout, 'docs/eqc-report.md\n');
  assert.equal(sb.run('config', 'get', 'schema').stdout, '1\n');
  fs.writeFileSync(path.join(sb.dir, 'config.json'), JSON.stringify({ a: { b: [1, 2], c: 'x' } }));
  assert.equal(sb.run('config', 'get', 'a').stdout, '{"b":[1,2],"c":"x"}\n');
  assert.equal(sb.run('config', 'get', 'a.b').stdout, '[1,2]\n');
  assert.equal(sb.run('config', 'get', 'a.c').stdout, 'x\n');
  assert.equal(sb.run('config', 'get', 'a.zzz').status, 1);
  fs.rmSync(path.join(sb.dir, 'config.json'));
  assert.equal(sb.run('config', 'get', 'a').status, 1);
});

// ---------- chunks ----------

test('chunks parsing and CLI', () => {
  const plan = '# X\n- [x] 1 [mechanical] a.js, b.js\n- [ ] 2 [judgment] c.js\nnoise';
  const chunks = parsePlanChunks(plan);
  assert.deepEqual(chunks[0], { done: true, num: 1, tag: 'mechanical', files: 'a.js, b.js' });
  assert.equal(formatChunkStatus(chunks), '1/2 done · next: 2 [judgment] c.js');
  assert.equal(formatChunkStatus(parsePlanChunks('- [x] 1 [m] a')), 'all done (1/1)');
  assert.equal(formatChunkStatus([]), 'no plan');
  const sb = sandbox('example');
  assert.equal(sb.run('chunks', 'BRONZE-1').stdout, 'no plan\n');
  fs.mkdirSync(path.join(sb.dir, 'plans'));
  fs.writeFileSync(path.join(sb.dir, 'plans', 'BRONZE-1.md'), plan);
  assert.equal(sb.run('chunks', 'BRONZE-1').stdout, '1/2 done · next: 2 [judgment] c.js\n');
});

// ---------- check-ids ----------

test('check-ids passes on example.md', () => {
  const sb = sandbox('example');
  const r = sb.run('check-ids', EXAMPLE_MD);
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.stdout.trim(), 'check-ids: 17 rules OK');
});

test('check-ids fails when a source_line is shifted', () => {
  const sb = sandbox('example');
  const doc = loadRules('example');
  doc.rules.find(r => r.id === 'BRONZE-2').source_line += 1; // now points at rule 3
  doc.rules.find(r => r.id === 'GOLD-1').source_line = 20;   // blank line, wrong section
  fs.writeFileSync(path.join(sb.dir, 'rules.json'), JSON.stringify(doc));
  const r = sb.run('check-ids', EXAMPLE_MD);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /BRONZE-2: line 16 is numbered 3, expected 2/);
  assert.match(r.stdout, /GOLD-1: source_line 20 is not inside the GOLD section/);
});

test('check-ids (pure): missing heading, title mismatch', () => {
  const rules = [{ id: 'BRONZE-1', tier: 'BRONZE', title: 'Something else entirely', source_line: 14 }];
  const md = fs.readFileSync(EXAMPLE_MD, 'utf8');
  assert.match(checkIds(md, rules, t3).mismatches[0].reason, /doesn't contain title/);
  const noHeading = checkIds('1. **A**', [{ id: 'X-1', tier: 'X', title: 'A', source_line: 1 }], [{ id: 'X', order: 1, section_heading: 'Nope' }]);
  assert.match(noHeading.mismatches[0].reason, /not inside the X section/);
});

// ---------- misc CLI ----------

test('missing index exits 2 with message', () => {
  const sb = sandbox(null);
  for (const cmd of [['report'], ['rank'], ['ids', 'full'], ['get', 'A-1'], ['check-ids', EXAMPLE_MD]]) {
    const r = sb.run(...cmd);
    assert.equal(r.status, 2, cmd.join(' '));
    assert.match(r.stdout, /^No index yet — run `eqc check` in your AI agent first/);
  }
});

test('unknown command exits 1 with usage; selftest passes', () => {
  const sb = sandbox('example');
  const r = sb.run('bogus');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^usage:/);
  const st = sb.run('selftest');
  assert.equal(st.status, 0);
  assert.equal(st.stdout.trim(), 'selftest ok');
});

test('get returns rule + compliance JSON', () => {
  const sb = sandbox('example');
  const out = JSON.parse(sb.run('get', 'BRONZE-1,NOPE').stdout);
  assert.equal(out[0].rule.title, 'CI runs on every pull request');
  assert.equal(out[0].compliance, null);
  assert.equal(out[1].rule, null);
});

test('state dir defaults to parent of script dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eqc-vendor-'));
  fs.mkdirSync(path.join(root, '.eqc', 'bin'), { recursive: true });
  fs.cpSync(fixture('example'), path.join(root, '.eqc'), { recursive: true });
  fs.copyFileSync(ENGINE, path.join(root, '.eqc', 'bin', 'eqc.mjs'));
  const env = { ...process.env }; delete env.EQC_DIR;
  const r = spawnSync('node', [path.join(root, '.eqc', 'bin', 'eqc.mjs'), 'config', 'get', 'report_path'], { env, encoding: 'utf8' });
  assert.equal(r.stdout, 'docs/eqc-report.md\n');
});

// ---------- guardrails: digest, verify ----------

// Example fixture with verify commands on two Rules; returns sandbox after a merge.
function guarded(results, verify = { 'SILVER-3': 'exit 1', 'BRONZE-2': 'true' }) {
  const sb = sandbox('example');
  const doc = sb.readJson('rules.json');
  for (const r of doc.rules) if (verify[r.id]) r.verify = verify[r.id];
  fs.writeFileSync(path.join(sb.dir, 'rules.json'), JSON.stringify(doc));
  assert.equal(sb.run('merge', sb.writeTmp('m.json', results)).status, 0);
  return sb;
}

test('merge writes .eqc/RULES.md digest with status and verify command', () => {
  const sb = guarded([{ id: 'BRONZE-2', status: 'pass', evidence: 'x' }]);
  const md = fs.readFileSync(path.join(sb.dir, 'RULES.md'), 'utf8');
  assert.match(md, /## Bronze/);
  assert.match(md, /- \*\*BRONZE-2\*\* \[pass\] Linter enforced — .*\(verify: `true`\)/);
  assert.match(md, /- \*\*GOLD-1\*\* \[unaudited\] Release automation/);
  assert.equal(buildDigest(loadRules('example'), { results: [] }).includes('[unaudited]'), true);
});

test('verify: runs only passing Rules with a command; exit 1 on failure; ID filter', () => {
  let sb = guarded([{ id: 'BRONZE-2', status: 'pass' }, { id: 'SILVER-3', status: 'fail' }]);
  let r = sb.run('verify');
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /ok   BRONZE-2/);
  assert.doesNotMatch(r.stdout, /SILVER-3/);
  sb = guarded([{ id: 'BRONZE-2', status: 'pass' }, { id: 'SILVER-3', status: 'pass' }], { 'SILVER-3': 'echo found console.log; exit 1', 'BRONZE-2': 'true' });
  r = sb.run('verify');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL SILVER-3[\s\S]*found console\.log[\s\S]*verify: 1 of 2 failed/);
  assert.equal(sb.run('verify', 'BRONZE-2').status, 0);
  assert.match(sandbox('example').run('verify').stdout, /no passing rules with a verify command/);
  assert.equal(sandbox().run('verify').status, 2);
});

test('verify runs commands from the repo root', () => {
  const sb = guarded([{ id: 'BRONZE-2', status: 'pass' }], { 'BRONZE-2': 'test -d .eqc' });
  assert.equal(sb.run('verify').status, 0);
});

test('guard --min: fails below the tier, rejects unknown or missing tier', () => {
  const sb = guarded([{ id: 'BRONZE-2', status: 'pass' }]);
  let r = sb.run('guard', '--min', 'BRONZE');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /guard: level NONE is below --min BRONZE/);
  assert.match(sb.run('guard', '--min', 'PLATINUM').stdout, /unknown tier "PLATINUM"/);
  assert.equal(sb.run('guard', '--min').status, 1);
  const bronze = loadRules('example').rules.filter(x => x.tier === 'BRONZE').map(x => ({ id: x.id, status: 'pass' }));
  sb.run('merge', sb.writeTmp('b.json', bronze));
  assert.equal(sb.run('guard', '--min', 'BRONZE').status, 0);
  assert.equal(sb.run('guard', '--min', 'SILVER').status, 1);
});

// ---------- baseline / guard ----------

test('updateBaseline: union of passes in rule order, level never drops', () => {
  const rd = loadRules('example');
  const b1 = updateBaseline(null, rd, { results: [{ id: 'SILVER-1', status: 'pass' }, { id: 'BRONZE-2', status: 'pass' }, { id: 'BRONZE-1', status: 'fail' }], current_tier: 'HARD_FAIL' }, 'T1');
  assert.deepEqual(b1, { schema: 1, standard_version: '1.0', level: 'HARD_FAIL', updated_at: 'T1', protected: ['BRONZE-2', 'SILVER-1'] });
  const b2 = updateBaseline({ ...b1, level: 'SILVER' }, rd, { results: [{ id: 'BRONZE-1', status: 'pass' }, { id: 'BRONZE-2', status: 'fail' }], current_tier: 'NONE' }, 'T2');
  assert.equal(b2.level, 'SILVER');
  assert.deepEqual(b2.protected, ['BRONZE-1', 'BRONZE-2', 'SILVER-1']);
  assert.equal(updateBaseline(b2, rd, { results: [], current_tier: 'GOLD' }, 'T3').level, 'GOLD');
  assert.equal(updateBaseline({ level: 'HARD_FAIL', protected: [] }, rd, { results: [], current_tier: 'NONE' }, 'T4').level, 'NONE');
});

test('findRegressions: fail, partial, not audited, na ok, unknown id ignored, level drop', () => {
  const rd = loadRules('example');
  const baseline = { level: 'BRONZE', protected: ['BRONZE-1', 'BRONZE-2', 'BRONZE-3', 'BRONZE-4', 'BRONZE-5', 'GONE-1'] };
  const compliance = { results: [
    { id: 'BRONZE-1', status: 'fail' }, { id: 'BRONZE-2', status: 'partial' },
    { id: 'BRONZE-4', status: 'na' }, { id: 'BRONZE-5', status: 'pass' },
  ], current_tier: 'HARD_FAIL' };
  assert.deepEqual(findRegressions(rd, compliance, baseline), {
    rules: [
      { id: 'BRONZE-1', title: 'CI runs on every pull request', status: 'fail' },
      { id: 'BRONZE-2', title: 'Linter enforced', status: 'partial' },
      { id: 'BRONZE-3', title: 'Code formatter configured', status: 'not audited' },
    ],
    levelDrop: { current: 'HARD_FAIL', baseline: 'BRONZE' },
  });
  assert.deepEqual(findRegressions(rd, { results: [{ id: 'BRONZE-5', status: 'na' }], current_tier: 'GOLD' }, { level: 'BRONZE', protected: ['BRONZE-5'] }), { rules: [], levelDrop: null });
});

test('guard CLI: no index 2, no baseline 0, ok 0, regression 1; merge writes baseline; reset deletes it', () => {
  assert.equal(sandbox(null).run('guard').status, 2);
  const sb = sandbox('example');
  let r = sb.run('guard');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'guard: no baseline yet');
  const bronze = loadRules('example').rules.filter(x => x.tier === 'BRONZE').map(x => ({ id: x.id, status: 'pass' }));
  r = sb.run('merge', sb.writeTmp('b.json', bronze));
  assert.match(r.stdout, /\nbaseline: BRONZE · 6 protected\n/);
  const b = sb.readJson('baseline.json');
  assert.equal(b.schema, 1);
  assert.equal(b.level, 'BRONZE');
  assert.equal(b.standard_version, '1.0');
  assert.equal(b.protected.length, 6);
  r = sb.run('guard');
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'guard: ok · baseline BRONZE · 6 protected rules');
  r = sb.run('merge', sb.writeTmp('f.json', [{ id: 'BRONZE-1', status: 'fail' }]));
  assert.match(r.stdout, /baseline: BRONZE · 6 protected\nguard: 2 regressions — run eqc guard/);
  r = sb.run('guard');
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trim(), 'guard: REGRESSION\n- BRONZE-1 — CI runs on every pull request — now fail\n- level HARD_FAIL below baseline BRONZE');
  assert.equal(sb.readJson('baseline.json').level, 'BRONZE');
  const md = sb.run('report').stdout;
  assert.match(md, /Baseline: BRONZE · 6 protected · guard: 2 regressions/);
  assert.match(md, /## Regressions\n\n- BRONZE-1 — CI runs on every pull request — now fail/);
  sb.run('reset');
  assert.equal(fs.existsSync(path.join(sb.dir, 'baseline.json')), false);
});

test('report: To reach lists blocking rules as ID — title; Not audited section', () => {
  const sb = sandbox('example');
  sb.run('merge', sb.writeTmp('m.json', [{ id: 'BRONZE-1', status: 'fail' }, { id: 'BRONZE-2', status: 'partial' }, { id: 'BRONZE-3', status: 'pass' }]));
  let md = sb.run('report').stdout;
  assert.match(md, /Baseline: HARD_FAIL · 1 protected · guard: ok/);
  assert.match(md, /## To reach Bronze\n\n- \*\*BRONZE-1\*\* — CI runs on every pull request — fail\n- \*\*BRONZE-4\*\* — README has setup instructions — not audited\n/);
  assert.doesNotMatch(md, /To reach[^\n]*\n[^#]*BRONZE-2/);
  assert.match(md, /## Not audited\n\n- \*\*BRONZE-4\*\* — README has setup instructions\n/);
  assert.doesNotMatch(md, /## Regressions/);
  // top tier reached, everything audited -> both sections omitted
  const all = loadRules('example').rules.map(x => ({ id: x.id, status: 'pass' }));
  sb.run('merge', sb.writeTmp('a.json', all));
  md = sb.run('report').stdout;
  assert.doesNotMatch(md, /## To reach/);
  assert.doesNotMatch(md, /## Not audited/);
});

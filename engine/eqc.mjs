#!/usr/bin/env node
// eqc-kit engine: bookkeeping for rules.json / compliance.json / milestones.json.
// Owns schemas, tier math, merge and reports. Node >=18, stdlib only.
// Vendored at <repo>/.eqc/bin/eqc.mjs; state dir = EQC_DIR or the parent of bin/.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EFFORT_ORDER = { trivial: 0, small: 1, medium: 2, large: 3 };
const STATUSES = ['pass', 'partial', 'fail'];
const MILESTONE_STATUSES = ['done', 'partial', 'blocked', 'failed'];
const NO_INDEX_MSG = 'No index yet — run `eqc check` in your AI agent first (it indexes the standard).';

// ---------- paths ----------

export function stateDir() {
  return process.env.EQC_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}
const file = name => path.join(stateDir(), name);

// ---------- tiers (pure) ----------

export function tierIds(tiers) {
  return tiers.slice().sort((a, b) => a.order - b.order).map(t => t.id);
}

export function buildTierSummary(rules, results, tiers) {
  const byId = new Map(results.map(r => [r.id, r]));
  const blank = () => ({ pass: 0, fail: 0, partial: 0, total: 0 });
  const summary = {};
  for (const id of tierIds(tiers)) summary[id] = blank();
  for (const rule of rules) {
    if (!summary[rule.tier]) summary[rule.tier] = blank();
    const s = summary[rule.tier];
    const res = byId.get(rule.id);
    s.total += 1;
    if (res && s[res.status] !== undefined && res.status !== 'total') s[res.status] += 1;
  }
  return summary;
}

// HARD_FAIL if the lowest tier has a fail; else last tier before the first tier with a fail.
export function computeCurrentTier(summary, tiers) {
  const ids = tierIds(tiers);
  if (ids.length === 0) return 'HARD_FAIL';
  if ((summary[ids[0]] || { fail: 0 }).fail > 0) return 'HARD_FAIL';
  let achieved = ids[0];
  for (const id of ids) {
    const s = summary[id];
    if (!s || s.fail > 0) break;
    achieved = id;
  }
  return achieved;
}

// ---------- results (pure) ----------

export function stripEffortFieldsOnPass(results) {
  return results.map(r => {
    if (r.status !== 'pass') return r;
    const { file_count, effort_tier, blast_radius, ...rest } = r;
    return rest;
  });
}

export function mergeResults(existing, incoming) {
  const merged = existing.slice();
  const idx = new Map(merged.map((r, i) => [r.id, i]));
  for (const entry of incoming) {
    if (idx.has(entry.id)) merged[idx.get(entry.id)] = entry;
    else { idx.set(entry.id, merged.length); merged.push(entry); }
  }
  return merged;
}

// Returns a list of problem strings (empty = valid).
export function validateResults(entries, rules) {
  const known = new Set(rules.map(r => r.id));
  const problems = [];
  entries.forEach((e, i) => {
    if (!e || typeof e !== 'object') { problems.push(`entry ${i}: not an object`); return; }
    if (!known.has(e.id)) problems.push(`entry ${i}: unknown rule id "${e.id}"`);
    if (!STATUSES.includes(e.status)) problems.push(`entry ${i} (${e.id}): status must be one of ${STATUSES.join('|')}, got "${e.status}"`);
  });
  return problems;
}

export function todayLocal() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// ---------- rank (pure) ----------

function effortRank(effort) {
  return effort in EFFORT_ORDER ? EFFORT_ORDER[effort] : EFFORT_ORDER.large + 1;
}

// tier order, then effort, then file_count, then rule order
export function rankCandidates(rules, results, tiers) {
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const ids = tierIds(tiers);
  const tierRank = t => (ids.indexOf(t) === -1 ? ids.length : ids.indexOf(t));
  return results.slice().sort((a, b) => {
    const ra = ruleById.get(a.id), rb = ruleById.get(b.id);
    const t = tierRank(ra && ra.tier) - tierRank(rb && rb.tier);
    if (t !== 0) return t;
    const e = effortRank(a.effort_tier) - effortRank(b.effort_tier);
    if (e !== 0) return e;
    const f = (a.file_count ?? Infinity) - (b.file_count ?? Infinity);
    if (f !== 0 && !Number.isNaN(f)) return f;
    return ((ra && ra.order) || 0) - ((rb && rb.order) || 0);
  });
}

// ---------- ids selection (pure) ----------

export function selectIds(arg, rules, results, tiers) {
  const a = arg.trim();
  const byId = new Map(results.map(r => [r.id, r]));
  if (/^full$/i.test(a)) return rules.map(r => r.id);
  if (/^recheck$/i.test(a)) {
    return rules
      .filter(r => { const v = byId.get(r.id); return !v || v.status === 'fail' || v.status === 'partial'; })
      .map(r => r.id);
  }
  const tier = tierIds(tiers).find(t => t.toLowerCase() === a.toLowerCase());
  if (tier && !a.includes(',')) return rules.filter(r => r.tier === tier).map(r => r.id);
  return a.split(',').map(s => s.trim()).filter(Boolean);
}

export function groupByTier(ids, rules, tiers) {
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const groups = {};
  for (const id of ids) {
    const tier = ruleById.get(id)?.tier ?? 'UNKNOWN';
    (groups[tier] = groups[tier] || []).push(id);
  }
  const order = [...tierIds(tiers), 'UNKNOWN'];
  return order.filter(t => groups[t]).map(t => `${t}: ${groups[t].join(',')}`);
}

// ---------- plan chunks (pure) ----------

export function parsePlanChunks(text) {
  const re = /^- \[( |x)\] (\d+) \[(\w+)\] (.+)$/;
  const chunks = [];
  for (const line of text.split('\n')) {
    const m = re.exec(line.trim());
    if (m) chunks.push({ done: m[1] === 'x', num: Number(m[2]), tag: m[3], files: m[4].trim() });
  }
  return chunks;
}

export function formatChunkStatus(chunks) {
  if (chunks.length === 0) return 'no plan';
  const total = chunks.length;
  const done = chunks.filter(c => c.done).length;
  if (done === total) return `all done (${total}/${total})`;
  const next = chunks.find(c => !c.done);
  return `${done}/${total} done · next: ${next.num} [${next.tag}] ${next.files}`;
}

// ---------- doc parsing / check-ids (pure) ----------

function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function stripLine(line) {
  return line
    .replace(/&nbsp;/gi, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // markdown link -> its text
    .replace(/[*\\]/g, '')
    .replace(/^[\s>+-]+/, '') // blockquote / bullet noise
    .trim();
}

function normalizeText(s) {
  return stripLine(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function normalizeHeading(s) {
  return normalizeText((s || '').replace(/^\s*#+\s*/, '').replace(/\s*#+\s*$/, ''));
}

// Each tier's section: from its heading line to the next tier heading (by position) or EOF.
export function findTierSections(lines, tiers) {
  const heads = [];
  for (const t of tiers) {
    const want = normalizeHeading(t.section_heading);
    const line = lines.findIndex(l => /^\s*#+\s/.test(l) && normalizeHeading(l) === want);
    if (line !== -1) heads.push({ tier: t.id, line });
  }
  heads.sort((a, b) => a.line - b.line);
  return heads.map((h, i) => ({
    tier: h.tier,
    start: h.line + 1,
    end: i + 1 < heads.length ? heads[i + 1].line : lines.length,
  }));
}

function checkOneRuleId(rule, lines, sections) {
  if (rule.source_line === undefined || rule.source_line === null) return 'missing source_line';
  const idx = rule.source_line - 1;
  if (idx < 0 || idx >= lines.length) return `source_line ${rule.source_line} is out of range`;
  const section = sections.find(s => s.tier === rule.tier && idx >= s.start && idx < s.end);
  if (!section) return `source_line ${rule.source_line} is not inside the ${rule.tier} section`;

  const stripped = stripLine(lines[idx]);
  const expected = String(rule.id).split('-').pop();
  const m = /^(\d+)\./.exec(stripped);
  if (!m) return `line ${rule.source_line} has no leading "<n>." ("${truncate(stripped, 40)}")`;
  if (m[1] !== expected) return `line ${rule.source_line} is numbered ${m[1]}, expected ${expected}`;

  const title = normalizeText(rule.title);
  const needle = title.slice(0, 20);
  if (!needle || !normalizeText(stripped).includes(needle)) {
    return `line ${rule.source_line} doesn't contain title "${rule.title}"`;
  }
  return null;
}

export function checkIds(docText, rules, tiers) {
  const lines = docText.split('\n');
  const sections = findTierSections(lines, tiers);
  const mismatches = [];
  let okCount = 0;
  for (const rule of rules) {
    const reason = checkOneRuleId(rule, lines, sections);
    if (reason) mismatches.push({ id: rule.id, reason });
    else okCount += 1;
  }
  return { mismatches, okCount };
}

// ---------- report (pure) ----------

export function buildReport(rulesDoc, compliance) {
  const { tiers, rules } = rulesDoc;
  const std = rulesDoc.standard || {};
  const tierName = new Map(tiers.map(t => [t.id, t.name]));
  const cur = compliance.current_tier;
  const level = cur === 'HARD_FAIL' ? 'HARD_FAIL' : (tierName.get(cur) || cur || 'not audited');
  const out = [];
  out.push(`# ${std.title || 'EQC'} — compliance report`, '');
  out.push(`Standard: ${std.title || '?'} v${std.version || '?'}`);
  out.push(`Audited: ${compliance.audited_at || 'never'}`);
  out.push(`Compliance level: ${level}`, '');
  out.push('| Tier | Pass | Partial | Fail | Total |', '|---|---|---|---|---|');
  for (const id of tierIds(tiers)) {
    const s = (compliance.tier_summary || {})[id] || { pass: 0, fail: 0, partial: 0, total: 0 };
    out.push(`| ${tierName.get(id)} | ${s.pass} | ${s.partial} | ${s.fail} | ${s.total} |`);
  }
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const bullets = status => (compliance.results || [])
    .filter(r => r.status === status)
    .map(r => `- **${r.id}** — ${ruleById.get(r.id)?.title ?? '(unknown rule)'} — ${truncate(r.evidence || r.notes || '', 160)}`);
  for (const [heading, status] of [['Fails', 'fail'], ['Partials', 'partial']]) {
    const items = bullets(status);
    if (items.length) out.push('', `## ${heading}`, '', ...items);
  }
  out.push('', '_Generated by eqc-kit — do not edit by hand_', '');
  return out.join('\n');
}

// ---------- file IO ----------

function readJson(p) {
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

function fail(msg, code = 1) {
  console.log(msg);
  process.exit(code);
}

// Loads rules (exit 2 when missing) plus compliance (empty when not audited yet).
function requireData() {
  const rulesDoc = readJson(file('rules.json'));
  if (!rulesDoc) fail(NO_INDEX_MSG, 2);
  const compliance = readJson(file('compliance.json')) || { results: [] };
  return { rulesDoc, rules: rulesDoc.rules, tiers: rulesDoc.tiers, compliance };
}

function reportPath() {
  const cfg = readJson(file('config.json'));
  if (!cfg || !cfg.report_path) return null;
  return path.resolve(path.dirname(stateDir()), cfg.report_path);
}

function writeReport(rulesDoc, compliance) {
  const p = reportPath();
  if (!p) return null;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buildReport(rulesDoc, compliance));
  return p;
}

// ---------- commands ----------

function cmdReport(args) {
  const { rulesDoc, compliance } = requireData();
  if (args.includes('--write')) {
    const p = writeReport(rulesDoc, compliance);
    if (!p) fail('report --write: no report_path in config.json');
    console.log(`report: ${p}`);
    return;
  }
  process.stdout.write(buildReport(rulesDoc, compliance));
}

function cmdRank(keyword) {
  const { rules, tiers, compliance } = requireData();
  let candidates = compliance.results.filter(r => r.status === 'fail');
  if (candidates.length === 0) candidates = compliance.results.filter(r => r.status === 'partial');
  const ruleById = new Map(rules.map(r => [r.id, r]));
  let list = candidates;
  if (keyword) {
    const kw = keyword.toLowerCase();
    const filtered = candidates.filter(r => {
      const rule = ruleById.get(r.id);
      return rule && ((rule.title || '').toLowerCase().includes(kw) || (rule.detail || '').toLowerCase().includes(kw));
    });
    if (filtered.length === 0) console.log(`no candidates match "${keyword}" — showing unfiltered list`);
    else list = filtered;
  }
  for (const res of rankCandidates(rules, list, tiers)) {
    const title = ruleById.get(res.id)?.title ?? '(unknown rule)';
    const files = res.file_count ?? '?';
    if (res.effort_tier === undefined) {
      console.log(`${res.id} — ${title} — ${files} files · unknown effort — recheck needed`);
    } else {
      const flags = res.blast_radius?.length ? ` ⚠ ${res.blast_radius.join(', ')}` : '';
      console.log(`${res.id} — ${title} — ${files} files · ${res.effort_tier} effort${flags}`);
    }
  }
}

function cmdIds(arg) {
  const { rules, tiers, compliance } = requireData();
  if (!arg) fail('usage: eqc.mjs ids <recheck|full|TIERID|ID,ID,...>');
  for (const line of groupByTier(selectIds(arg, rules, compliance.results, tiers), rules, tiers)) console.log(line);
}

function cmdGet(idsArg) {
  const { rules, compliance } = requireData();
  const ids = idsArg.join(' ').split(',').flatMap(s => s.trim().split(/\s+/)).filter(Boolean);
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const resById = new Map(compliance.results.map(r => [r.id, r]));
  console.log(JSON.stringify(ids.map(id => ({ rule: ruleById.get(id) || null, compliance: resById.get(id) || null }))));
}

function cmdMerge(filePath) {
  const { rulesDoc, rules, tiers, compliance } = requireData();
  let raw;
  try { raw = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { fail(`merge: cannot read ${filePath}: ${e.message}`); }
  const entries = Array.isArray(raw) ? raw : raw?.results;
  if (!Array.isArray(entries)) fail('merge: input must be {"results":[...]} or an array');
  const problems = validateResults(entries, rules);
  if (problems.length) fail(problems.map(p => `merge: ${p}`).join('\n'));

  const results = stripEffortFieldsOnPass(mergeResults(compliance.results || [], entries));
  const tier_summary = buildTierSummary(rules, results, tiers);
  const current_tier = computeCurrentTier(tier_summary, tiers);
  const updated = {
    schema: 1,
    audited_at: todayLocal(),
    standard_version: rulesDoc.standard?.version,
    results,
    tier_summary,
    current_tier,
  };
  writeJson(file('compliance.json'), updated);
  console.log(`merged ${entries.length} results · level: ${current_tier}`);
  const p = writeReport(rulesDoc, updated);
  if (p) console.log(`report: ${p}`);
}

function cmdCheckIds(docPath) {
  if (!docPath) fail('usage: eqc.mjs check-ids <doc-path>');
  if (!fs.existsSync(docPath)) fail(`check-ids: doc not found: ${docPath}`);
  const rulesDoc = readJson(file('rules.json'));
  if (!rulesDoc) fail(NO_INDEX_MSG, 2);
  const { mismatches, okCount } = checkIds(fs.readFileSync(docPath, 'utf8'), rulesDoc.rules, rulesDoc.tiers);
  for (const m of mismatches) console.log(`${m.id}: ${m.reason}`);
  if (mismatches.length) process.exit(1);
  console.log(`check-ids: ${okCount} rules OK`);
}

function cmdChunks(id) {
  if (!id) fail('usage: eqc.mjs chunks <ID>');
  const p = file(path.join('plans', `${id}.md`));
  if (!fs.existsSync(p)) return console.log('no plan');
  console.log(formatChunkStatus(parsePlanChunks(fs.readFileSync(p, 'utf8'))));
}

function cmdMilestone(sub, json) {
  if (sub !== 'add' || !json) fail("usage: eqc.mjs milestone add '<json>'");
  let m;
  try { m = JSON.parse(json); } catch (e) { fail(`milestone: invalid JSON: ${e.message}`); }
  if (!m || typeof m !== 'object' || Array.isArray(m)) fail('milestone: expected a JSON object');
  const missing = ['rule_id', 'tier', 'status', 'summary'].filter(k => !m[k]);
  if (missing.length) fail(`milestone: missing required field(s): ${missing.join(', ')}`);
  if (!MILESTONE_STATUSES.includes(m.status)) fail(`milestone: status must be one of ${MILESTONE_STATUSES.join('|')}`);
  const entry = { id: m.id || `M-${Date.now()}`, date: m.date || todayLocal(), rule_id: m.rule_id, tier: m.tier, status: m.status, summary: m.summary };
  const list = readJson(file('milestones.json')) || [];
  list.push(entry);
  writeJson(file('milestones.json'), list);
  console.log(`milestone: ${entry.id}`);
}

function cmdConfig(sub, key) {
  if (sub !== 'get' || !key) fail('usage: eqc.mjs config get <dotted.key>');
  const cfg = readJson(file('config.json'));
  if (!cfg) fail('config: no config.json');
  const val = key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), cfg);
  if (val === undefined) fail(`config: no such key: ${key}`);
  console.log(typeof val === 'object' && val !== null ? JSON.stringify(val) : String(val));
}

// ---------- selftest ----------

export function selftest() {
  const t3 = [{ id: 'A', order: 1 }, { id: 'B', order: 2 }, { id: 'C', order: 3 }];
  const sum = (a, b, c) => ({ A: { fail: a }, B: { fail: b }, C: { fail: c } });
  assert.strictEqual(computeCurrentTier(sum(1, 0, 0), t3), 'HARD_FAIL');
  assert.strictEqual(computeCurrentTier(sum(0, 2, 0), t3), 'A');
  assert.strictEqual(computeCurrentTier(sum(0, 0, 3), t3), 'B');
  assert.strictEqual(computeCurrentTier(sum(0, 0, 0), t3), 'C');

  const rules = [{ id: 'A-1', tier: 'A' }, { id: 'A-2', tier: 'A' }, { id: 'B-1', tier: 'B' }];
  const s = buildTierSummary(rules, [{ id: 'A-1', status: 'pass' }, { id: 'A-2', status: 'fail' }, { id: 'B-1', status: 'partial' }], t3);
  assert.deepStrictEqual(s.A, { pass: 1, fail: 1, partial: 0, total: 2 });
  assert.deepStrictEqual(s.C, { pass: 0, fail: 0, partial: 0, total: 0 });

  const merged = stripEffortFieldsOnPass(mergeResults(
    [{ id: 'A-1', status: 'fail', effort_tier: 'small' }],
    [{ id: 'A-1', status: 'pass' }, { id: 'B-1', status: 'fail' }]));
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].effort_tier, undefined);

  const plan = '- [x] 1 [mechanical] a.js\n- [ ] 2 [judgment] b.js';
  assert.strictEqual(formatChunkStatus(parsePlanChunks(plan)), '1/2 done · next: 2 [judgment] b.js');

  const doc = ['## Low', '1. **Alpha rule**', '## High', '1. **Gamma rule**'].join('\n');
  const tiers = [{ id: 'LOW', order: 1, section_heading: 'Low' }, { id: 'HIGH', order: 2, section_heading: 'High' }];
  const ok = checkIds(doc, [{ id: 'LOW-1', tier: 'LOW', title: 'Alpha rule', source_line: 2 }, { id: 'HIGH-1', tier: 'HIGH', title: 'Gamma rule', source_line: 4 }], tiers);
  assert.strictEqual(ok.okCount, 2);
  const bad = checkIds(doc, [{ id: 'LOW-1', tier: 'LOW', title: 'Alpha rule', source_line: 4 }], tiers);
  assert.match(bad.mismatches[0].reason, /not inside the LOW section/);
  console.log('selftest ok');
}

// ---------- CLI dispatch ----------

const USAGE = 'usage: eqc.mjs <selftest|report [--write]|rank [keyword]|ids <...>|get <ID...>|merge <file>|chunks <ID>|check-ids <doc>|milestone add <json>|config get <key>>';

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'selftest': return selftest();
    case 'report': return cmdReport(args);
    case 'rank': return cmdRank(args[0]);
    case 'ids': return cmdIds(args[0]);
    case 'get': return cmdGet(args);
    case 'merge': return args[0] ? cmdMerge(args[0]) : fail('usage: eqc.mjs merge <file>');
    case 'chunks': return cmdChunks(args[0]);
    case 'check-ids': return cmdCheckIds(args[0]);
    case 'milestone': return cmdMilestone(args[0], args[1]);
    case 'config': return cmdConfig(args[0], args[1]);
    default: return fail(USAGE);
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isDirect) main();

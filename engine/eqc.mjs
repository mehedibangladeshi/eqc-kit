#!/usr/bin/env node
// eqc-kit engine: bookkeeping for rules.json / compliance.json / milestones.json.
// Owns schemas, tier math, merge and reports. Node >=18, stdlib only.
// Vendored at <repo>/.eqc/bin/eqc.mjs; state dir = EQC_DIR or the parent of bin/.

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EFFORT_ORDER = { trivial: 0, small: 1, medium: 2, large: 3 };
const STATUSES = ['pass', 'partial', 'fail', 'na'];
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
  const blank = () => ({ pass: 0, fail: 0, partial: 0, na: 0, total: 0 });
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

export function unauditedCount(s) {
  return Math.max(0, (s?.total ?? 0) - (s?.pass ?? 0) - (s?.partial ?? 0) - (s?.fail ?? 0) - (s?.na ?? 0));
}

export function totalUnaudited(summary) {
  return Object.values(summary || {}).reduce((n, s) => n + unauditedCount(s), 0);
}

// HARD_FAIL if the lowest tier has a fail. A tier is reached when it and every lower tier
// have no fails and no unaudited rules. Nothing reached (lowest tier not fully audited) -> NONE.
export function computeCurrentTier(summary, tiers) {
  const ids = tierIds(tiers);
  if (ids.length === 0) return 'HARD_FAIL';
  if ((summary[ids[0]] || { fail: 0 }).fail > 0) return 'HARD_FAIL';
  let achieved = 'NONE';
  for (const id of ids) {
    const s = summary[id];
    if (!s || s.fail > 0 || unauditedCount(s) > 0) break;
    achieved = id;
  }
  return achieved;
}

// HARD_FAIL < NONE < every tier (by order).
export function levelRank(level, tiers) {
  if (level === 'HARD_FAIL') return -2;
  const i = tierIds(tiers).indexOf(level);
  return i === -1 ? -1 : i;
}

// ---------- baseline (pure) ----------

// Ratchet: protected = previous ∪ current passes (rules.json order; unknown ids last); level never drops.
export function updateBaseline(prev, rulesDoc, compliance, nowIso) {
  const { rules, tiers } = rulesDoc;
  const ids = new Set([...(prev?.protected || []), ...(compliance.results || []).filter(r => r.status === 'pass').map(r => r.id)]);
  const pos = new Map(rules.map((r, i) => [r.id, i]));
  const at = id => (pos.has(id) ? pos.get(id) : Infinity);
  const protectedIds = [...ids].sort((a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0));
  const cur = compliance.current_tier || 'NONE';
  const level = prev && levelRank(prev.level, tiers) > levelRank(cur, tiers) ? prev.level : cur;
  return { schema: 1, standard_version: rulesDoc.standard?.version, level, updated_at: nowIso, protected: protectedIds };
}

// Regression = protected rule now fail/partial/unaudited (na is fine; ids gone from rules.json ignored),
// or current level below the baseline level.
export function findRegressions(rulesDoc, compliance, baseline) {
  const { rules, tiers } = rulesDoc;
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const resById = new Map((compliance.results || []).map(r => [r.id, r]));
  const out = [];
  for (const id of baseline?.protected || []) {
    if (!ruleById.has(id)) continue;
    const status = resById.get(id)?.status;
    if (status === 'pass' || status === 'na') continue;
    out.push({ id, title: ruleById.get(id).title, status: status || 'not audited' });
  }
  const current = compliance.current_tier || 'NONE';
  const levelDrop = baseline && levelRank(current, tiers) < levelRank(baseline.level, tiers)
    ? { current, baseline: baseline.level } : null;
  return { rules: out, levelDrop };
}

export function regressionLines(reg) {
  const lines = reg.rules.map(r => `- ${r.id} — ${r.title} — now ${r.status}`);
  if (reg.levelDrop) lines.push(`- level ${reg.levelDrop.current} below baseline ${reg.levelDrop.baseline}`);
  return lines;
}

const regressionCount = reg => reg.rules.length + (reg.levelDrop ? 1 : 0);

// ---------- results (pure) ----------

export function stripEffortFieldsOnPass(results) {
  return results.map(r => {
    if (r.status !== 'pass' && r.status !== 'na') return r;
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

export function buildReport(rulesDoc, compliance, baseline) {
  const { tiers, rules } = rulesDoc;
  const std = rulesDoc.standard || {};
  const tierName = new Map(tiers.map(t => [t.id, t.name]));
  const cur = compliance.current_tier;
  const unaudited = totalUnaudited(compliance.tier_summary);
  const level = cur === 'HARD_FAIL' ? 'HARD_FAIL'
    : cur === 'NONE' ? `not reached — ${unaudited} rules not audited`
    : (tierName.get(cur) || cur || 'not audited');
  const out = [];
  out.push(`# ${std.title || 'EQC'} — compliance report`, '');
  out.push(`Standard: ${std.title || '?'} v${std.version || '?'}`);
  out.push(`Audited: ${compliance.audited_at || 'never'}`);
  out.push(`Compliance level: ${level}`);
  if (unaudited > 0 && cur !== 'NONE') out.push(`Unaudited: ${unaudited} rules`);
  out.push('');
  out.push('| Tier | Pass | Partial | Fail | N/A | Total |', '|---|---|---|---|---|---|');
  for (const id of tierIds(tiers)) {
    const s = (compliance.tier_summary || {})[id] || { pass: 0, fail: 0, partial: 0, na: 0, total: 0 };
    out.push(`| ${tierName.get(id)} | ${s.pass} | ${s.partial} | ${s.fail} | ${s.na ?? 0} | ${s.total} |`);
  }
  const ruleById = new Map(rules.map(r => [r.id, r]));
  const resById = new Map((compliance.results || []).map(r => [r.id, r]));
  if (baseline) {
    const reg = findRegressions(rulesDoc, compliance, baseline);
    const k = regressionCount(reg);
    out.push('', `Baseline: ${baseline.level} · ${(baseline.protected || []).length} protected · guard: ${k ? `${k} regressions` : 'ok'}`);
    if (k) out.push('', '## Regressions', '', ...regressionLines(reg));
  }
  const ids = tierIds(tiers);
  const next = ids[Math.max(levelRank(cur, tiers), -1) + 1];
  if (next) {
    const upTo = new Set(ids.slice(0, ids.indexOf(next) + 1));
    const blocking = rules.filter(r => upTo.has(r.tier)).flatMap(r => {
      const st = resById.get(r.id)?.status;
      return st === 'fail' ? [`- **${r.id}** — ${r.title} — fail`] : st ? [] : [`- **${r.id}** — ${r.title} — not audited`];
    });
    out.push('', `## To reach ${tierName.get(next) || next}`, '', ...blocking);
  }
  const notAudited = rules.filter(r => !resById.has(r.id)).map(r => `- **${r.id}** — ${r.title}`);
  if (notAudited.length) out.push('', '## Not audited', '', ...notAudited);
  const bullets = status => (compliance.results || [])
    .filter(r => r.status === status)
    .map(r => `- **${r.id}** — ${ruleById.get(r.id)?.title ?? '(unknown rule)'} — ${truncate(r.evidence || r.notes || '', 160)}`);
  for (const [heading, status] of [['Fails', 'fail'], ['Partials', 'partial'], ['Not applicable', 'na']]) {
    const items = bullets(status);
    if (items.length) out.push('', `## ${heading}`, '', ...items);
  }
  out.push('', '_Generated by eqc-kit — do not edit by hand_', '');
  return out.join('\n');
}

// Single-page, self-contained HTML twin of buildReport (no scripts, no external URLs).
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const HTML_CSS = `
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1f23;--mute:#5f6670;--line:#e2e4e8;--pass:#1f8a4c;--partial:#8f5f00;--fail:#c62828;--na:#666b74;--unaudited:#d5d8dd;--chip-fg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#14161a;--card:#1d2026;--fg:#e8eaed;--mute:#a0a6af;--line:#2d3139;--pass:#3fb877;--partial:#e0a53a;--fail:#ef6b6b;--na:#7b8089;--unaudited:#454a53;--chip-fg:#101215}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:960px;margin:0 auto;padding:32px 16px 48px}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px 24px;margin:0 0 20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{margin:0 0 4px;font-size:1.4rem}h2{margin:0 0 12px;font-size:1.1rem}h3{margin:16px 0 6px;font-size:.95rem;color:var(--mute)}
.level{font-size:2.4rem;font-weight:700;line-height:1.2;margin:8px 0}
.meta{color:var(--mute);display:flex;flex-wrap:wrap;gap:4px 16px}
.row{display:grid;grid-template-columns:110px 1fr 90px;gap:12px;align-items:center;margin:8px 0}
.bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line)}
.bar i{display:block;height:100%}
.chip{background:var(--unaudited)}
.pass{background:var(--pass)}.partial{background:var(--partial)}.fail{background:var(--fail)}.na{background:var(--na)}.unaudited{background:var(--unaudited)}
.chip{display:inline-block;padding:0 8px;border-radius:9px;font-size:.78rem;font-weight:600;color:var(--chip-fg)}
.chip.unaudited{color:var(--fg)}
ul{list-style:none;margin:0;padding:0}li{padding:6px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
li b{font-variant-numeric:tabular-nums}.ev{display:block;color:var(--mute);font-size:.9rem}
details{border-top:1px solid var(--line);padding:8px 0}summary{cursor:pointer;font-weight:600}
footer{color:var(--mute);text-align:center;font-size:.85rem}
@media (max-width:560px){.row{grid-template-columns:1fr}}
@media print{body{background:#fff}section{box-shadow:none}details>*{display:block!important}details::details-content{content-visibility:visible;display:block}}
`;

export function buildHtmlReport(rulesDoc, compliance, baseline) {
  const { tiers, rules } = rulesDoc;
  const std = rulesDoc.standard || {};
  const tierName = new Map(tiers.map(t => [t.id, t.name]));
  const ids = tierIds(tiers);
  const sum = compliance.tier_summary || {};
  const cur = compliance.current_tier;
  const unaudited = totalUnaudited(sum);
  const resById = new Map((compliance.results || []).map(r => [r.id, r]));
  const statusOf = id => resById.get(id)?.status || 'unaudited';
  const chip = st => `<span class="chip ${['pass', 'partial', 'fail', 'na'].includes(st) ? st : 'unaudited'}">${esc(st)}</span>`;
  const li = (r, st, extra = '') => {
    const ev = truncate(resById.get(r.id)?.evidence || resById.get(r.id)?.notes || '', 160);
    return `<li><b>${esc(r.id)}</b> — ${esc(r.title)} ${chip(st)}${extra}${ev ? `<span class="ev">${esc(ev)}</span>` : ''}</li>`;
  };
  const level = cur === 'HARD_FAIL' ? 'HARD_FAIL' : cur === 'NONE' ? 'not reached' : (tierName.get(cur) || cur || 'not audited');
  const reg = baseline && findRegressions(rulesDoc, compliance, baseline);
  const k = baseline ? regressionCount(reg) : 0;

  const tierRows = ids.map(id => {
    const s = sum[id] || { total: 0 };
    const seg = { pass: s.pass || 0, partial: s.partial || 0, fail: s.fail || 0, na: s.na || 0, unaudited: unauditedCount(s) };
    const bar = s.total ? Object.entries(seg).filter(([, n]) => n).map(([c, n]) => `<i class="${c}" style="width:${(n * 100 / s.total).toFixed(1)}%" title="${c} ${esc(n)}"></i>`).join('') : '';
    return `<div class="row"><span>${esc(tierName.get(id))}</span><div class="bar">${bar}</div><span>${esc(seg.pass)}/${esc(s.total)} pass</span></div>`;
  }).join('');

  const next = ids[Math.max(levelRank(cur, tiers), -1) + 1];
  const upTo = new Set(next ? ids.slice(0, ids.indexOf(next) + 1) : []);
  const blockers = rules.filter(r => upTo.has(r.tier) && ['fail', 'unaudited'].includes(statusOf(r.id)));
  const attn = [];
  if (k) {
    const drop = reg.levelDrop ? `<li>Level ${esc(reg.levelDrop.current)} is below baseline ${esc(reg.levelDrop.baseline)}</li>` : '';
    attn.push(`<h3>Regressions</h3><ul>${reg.rules.map(r => `<li><b>${esc(r.id)}</b> — ${esc(r.title)} — now ${chip(r.status)}</li>`).join('')}${drop}</ul>`);
  }
  if (blockers.length) attn.push(`<h3>To reach ${esc(tierName.get(next) || next)}</h3><ul>${blockers.map(r => li(r, statusOf(r.id))).join('')}</ul>`);
  if (!attn.length) attn.push('<p>Nothing blocking</p>');

  const all = ids.map(id => {
    const s = sum[id] || { total: 0 };
    const rs = rules.filter(r => r.tier === id);
    return `<details${(s.fail || s.partial) ? ' open' : ''}><summary>${esc(tierName.get(id))} — ${esc(s.pass || 0)}/${esc(s.total)} pass, ${esc(s.partial || 0)} partial, ${esc(s.fail || 0)} fail</summary><ul>${rs.map(r => li(r, statusOf(r.id))).join('')}</ul></details>`;
  }).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(std.title || 'EQC')} — compliance</title>
<style>${HTML_CSS}</style></head><body><main>
<section><h1>${esc(std.title || 'EQC')} v${esc(std.version || '?')}</h1>
<div class="level">${esc(level)}</div>
<div class="meta"><span>Audited ${esc(compliance.audited_at || 'never')}</span>${unaudited > 0 ? `<span>${esc(unaudited)} unaudited</span>` : ''}${baseline ? `<span>Baseline ${esc(baseline.level)}</span><span>${k ? `${esc(k)} regressions` : 'guard ok'}</span>` : ''}</div></section>
<section><h2>Tier progress</h2>${tierRows}</section>
<section><h2>Needs attention</h2>${attn.join('')}</section>
<section><h2>All rules</h2>${all}</section>
<footer>Generated by eqc-kit — do not edit by hand</footer>
</main></body></html>
`;
}

// Compact Rule list agents read before writing code (.eqc/RULES.md).
export function buildDigest(rulesDoc, compliance) {
  const statusById = new Map((compliance.results || []).map(r => [r.id, r.status]));
  const out = ['# Engineering quality Rules', '',
    'Follow these Rules when writing or changing code. A Rule marked `pass` must stay `pass`.',
    'Rules with a `verify` command are checked by `node .eqc/bin/eqc.mjs verify` (git hooks and CI may run it).'];
  for (const t of rulesDoc.tiers.slice().sort((a, b) => a.order - b.order)) {
    const rules = rulesDoc.rules.filter(r => r.tier === t.id);
    if (!rules.length) continue;
    out.push('', `## ${t.name}`, '');
    for (const r of rules)
      out.push(`- **${r.id}** [${statusById.get(r.id) ?? 'unaudited'}] ${r.title} — ${r.detail || ''}${r.verify ? ` (verify: \`${r.verify}\`)` : ''}`.trimEnd());
  }
  out.push('', '_Generated by eqc-kit — do not edit by hand_', '');
  return out.join('\n');
}

// Rules to run in `verify`: passing Rules that carry a verify command (a known fail never blocks).
export function verifyTargets(rules, results, ids) {
  const pass = new Set(results.filter(r => r.status === 'pass').map(r => r.id));
  return rules.filter(r => r.verify && pass.has(r.id) && (!ids || ids.includes(r.id)));
}

// ---------- re-index (pure) ----------

const ruleKey = r => JSON.stringify({ title: r.title ?? null, detail: r.detail ?? null, tier: r.tier ?? null, applies_to: r.applies_to ?? [], verify: r.verify ?? null });

// Rule delta between two indexes. Order of matching: same id+content, same content (moved), same id (changed).
export function diffRules(oldRules, newRules) {
  const out = { unchanged: [], moved: [], changed: [], added: [], removed: [], audit: [] };
  const oldLeft = new Set(oldRules.map((_, i) => i));
  const kind = new Map(); // new index -> 'unchanged' | {from} | 'changed'
  const oldKeys = oldRules.map(ruleKey);
  const newKeys = newRules.map(ruleKey);
  newRules.forEach((n, j) => {
    const i = oldRules.findIndex((o, i) => oldLeft.has(i) && o.id === n.id && oldKeys[i] === newKeys[j]);
    if (i !== -1) { oldLeft.delete(i); kind.set(j, 'unchanged'); }
  });
  newRules.forEach((n, j) => {
    if (kind.has(j)) return;
    const i = oldRules.findIndex((_, i) => oldLeft.has(i) && oldKeys[i] === newKeys[j]);
    if (i !== -1) { oldLeft.delete(i); kind.set(j, { from: oldRules[i].id }); }
  });
  newRules.forEach((n, j) => {
    if (kind.has(j)) return;
    const i = oldRules.findIndex((o, i) => oldLeft.has(i) && o.id === n.id);
    if (i !== -1) { oldLeft.delete(i); kind.set(j, 'changed'); }
  });
  newRules.forEach((n, j) => {
    const k = kind.get(j);
    if (k === 'unchanged') out.unchanged.push(n.id);
    else if (k === 'changed') { out.changed.push(n.id); out.audit.push(n.id); }
    else if (k) out.moved.push({ from: k.from, to: n.id });
    else { out.added.push(n.id); out.audit.push(n.id); }
  });
  out.removed = oldRules.filter((_, i) => oldLeft.has(i)).map(r => r.id);
  return out;
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

const htmlPath = p => /\.md$/i.test(p) ? p.replace(/\.md$/i, '.html') : `${p}.html`;

function writeReport(rulesDoc, compliance, baseline) {
  fs.writeFileSync(file('RULES.md'), buildDigest(rulesDoc, compliance));
  const p = reportPath();
  if (!p) return null;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, buildReport(rulesDoc, compliance, baseline));
  fs.writeFileSync(htmlPath(p), buildHtmlReport(rulesDoc, compliance, baseline));
  return p;
}

// ---------- commands ----------

function cmdReport(args) {
  const { rulesDoc, compliance } = requireData();
  const baseline = readJson(file('baseline.json'));
  if (args.includes('--write')) {
    const p = writeReport(rulesDoc, compliance, baseline);
    if (!p) fail('report --write: no report_path in config.json');
    console.log(`report: ${p}`);
    console.log(`html: ${htmlPath(p)}`);
    return;
  }
  process.stdout.write(buildReport(rulesDoc, compliance, baseline));
}

function cmdGuard(args = []) {
  const { rulesDoc, compliance } = requireData();
  const i = args.indexOf('--min'), min = i === -1 ? null : args[i + 1] ?? fail('guard: --min needs a tier');
  const ids = tierIds(rulesDoc.tiers), cur = compliance.current_tier || 'NONE';
  if (min && !ids.includes(min)) fail(`guard: unknown tier "${min}" (tiers: ${ids.join(', ')})`);
  if (min && levelRank(cur, rulesDoc.tiers) < levelRank(min, rulesDoc.tiers)) fail(`guard: level ${cur} is below --min ${min}`);
  const baseline = readJson(file('baseline.json'));
  if (!baseline) return console.log('guard: no baseline yet');
  const reg = findRegressions(rulesDoc, compliance, baseline);
  if (!regressionCount(reg)) return console.log(`guard: ok · baseline ${baseline.level} · ${(baseline.protected || []).length} protected rules`);
  fail(['guard: REGRESSION', ...regressionLines(reg)].join('\n'));
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

function cmdReset() {
  for (const f of ['rules.json', 'compliance.json', 'doc-meta.md', 'baseline.json']) fs.rmSync(file(f), { force: true });
  console.log('reset: removed rules.json, compliance.json, doc-meta.md, baseline.json (kept milestones, plans, config, standard)');
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
  const un = totalUnaudited(tier_summary);
  console.log(`merged ${entries.length} results · level: ${current_tier}${un > 0 ? ` · ${un} rules not audited` : ''}`);
  const baseline = updateBaseline(readJson(file('baseline.json')), rulesDoc, updated, new Date().toISOString());
  writeJson(file('baseline.json'), baseline);
  console.log(`baseline: ${baseline.level} · ${baseline.protected.length} protected`);
  const k = regressionCount(findRegressions(rulesDoc, updated, baseline));
  if (k) console.log(`guard: ${k} regressions — run eqc guard`);
  const p = writeReport(rulesDoc, updated, baseline);
  if (p) {
    console.log(`report: ${p}`);
    console.log(`html: ${htmlPath(p)}`);
  }
}

function validateIndex(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.tiers) || !d.tiers.length || !Array.isArray(d.rules) || !d.rules.length) return 'needs non-empty tiers[] and rules[]';
  const tierSet = new Set(d.tiers.map(t => t?.id));
  const seen = new Set();
  for (const r of d.rules) {
    if (!r || ['id', 'tier', 'title'].some(k => typeof r[k] !== 'string' || !r[k])) return 'every rule needs string id, tier, title';
    if (!tierSet.has(r.tier)) return `rule ${r.id}: unknown tier ${r.tier}`;
    if (seen.has(r.id)) return `duplicate rule id ${r.id}`;
    seen.add(r.id);
  }
  return null;
}

function cmdReindex(filePath) {
  const bad = msg => { console.error(`reindex: ${msg}`); process.exit(1); };
  let next;
  try { next = JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (e) { bad(`cannot read ${filePath}: ${e.message}`); }
  const problem = validateIndex(next);
  if (problem) bad(problem);

  const oldDoc = readJson(file('rules.json'));
  const delta = diffRules(oldDoc?.rules || [], next.rules);
  const rename = new Map(delta.moved.map(m => [m.from, m.to]));
  const drop = new Set([...delta.changed, ...delta.removed]);
  const carry = id => (drop.has(id) ? null : rename.get(id) ?? id);

  const prevCompliance = readJson(file('compliance.json'));
  const prevBaseline = readJson(file('baseline.json'));
  let compliance = null;
  if (prevCompliance || prevBaseline) {
    const results = (prevCompliance?.results || []).flatMap(r => { const id = carry(r.id); return id ? [{ ...r, id }] : []; });
    const tier_summary = buildTierSummary(next.rules, results, next.tiers);
    compliance = { ...(prevCompliance || { schema: 1, audited_at: todayLocal() }), standard_version: next.standard?.version, results, tier_summary, current_tier: computeCurrentTier(tier_summary, next.tiers) };
  }
  let baseline = null;
  if (prevBaseline) {
    const pos = new Map(next.rules.map((r, i) => [r.id, i]));
    const ids = [...new Set(prevBaseline.protected.map(carry).filter(id => id && pos.has(id)))].sort((a, b) => pos.get(a) - pos.get(b));
    baseline = { schema: 1, standard_version: next.standard?.version, level: compliance.current_tier, updated_at: new Date().toISOString(), protected: ids };
  }
  writeJson(file('rules.json'), next);
  if (prevCompliance) writeJson(file('compliance.json'), compliance);
  if (baseline) writeJson(file('baseline.json'), baseline);
  fs.rmSync(filePath, { force: true });
  if (prevCompliance) writeReport(next, compliance, baseline);
  console.log(JSON.stringify(delta));
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

function cmdVerify(idsArg) {
  const { rules, compliance } = requireData();
  const ids = idsArg ? idsArg.split(',').map(s => s.trim()).filter(Boolean) : null;
  const targets = verifyTargets(rules, compliance.results || [], ids);
  if (!targets.length) return console.log('verify: no passing rules with a verify command');
  let bad = 0;
  for (const r of targets) {
    const res = spawnSync(r.verify, { shell: true, cwd: path.dirname(stateDir()), encoding: 'utf8' });
    if (res.status === 0) { console.log(`ok   ${r.id} — ${r.title}`); continue; }
    bad++;
    const tail = `${res.stdout || ''}${res.stderr || ''}`.trim().split('\n').slice(-10).join('\n');
    console.log(`FAIL ${r.id} — ${r.title}\n  $ ${r.verify}${tail ? `\n${tail.replace(/^/gm, '  ')}` : ''}`);
  }
  console.log(bad ? `verify: ${bad} of ${targets.length} failed — fix the code, or re-audit if the Rule no longer passes` : `verify: ${targets.length} ok`);
  if (bad) process.exit(1);
}

// ---------- state schema + migrations ----------

export const STATE_SCHEMA = 2;
export function stateSchema(cfg) { return cfg?.state_schema ?? 1; }

// MIGRATIONS[i] migrates schema i+1 -> i+2.
export const MIGRATIONS = [
  () => { // 1 -> 2: backfill baseline.json from existing compliance
    const rulesDoc = readJson(file('rules.json')), compliance = readJson(file('compliance.json'));
    if (rulesDoc && compliance && !fs.existsSync(file('baseline.json'))) {
      writeJson(file('baseline.json'), updateBaseline(null, rulesDoc, compliance, new Date().toISOString()));
    }
  },
];

const jsonFiles = dir => fs.readdirSync(dir).filter(f => f.endsWith('.json') && fs.statSync(path.join(dir, f)).isFile());

function cmdMigrate() {
  const cfg = readJson(file('config.json'));
  if (!cfg) fail('no .eqc/config.json; run `npx eqc-kit init`');
  const from = stateSchema(cfg);
  if (!Number.isInteger(from) || from < 1) fail(`invalid state_schema ${JSON.stringify(from)} in .eqc/config.json`);
  if (from > STATE_SCHEMA) fail(`state schema ${from} is newer than this engine (${STATE_SCHEMA}); upgrade eqc-kit`);
  if (from === STATE_SCHEMA) return console.log(`state schema ${from}, up to date`);
  const dir = stateDir(), backup = path.join(dir, 'tmp', `backup-schema-${from}`);
  fs.rmSync(backup, { recursive: true, force: true });
  fs.mkdirSync(backup, { recursive: true });
  const saved = jsonFiles(dir);
  for (const f of saved) fs.copyFileSync(path.join(dir, f), path.join(backup, f));
  try {
    for (const m of MIGRATIONS.slice(from - 1, STATE_SCHEMA - 1)) m();
    writeJson(file('config.json'), { ...readJson(file('config.json')), state_schema: STATE_SCHEMA });
  } catch (e) {
    for (const f of jsonFiles(dir)) if (!saved.includes(f)) fs.rmSync(path.join(dir, f));
    for (const f of saved) fs.copyFileSync(path.join(backup, f), path.join(dir, f));
    fail(`migration ${from}→${STATE_SCHEMA} failed, state restored: ${e.message}`);
  }
  console.log(`migrated state schema ${from} → ${STATE_SCHEMA} (backup: ${backup})`);
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
  assert.deepStrictEqual(s.A, { pass: 1, fail: 1, partial: 0, na: 0, total: 2 });
  assert.deepStrictEqual(s.C, { pass: 0, fail: 0, partial: 0, na: 0, total: 0 });

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

  const rd = { rules, tiers: t3 };
  const b = updateBaseline({ level: 'B', protected: ['B-1'] }, rd, { results: [{ id: 'A-1', status: 'pass' }], current_tier: 'HARD_FAIL' }, 'now');
  assert.deepStrictEqual([b.level, b.protected], ['B', ['A-1', 'B-1']]);
  const reg = findRegressions(rd, { results: [{ id: 'A-1', status: 'na' }], current_tier: 'A' }, b);
  assert.deepStrictEqual(reg, { rules: [{ id: 'B-1', title: undefined, status: 'not audited' }], levelDrop: { current: 'A', baseline: 'B' } });

  const doc2 = { tiers, rules: [{ id: 'LOW-1', tier: 'LOW', verify: 'true' }, { id: 'HIGH-1', tier: 'HIGH', verify: 'true' }] };
  assert.deepStrictEqual(verifyTargets(doc2.rules, [{ id: 'LOW-1', status: 'pass' }, { id: 'HIGH-1', status: 'fail' }]).map(r => r.id), ['LOW-1']);
  const h = buildHtmlReport({ standard: { title: 'T<' }, tiers: t3, rules }, { results: [], tier_summary: s, current_tier: 'NONE' }, null);
  assert.ok(h.startsWith('<!doctype html>') && !h.includes('<script') && h.includes('T&lt;'));
  console.log('selftest ok');
}

// ---------- CLI dispatch ----------

const USAGE = 'usage: eqc.mjs <selftest|reset|report [--write]|rank [keyword]|ids <...>|get <ID...>|merge <file>|reindex <file>|guard [--min TIER]|chunks <ID>|check-ids <doc>|milestone add <json>|config get <key>|verify [ID,...]|migrate>';

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  if (['reset', 'report', 'rank', 'ids', 'get', 'merge', 'reindex', 'guard', 'chunks', 'milestone', 'config', 'verify'].includes(cmd)) {
    const cfg = readJson(file('config.json'));
    if (cfg) {
      const v = stateSchema(cfg);
      if (v < STATE_SCHEMA) fail(`state schema ${v} is older than this engine (${STATE_SCHEMA}); run \`npx eqc-kit update\``);
      if (v > STATE_SCHEMA) fail(`state schema ${v} is newer than this engine (${STATE_SCHEMA}); upgrade eqc-kit`);
    }
  }
  switch (cmd) {
    case 'selftest': return selftest();
    case 'reset': return cmdReset();
    case 'report': return cmdReport(args);
    case 'rank': return cmdRank(args[0]);
    case 'ids': return cmdIds(args[0]);
    case 'get': return cmdGet(args);
    case 'merge': return args[0] ? cmdMerge(args[0]) : fail('usage: eqc.mjs merge <file>');
    case 'reindex': return args[0] ? cmdReindex(args[0]) : fail('usage: eqc.mjs reindex <file>');
    case 'guard': return cmdGuard(args);
    case 'chunks': return cmdChunks(args[0]);
    case 'check-ids': return cmdCheckIds(args[0]);
    case 'milestone': return cmdMilestone(args[0], args[1]);
    case 'config': return cmdConfig(args[0], args[1]);
    case 'verify': return cmdVerify(args[0]);
    case 'migrate': return cmdMigrate();
    default: return fail(USAGE);
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
if (isDirect) main();

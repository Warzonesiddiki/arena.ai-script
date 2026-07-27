/**
 * Regression test for userscript-side V8 extension feedback lab.
 * Verifies extension parity features are available in the legacy script for fast feedback.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const vm = require('vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'arena-agent-mode-pro.user.js');

async function main() {
  const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const dom = new JSDOM('<!doctype html><html><head><title>Agent</title></head><body><main data-mode="agent"></main></body></html>', {
    url: 'https://arena.ai/agent', pretendToBeVisual: true, runScripts: 'outside-only'
  });
  const { window } = dom;
  window.BroadcastChannel = class { postMessage() {} close() {} set onmessage(fn) {} };
  const gmStore = new Map();
  window.GM_getValue = (k, d) => gmStore.has(k) ? gmStore.get(k) : d;
  window.GM_setValue = (k, v) => gmStore.set(k, v);
  window.GM_deleteValue = (k) => gmStore.delete(k);
  window.GM_addStyle = (css) => { const s = window.document.createElement('style'); s.textContent = css; window.document.head.appendChild(s); return s; };
  window.GM_setClipboard = () => {};
  window.indexedDB = { open() { const req = { result:null, onupgradeneeded:null, onsuccess:null, onerror:null }; setTimeout(() => req.onerror && req.onerror({ target:req }), 0); return req; } };
  const errors = [];
  window.addEventListener('error', (e) => errors.push(e.error ? e.error.stack || e.error.message : e.message));
  const context = dom.getInternalVMContext ? dom.getInternalVMContext() : window;
  vm.runInContext(src, context, { filename: SCRIPT_PATH });
  await new Promise(r => setTimeout(r, 1400));

  const btn = window.document.getElementById('aamp-v8-feedback-btn');
  if (btn) btn.click();
  await new Promise(r => setTimeout(r, 100));
  const panel = window.document.getElementById('aamp-v8-feedback');
  const goal = panel?.querySelector('[data-aamp-v8-goal]');
  if (goal) goal.value = 'Validate userscript parity';
  panel?.querySelector('[data-aamp-v8-create]')?.click();
  await new Promise(r => setTimeout(r, 100));
  panel?.querySelector('[data-aamp-v8-approve="planner-1"]')?.click();
  await new Promise(r => setTimeout(r, 100));
  const memTitle = panel?.querySelector('[data-aamp-v8-mem-title]');
  const memSummary = panel?.querySelector('[data-aamp-v8-mem-summary]');
  if (memTitle) memTitle.value = 'Feedback memory';
  if (memSummary) memSummary.value = 'Userscript parity lab stores bounded approved summaries.';
  panel?.querySelector('[data-aamp-v8-memory]')?.click();
  await new Promise(r => setTimeout(r, 100));

  const stored = gmStore.get('aamp_v8_feedback_lab');
  const parsed = stored ? JSON.parse(stored) : null;
  const pass = !!btn
    && !!panel
    && !panel.classList.contains('aamp-hidden')
    && parsed?.plan?.tasks?.length === 3
    && parsed.plan.tasks.find(t => t.id === 'planner-1')?.approved === true
    && parsed.memory?.[0]?.title === 'Feedback memory'
    && panel.textContent.includes('Health + Analytics')
    && errors.length === 0;

  console.log('=== V8 Feedback Lab Regression Test ===');
  console.log(`Button found: ${!!btn}`);
  console.log(`Panel open: ${!!panel && !panel.classList.contains('aamp-hidden')}`);
  console.log(`Plan tasks: ${parsed?.plan?.tasks?.length || 0}`);
  console.log(`Planner approved: ${parsed?.plan?.tasks?.find(t => t.id === 'planner-1')?.approved === true}`);
  console.log(`Memory saved: ${parsed?.memory?.[0]?.title || 'none'}`);
  console.log(`Runtime errors: ${errors.length}`);
  errors.forEach((e, i) => console.log(`  [${i + 1}]`, e));
  try { window.close(); } catch {}
  console.log(pass ? '\nRESULT: PASS' : '\nRESULT: FAIL — V8 feedback lab regression');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('Regression test crashed:', e); process.exit(1); });

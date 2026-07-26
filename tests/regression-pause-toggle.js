/**
 * Regression test for the Settings Panel "Pause / Resume" toggle.
 *
 * Previously this button set a `Config` key called `enabled` that nothing
 * else in the entire script ever read — clicking "Pause" showed a toast but
 * had zero actual effect on tracking. This test verifies that toggling
 * pause via the real UI button actually stops DOMObserver from reacting to
 * new tool-call nodes, and that resuming restores normal tracking.
 *
 * Usage: node tests/regression-pause-toggle.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const vm = require('vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'arena-agent-mode-pro.user.js');

async function main() {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://arena.ai/agent',
        pretendToBeVisual: true,
        runScripts: 'outside-only',
    });
    const { window } = dom;

    window.BroadcastChannel = class { postMessage() {} close() {} set onmessage(fn) {} };
    const gmStore = new Map();
    window.GM_getValue = (k, d) => (gmStore.has(k) ? gmStore.get(k) : d);
    window.GM_setValue = (k, v) => gmStore.set(k, v);
    window.GM_deleteValue = (k) => gmStore.delete(k);
    window.GM_addStyle = (css) => { const s = window.document.createElement('style'); s.textContent = css; window.document.head.appendChild(s); return s; };
    window.GM_setClipboard = () => {};
    window.indexedDB = {
        open() {
            const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
            setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0);
            return req;
        },
    };

    const errors = [];
    window.addEventListener('error', (e) => errors.push(e.error ? e.error.stack || e.error.message : e.message));

    const context = dom.getInternalVMContext ? dom.getInternalVMContext() : window;
    vm.runInContext(src, context, { filename: SCRIPT_PATH });

    await new Promise((r) => setTimeout(r, 1000));

    const body = window.document.body;
    function addToolCall(text) {
        const div = window.document.createElement('div');
        div.className = 'tool-call bash';
        div.textContent = text;
        body.appendChild(div);
    }

    // Sanity: tracking works while enabled (default).
    addToolCall('$ echo before-pause');
    await new Promise((r) => setTimeout(r, 300));
    const wrappedBefore = window.document.querySelectorAll('.aamp-collapsible-wrap').length;

    // Open settings and click Pause.
    const fab = window.document.getElementById('aamp-fab');
    fab.click();
    await new Promise((r) => setTimeout(r, 100));
    const pauseBtn = window.document.getElementById('aamp-toggle-enabled');
    const labelBeforeClick = pauseBtn ? pauseBtn.textContent : null;
    if (pauseBtn) pauseBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    const labelAfterClick = pauseBtn ? pauseBtn.textContent : null;

    // While paused, new tool calls should NOT be wrapped/tracked.
    addToolCall('$ echo during-pause');
    await new Promise((r) => setTimeout(r, 300));
    const wrappedDuringPause = window.document.querySelectorAll('.aamp-collapsible-wrap').length;

    // Resume and confirm tracking comes back.
    if (pauseBtn) pauseBtn.click();
    await new Promise((r) => setTimeout(r, 100));
    addToolCall('$ echo after-resume');
    await new Promise((r) => setTimeout(r, 300));
    const wrappedAfterResume = window.document.querySelectorAll('.aamp-collapsible-wrap').length;

    console.log('=== Pause/Resume Toggle Regression Test ===');
    console.log(`Pause button found: ${!!pauseBtn}`);
    console.log(`Label before click: "${labelBeforeClick}" (expected: "⏸ Pause")`);
    console.log(`Label after click: "${labelAfterClick}" (expected: "▶ Resume")`);
    console.log(`Wrapped tool calls before pause: ${wrappedBefore} (expected: 1)`);
    console.log(`Wrapped tool calls during pause: ${wrappedDuringPause} (expected: still 1 — no new tracking)`);
    console.log(`Wrapped tool calls after resume: ${wrappedAfterResume} (expected: 2 — tracking resumed)`);
    console.log(`Runtime errors: ${errors.length}`);
    errors.forEach((e, i) => console.log(`  [${i + 1}]`, e));

    try { window.close(); } catch (e) { /* ignore */ }

    const pass = !!pauseBtn
        && labelBeforeClick === '⏸ Pause'
        && labelAfterClick === '▶ Resume'
        && wrappedBefore === 1
        && wrappedDuringPause === 1
        && wrappedAfterResume === 2
        && errors.length === 0;

    console.log(pass ? '\nRESULT: PASS' : '\nRESULT: FAIL — pause toggle regression');
    process.exit(pass ? 0 : 1);
}

main().catch((e) => {
    console.error('Regression test crashed:', e);
    process.exit(1);
});

/**
 * Regression test for a critical infinite-DOM-mutation-loop bug:
 * wrapToolCall() used to reparent a detected tool-call node into a new
 * wrapper <div>. That reparenting was itself picked up by the MutationObserver
 * as "new content", and because the wrapper still contained the original
 * (already-wrapped) node, DOMObserver's querySelector('[class*="tool-call"]')
 * matched it again, re-emitting 'agent:toolCall' and re-wrapping forever —
 * freezing the browser tab on any real Arena.ai agent session.
 *
 * This test appends a tool-call node and asserts that MutationObserver
 * callbacks settle down (stay small/bounded) instead of growing unbounded,
 * and that the run completes without hanging.
 *
 * Usage: node tests/regression-toolcall-loop.js
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

    let mutationCallbackCount = 0;
    const RealMO = window.MutationObserver;
    window.MutationObserver = class extends RealMO {
        constructor(cb) {
            super((records, obs) => {
                mutationCallbackCount++;
                if (mutationCallbackCount > 500) return; // safety valve so the test itself can't hang
                cb(records, obs);
            });
        }
    };

    const context = dom.getInternalVMContext ? dom.getInternalVMContext() : window;
    vm.runInContext(src, context, { filename: SCRIPT_PATH });

    await new Promise((r) => setTimeout(r, 1000));

    const toolCall = window.document.createElement('div');
    toolCall.className = 'tool-call bash';
    toolCall.textContent = '$ npm install';
    window.document.body.appendChild(toolCall);

    // Race the settle-wait against a hard timeout so CI fails fast (instead of
    // hanging indefinitely) if this regression is ever reintroduced.
    const settled = await Promise.race([
        new Promise((r) => setTimeout(() => r(true), 2000)),
        new Promise((r) => setTimeout(() => r(false), 8000)),
    ]);

    const wrapped = !!window.document.querySelector('.aamp-collapsible-wrap');

    console.log('=== Tool-Call Wrap Infinite-Loop Regression Test ===');
    console.log(`MutationObserver callback count: ${mutationCallbackCount} (expected: small, well under 500)`);
    console.log(`Tool call was wrapped: ${wrapped} (expected: true)`);
    console.log(`Test settled without hanging: ${settled}`);

    try { window.close(); } catch (e) { /* ignore */ }

    const pass = settled && wrapped && mutationCallbackCount < 500;
    console.log(pass ? '\nRESULT: PASS' : '\nRESULT: FAIL — possible infinite mutation loop regression');
    process.exit(pass ? 0 : 1);
}

main().catch((e) => {
    console.error('Regression test crashed:', e);
    process.exit(1);
});

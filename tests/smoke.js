/**
 * Smoke test harness for arena-agent-mode-pro.user.js
 * Loads the userscript inside a jsdom document, stubs GM_* / Tampermonkey APIs,
 * runs the boot sequence, and reports any runtime errors, warnings, and basic
 * module-registry health so regressions are caught automatically (no browser needed).
 *
 * Usage: node tests/smoke.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SCRIPT_PATH = path.join(__dirname, '..', 'arena-agent-mode-pro.user.js');

async function main() {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');

    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'https://arena.ai/agent',
        pretendToBeVisual: true,
        runScripts: 'outside-only',
    });
    const { window } = dom;

    // Minimal BroadcastChannel stub (jsdom doesn't implement it)
    window.BroadcastChannel = class {
        constructor() {}
        postMessage() {}
        close() {}
        set onmessage(fn) {}
    };

    // GM_* API stubs backed by an in-memory map
    const gmStore = new Map();
    window.GM_getValue = (key, def) => (gmStore.has(key) ? gmStore.get(key) : def);
    window.GM_setValue = (key, val) => { gmStore.set(key, val); };
    window.GM_deleteValue = (key) => { gmStore.delete(key); };
    window.GM_addStyle = (css) => { const s = window.document.createElement('style'); s.textContent = css; window.document.head.appendChild(s); return s; };
    window.GM_setClipboard = () => {};

    // IndexedDB is not implemented in jsdom; stub just enough that init() doesn't throw.
    window.indexedDB = {
        open() {
            const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
            setTimeout(() => {
                try {
                    if (typeof req.onerror === 'function') req.onerror({ target: req });
                } catch (e) { /* ignore */ }
            }, 0);
            return req;
        },
    };

    const errors = [];
    const warnings = [];
    window.addEventListener('error', (e) => errors.push(e.error ? e.error.stack || e.error.message : e.message));

    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    window.console.error = (...args) => { errors.push(args.map(String).join(' ')); };
    window.console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };

    // Execute the userscript source in the jsdom window context.
    const vm = require('vm');
    const context = dom.getInternalVMContext ? dom.getInternalVMContext() : window;
    try {
        vm.runInContext(src, context, { filename: SCRIPT_PATH });
    } catch (e) {
        errors.push(`FATAL during script evaluation: ${e.stack || e.message}`);
    }

    // The script's init() runs on DOMContentLoaded or via setTimeout(init, 600).
    // Advance fake timers by waiting long enough for setTimeout(init, 600) + module boot.
    await new Promise((resolve) => setTimeout(resolve, 1200));

    console.log = originalConsoleError; // restore in case
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;

    console.log('=== AAMP Smoke Test Report ===');
    console.log(`Runtime errors captured: ${errors.length}`);
    errors.forEach((e, i) => console.log(`  [ERR ${i + 1}] ${e}`));
    console.log(`Console warnings captured: ${warnings.length}`);
    if (process.argv.includes('--verbose')) {
        warnings.forEach((w, i) => console.log(`  [WARN ${i + 1}] ${w}`));
    }

    // Basic health check via ModuleRegistry if reachable (script uses an IIFE so
    // internals aren't exposed on window; we just rely on error/warning capture).
    const hadFatal = errors.some((e) => e.includes('FATAL'));
    if (hadFatal || errors.length > 0) {
        console.log('\nRESULT: FAIL — runtime errors detected');
        process.exitCode = 1;
    } else {
        console.log('\nRESULT: PASS — no runtime errors detected during boot');
        process.exitCode = 0;
    }
    // The script sets up setInterval() timers (session polling, MutationObservers)
    // that keep the jsdom window (and therefore the node process) alive forever.
    // Force-close the window and exit explicitly once we've captured our report.
    try { window.close(); } catch (e) { /* ignore */ }
    process.exit(process.exitCode || 0);
}

main().catch((e) => {
    console.error('Smoke test crashed:', e);
    process.exit(1);
});

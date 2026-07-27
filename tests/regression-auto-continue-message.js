/**
 * Regression test for legacy userscript AutoContinue chat-message fallback.
 *
 * Arena sometimes exposes no visible "Continue" button after an agent turn. The
 * legacy userscript used to only click buttons, so it never sent the configured
 * continue prompt into chat. This verifies that an idle Agent Mode session sends
 * the configured continue message through the chat input/send button.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const vm = require('vm');

const SCRIPT_PATH = path.join(__dirname, '..', 'arena-agent-mode-pro.user.js');

async function main() {
    const src = fs.readFileSync(SCRIPT_PATH, 'utf8');
    const dom = new JSDOM(`<!doctype html><html><head><title>Agent</title></head><body>
      <main data-mode="agent">
        <form id="chat-form">
          <textarea id="chat-input"></textarea>
          <button id="send" type="submit" aria-label="Send message">Send</button>
        </form>
      </main>
    </body></html>`, {
        url: 'https://arena.ai/agent',
        pretendToBeVisual: true,
        runScripts: 'outside-only',
    });
    const { window } = dom;

    window.BroadcastChannel = class { postMessage() {} close() {} set onmessage(fn) {} };
    const gmStore = new Map();
    gmStore.set('aamp_config', JSON.stringify({
        autoContinue: true,
        autoContinueSendMessage: true,
        autoContinueDelay: 500,
        autoContinueIdleMessageDelay: 1000,
        autoContinueMessageCooldown: 1000,
        autoContinueMessage: 'CONTINUE',
        version: '7.2.0',
    }));
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

    let sentText = null;
    window.document.getElementById('chat-form').addEventListener('submit', (event) => {
        event.preventDefault();
        sentText = window.document.getElementById('chat-input').value;
    });
    window.document.getElementById('send').addEventListener('click', () => {
        sentText = window.document.getElementById('chat-input').value;
    });

    const context = dom.getInternalVMContext ? dom.getInternalVMContext() : window;
    vm.runInContext(src, context, { filename: SCRIPT_PATH });

    // Boot waits ~600ms. TickDispatcher checks every second and AutoContinue's
    // registered tick has a 5s interval, so 7s is enough for idle detection.
    await new Promise((resolve) => setTimeout(resolve, 7200));

    console.log('=== AutoContinue Message Regression Test ===');
    console.log(`Sent text: ${JSON.stringify(sentText)} (expected: "CONTINUE")`);
    console.log(`Runtime errors: ${errors.length}`);
    errors.forEach((e, i) => console.log(`  [${i + 1}]`, e));

    try { window.close(); } catch {}

    const pass = sentText === 'CONTINUE' && errors.length === 0;
    console.log(pass ? '\nRESULT: PASS' : '\nRESULT: FAIL — AutoContinue did not send chat message');
    process.exit(pass ? 0 : 1);
}

main().catch((error) => {
    console.error('Regression test crashed:', error);
    process.exit(1);
});

/**
 * Regression test for the completed-session choices: Yes / No / Keep working.
 *
 * Requirement: always choose "Keep working" and then send a chat message
 * "continue" so work can proceed without manual nudging.
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
        <div id="completion-options">
          <button id="yes">Yes</button>
          <button id="no">No</button>
          <button id="keep-working">Keep working</button>
        </div>
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
        autoContinueIdleMessageDelay: 300000,
        autoContinueMessageCooldown: 300000,
        autoContinueMessage: 'CUSTOM-SHOULD-NOT-BE-USED-FOR-KEEP-WORKING',
        version: '7.2.0',
    }));
    window.GM_getValue = (k, d) => (gmStore.has(k) ? gmStore.get(k) : d);
    window.GM_setValue = (k, v) => gmStore.set(k, v);
    window.GM_deleteValue = (k) => gmStore.delete(k);
    window.GM_addStyle = (css) => { const s = window.document.createElement('style'); s.textContent = css; window.document.head.appendChild(s); return s; };
    window.GM_setClipboard = () => {};
    window.indexedDB = { open() { const req = { result: null, onupgradeneeded: null, onsuccess: null, onerror: null }; setTimeout(() => { if (req.onerror) req.onerror({ target: req }); }, 0); return req; } };

    const errors = [];
    window.addEventListener('error', (e) => errors.push(e.error ? e.error.stack || e.error.message : e.message));

    const clicked = [];
    for (const id of ['yes', 'no', 'keep-working']) {
        window.document.getElementById(id).addEventListener('click', () => clicked.push(id));
    }

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

    // Mutation observer should see the existing buttons during boot, then click
    // Keep working after the configured 500ms delay and send "continue" shortly after.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    console.log('=== AutoContinue Keep Working Regression Test ===');
    console.log(`Clicked: ${JSON.stringify(clicked)} (expected only ["keep-working"])`);
    console.log(`Sent text: ${JSON.stringify(sentText)} (expected: "continue")`);
    console.log(`Runtime errors: ${errors.length}`);
    errors.forEach((e, i) => console.log(`  [${i + 1}]`, e));

    try { window.close(); } catch {}

    const pass = clicked.length === 1 && clicked[0] === 'keep-working' && sentText === 'continue' && errors.length === 0;
    console.log(pass ? '\nRESULT: PASS' : '\nRESULT: FAIL — keep-working auto-continue regression');
    process.exit(pass ? 0 : 1);
}

main().catch((error) => {
    console.error('Regression test crashed:', error);
    process.exit(1);
});

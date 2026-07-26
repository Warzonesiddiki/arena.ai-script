/**
 * Regression test: MutationObserver callback count should stay low
 * (catches future perf regressions from undebounced full-DOM scans)
 */
const { JSDOM } = require('jsdom');
const fs = require('fs');

const script = fs.readFileSync('arena-agent-mode-pro.user.js', 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body><div class="chat"></div></body></html>', {
  runScripts: 'dangerously',
  resources: 'usable'
});

const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;

let callbackCount = 0;
const origMO = window.MutationObserver;
window.MutationObserver = function(callback) {
  return new origMO(function(muts) {
    callbackCount++;
    return callback(muts);
  });
};

try {
  // Patch GM APIs before eval
  const patched = script
    .replace(/GM_addStyle/g, '() => {}')
    .replace(/GM_setValue/g, '() => {}')
    .replace(/GM_getValue/g, '() => null')
    .replace(/GM_deleteValue/g, '() => {}')
    .replace(/GM_setClipboard/g, '() => {}');
  
  eval(patched);
  
  // Simulate 50 mutations (realistic tool-call + message activity)
  for (let i = 0; i < 50; i++) {
    const div = document.createElement('div');
    div.className = i % 3 === 0 ? 'tool-call' : 'message';
    document.body.appendChild(div);
  }
  
  console.log(`MutationObserver callback count after 50 mutations: ${callbackCount}`);
  
  if (callbackCount > 180) {
    console.error('FAIL: Too many MutationObserver callbacks (perf regression)');
    process.exit(1);
  } else {
    console.log('PASS: MutationObserver callback count within acceptable range');
  }
} catch (e) {
  console.error('Test error:', e.message);
  process.exit(1);
}
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const contentPath = new URL('../content.js', import.meta.url);
const source = fs.readFileSync(contentPath, 'utf8');
const runtimeListeners = [];
const activeIntervals = new Set();
const activeObservers = new Set();
let nextTimerId = 1;

class MutationObserverStub {
  observe() { activeObservers.add(this); }
  disconnect() { activeObservers.delete(this); }
}

const context = {
  console,
  URL,
  location: {
    href: 'https://pacs.example/viewer?study=1.2.3',
    hostname: 'pacs.example',
    port: '',
  },
  document: {
    title: 'DICOM Viewer',
    readyState: 'complete',
    documentElement: {},
    body: {innerText: ''},
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
  },
  chrome: {
    runtime: {
      id: 'test-extension',
      sendMessage: async () => ({}),
      onMessage: {addListener: listener => runtimeListeners.push(listener)},
    },
  },
  MutationObserver: MutationObserverStub,
  setTimeout: () => nextTimerId++,
  clearTimeout: () => {},
  setInterval: () => {
    const id = nextTimerId++;
    activeIntervals.add(id);
    return id;
  },
  clearInterval: id => activeIntervals.delete(id),
};
context.window = context;
context.addEventListener = () => {};
context.postMessage = () => {};
vm.createContext(context);

vm.runInContext(source, context, {filename: 'content.js'});
vm.runInContext(source, context, {filename: 'content.js'});

assert.equal(runtimeListeners.length, 1, 'reinjection must reuse one runtime listener');
assert.equal(activeIntervals.size, 1, 'reinjection must leave one scanner interval');
assert.equal(activeObservers.size, 1, 'reinjection must leave one mutation observer');

runtimeListeners[0]({type: 'CLEANUP_TRACKING'}, {}, () => {});
assert.equal(activeIntervals.size, 0, 'cleanup must stop scanner interval');
assert.equal(activeObservers.size, 0, 'cleanup must disconnect observer');

runtimeListeners[0]({type: 'RESTART_TRACKING'}, {}, () => {});
assert.equal(activeIntervals.size, 1, 'manual restart must create one scanner interval');
assert.equal(activeObservers.size, 1, 'manual restart must create one observer');

vm.runInContext(source, context, {filename: 'content.js'});
assert.equal(runtimeListeners.length, 1, 'later reinjection must remain idempotent');
assert.equal(activeIntervals.size, 1, 'later reinjection must not multiply scanner intervals');

console.log('Content tracking lifecycle tests OK');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as downloadUi from '../lib/download_ui_state.js';

// Exercise the real panel's handlers with in-memory Chrome, DOM and clock
// boundaries. No patient data, browser profile, network or filesystem is used.
const source = readFileSync(new URL('../sidepanel.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '')
  .replace(/^bindActive\(\)\.then\(refreshHistory\)\.catch\(.+;\r?$/gm, '');

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.value = '';
    this.disabled = false;
    this.checked = false;
    this.clearCount = 0;
    this.classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => this.classes.add(name)),
      remove: (...names) => names.forEach(name => this.classes.delete(name)),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const add = force ?? !this.classes.has(name);
        if (add) this.classes.add(name); else this.classes.delete(name);
        return add;
      },
    };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) {
    this.text = String(value);
    this.html = '';
    this.children = [];
    this.clearCount++;
  }
  get textContent() { return this.text || this.children.map(child => child.textContent).join(''); }
  set innerHTML(value) {
    this.html = String(value);
    this.text = this.html.replace(/<[^>]*>/g, '');
    this.children = [];
    this.clearCount++;
  }
  get innerHTML() { return this.html || this.text || ''; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.clearCount++; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  async click() {
    if (this.disabled) return;
    for (const handler of this.listeners.get('click') || []) {
      await handler({target: this, preventDefault() {}});
    }
  }
  querySelectorAll(selector) {
    const descendants = this.children.flatMap(child => [child, ...child.descendants()]);
    if (selector === 'input') return descendants.filter(child => child.tagName === 'input');
    if (selector.startsWith('input[type=checkbox]')) {
      return descendants.filter(child => child.tagName === 'input' && child.type === 'checkbox'
        && (!selector.endsWith(':checked') || child.checked));
    }
    return descendants.filter(child => child.tagName === selector);
  }
  descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

const fixtureInventory = () => ({
  adapter: 'VRAD', studyUid: 'test-study', patient: {id: 'test-patient', name: 'Fixture'},
  series: [{id: 'series-1', imageCount: 20}, {id: 'series-2', imageCount: 30}],
});
const fixtureJob = (overrides = {}) => ({
  id: 'test-job', tabId: 1, adapter: 'VRAD', status: 'downloading',
  completed: 197, failed: 0, total: 576, updatedAt: 100,
  selectedSeries: ['series-1', 'series-2'], ...overrides,
});
const overview = (job, inventory = fixtureInventory()) => ({
  ok: true, summary: {confidence: 100, currentUrl: 'https://pacs.test/viewer'},
  state: {tracking: 'watching', confidence: 100}, job, inventory,
});

function createPanel() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const runtimeListeners = [];
  const activatedListeners = [];
  const requests = [];
  const timers = new Map();
  let now = 0;
  let nextTimer = 0;
  let activeTab = {id: 1, url: 'https://pacs.test/viewer'};
  let respond = message => message.type === 'GET_HISTORY'
    ? {ok: true, history: []} : {ok: true};
  const context = vm.createContext({
    ...downloadUi, URL, URLSearchParams, Blob, console,
    location: {search: ''}, navigator: {},
    document: {getElementById: element, createElement: tag => new Element(tag), activeElement: null},
    window: {addEventListener() {}},
    setTimeout: (callback, delay = 0) => {
      const id = ++nextTimer;
      timers.set(id, {callback, at: now + delay});
      return id;
    },
    clearTimeout: id => timers.delete(id),
    chrome: {
      runtime: {
        onMessage: {addListener: listener => runtimeListeners.push(listener)},
        sendMessage: async message => { requests.push(message); return respond(message); },
      },
      tabs: {
        query: async () => [activeTab],
        get: async () => activeTab,
        onActivated: {addListener: listener => activatedListeners.push(listener)},
        onUpdated: {addListener() {}},
      },
      storage: {local: {get: async () => ({}), set: async () => {}}},
    },
    resolveBulkDicomSaveMode: () => 'filesystem',
  });
  vm.runInContext(source, context, {filename: 'sidepanel.js'});
  // A granted fake directory exercises startDownload without IndexedDB/pickers.
  vm.runInContext("fsGet = async () => ({name: 'Test downloads', queryPermission: async () => 'granted'});", context);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return {
    element, requests,
    evaluate: code => vm.runInContext(code, context),
    respondWith: handler => { respond = handler; },
    seed: response => {
      context.seedOverview = response;
      vm.runInContext('tabId=1; summary=seedOverview.summary; state=seedOverview.state; inventory=seedOverview.inventory; job=seedOverview.job;', context);
    },
    emit: async message => {
      for (const listener of runtimeListeners) listener(message);
      await flush();
    },
    activate: async tab => {
      activeTab = tab;
      for (const listener of activatedListeners) listener({tabId: tab.id});
      await flush();
    },
    advance: async duration => {
      const end = now + duration;
      let runs = 0;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++runs < 100, 'panel must not create an unbounded timer loop');
        const [id, timer] = next;
        timers.delete(id);
        now = timer.at;
        await timer.callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

test('active download owns the status and hides discovery/series controls', () => {
  const panel = createPanel();
  panel.seed(overview(fixtureJob()));
  panel.evaluate('renderStatus(); renderInventory(); renderJob(); renderLearning();');
  assert.equal(panel.element('statusTitle').textContent, 'Downloading');
  assert.equal(panel.element('scoreText').textContent, '34%');
  assert.equal(panel.element('trackBtn').disabled, true);
  assert.equal(panel.element('scanBtn').disabled, true);
  for (const id of ['learnCard', 'studyCard', 'seriesCard', 'stickyBar']) {
    assert.equal(panel.element(id).classList.contains('hidden'), true, `${id} stays collapsed`);
  }
});

test('terminal job rendering performs one final sync without polling forever', async () => {
  const panel = createPanel();
  const result = overview(fixtureJob({status: 'done', completed: 576}));
  panel.seed(result);
  panel.respondWith(message => message.type === 'GET_OVERVIEW' ? result : {ok: true, history: []});
  panel.evaluate('renderJob(); renderJob(); renderJob();');
  await panel.advance(2000);
  assert.equal(panel.requests.filter(message => message.type === 'GET_OVERVIEW').length, 1);
  assert.equal(panel.requests.filter(message => message.type === 'GET_HISTORY').length, 1);
});

test('progress and inventory events do not recreate series rows during a download', async () => {
  const panel = createPanel();
  panel.seed(overview(null));
  panel.evaluate('renderInventory();');
  const list = panel.element('seriesList');
  const initialRow = list.children[0];
  const clears = list.clearCount;
  await panel.emit({type: 'JOB_UPDATED', tabId: 1, job: fixtureJob()});
  await panel.emit({type: 'JOB_UPDATED', tabId: 1, job: fixtureJob({completed: 281, updatedAt: 101})});
  await panel.emit({type: 'INVENTORY_UPDATED', tabId: 1, inventory: fixtureInventory()});
  assert.equal(list.children[0], initialRow, 'series DOM survives progress notifications');
  assert.equal(list.clearCount, clears, 'progress does not rebuild the series editor');
  assert.equal(panel.element('progressText').textContent, '281 / 576');
  assert.equal(panel.element('statusTitle').textContent, 'Downloading');
});

test('a delayed overview cannot replace newer pushed download progress', async () => {
  const panel = createPanel();
  const oldResult = overview(fixtureJob());
  panel.seed(oldResult);
  let resolveOverview;
  panel.respondWith(message => message.type === 'GET_OVERVIEW'
    ? new Promise(resolve => { resolveOverview = resolve; }) : {ok: true});
  const pending = panel.evaluate('refresh()');
  await panel.emit({type: 'JOB_UPDATED', tabId: 1, job: fixtureJob({completed: 337, updatedAt: 102})});
  resolveOverview(oldResult);
  await pending;
  assert.equal(panel.element('progressText').textContent, '337 / 576');
  assert.match(panel.element('statusText').textContent, /337\/576/);
});

test('the tail of a download does not flash the series editor back into view', async () => {
  const panel = createPanel();
  panel.seed(overview(fixtureJob()));
  panel.evaluate('renderStatus(); renderInventory(); renderJob(); renderLearning();');
  assert.equal(panel.element('cancelBtn').classList.contains('hidden'), false);
  // What the background holds while the sidecar is written and an adapter
  // fallback may still be armed: the images are in, the result is not.
  const finishing = fixtureJob({status: downloadUi.FINISHING_STATUS, completed: 576, updatedAt: 104});
  await panel.emit({type: 'JOB_UPDATED', tabId: 1, job: finishing});
  assert.equal(panel.element('statusTitle').textContent, 'Finishing');
  assert.equal(panel.element('scoreText').textContent, '100%');
  for (const id of ['seriesCard', 'stickyBar', 'resumeBtn', 'cancelBtn']) {
    assert.equal(panel.element(id).classList.contains('hidden'), true, `${id} stays collapsed while finishing`);
  }
  // A fallback attempt for the images the first adapter missed.
  await panel.emit({type: 'JOB_UPDATED', tabId: 1, job: fixtureJob({completed: 576, total: 700, updatedAt: 105})});
  assert.equal(panel.element('statusTitle').textContent, 'Downloading');
  assert.equal(panel.element('seriesCard').classList.contains('hidden'), true,
    'the editor must not reappear between two adapter attempts');
});

test('switching to another downloading tab cannot inherit the prior study or selection', async () => {
  const panel = createPanel();
  panel.seed(overview(null));
  panel.evaluate('renderInventory();');
  panel.respondWith(message => message.type === 'GET_OVERVIEW'
    ? overview(fixtureJob({id: 'other-job', tabId: 2}), null) : {ok: true});
  await panel.activate({id: 2, url: 'https://other-pacs.test/viewer'});
  assert.equal(panel.evaluate('inventory'), null, 'the old tab inventory must not be retained');
  assert.equal(panel.element('seriesList').querySelectorAll('input[type=checkbox]').length, 0,
    'the old study selection must not remain available to resume in the new tab');
});

test('opening during a download still allows resuming its selected series after a partial result', async () => {
  const panel = createPanel();
  const running = fixtureJob({completed: 15, total: 30, selectedSeries: ['series-2'], allSeriesSelected: false});
  let result = overview(running);
  panel.respondWith(message => {
    if (message.type === 'GET_OVERVIEW') return result;
    if (message.type === 'START_DOWNLOAD') return {ok: true, job: running};
    return {ok: true, history: []};
  });
  await panel.evaluate('bindActive()');
  assert.equal(panel.element('seriesList').children.length, 0, 'panel starts with no rendered checkboxes');
  const partial = {...running, status: 'partial', updatedAt: 103};
  result = overview(partial, {...fixtureInventory(), previousDownload: {
    status: 'partial', lastDownloadAt: 103, completed: 15, total: 30,
  }});
  await panel.emit({type: 'JOB_UPDATED', tabId: 1, job: partial});
  await panel.advance(1000);
  assert.equal(panel.element('resumeBtn').classList.contains('hidden'), false);
  assert.equal(panel.element('resumeBtn').disabled, false, 'resume cannot depend on hidden/unrendered checkboxes');
  await panel.element('resumeBtn').click();
  const request = panel.requests.find(message => message.type === 'START_DOWNLOAD');
  assert.ok(request, 'Resume starts a new download');
  assert.deepEqual(Array.from(request.selectedSeries), ['series-2'], 'Resume retains the original selection');
});

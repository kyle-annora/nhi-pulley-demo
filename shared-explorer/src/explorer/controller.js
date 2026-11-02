import { DISPLAY_DEFAULTS, LINE_WEIGHTS, displayOptions } from './display-profiles.js';
import { CLIENT_THEMES } from './themes.js';
import { intersectCapabilities, tourRequirements } from './project-features.js';

export const EXPLORER_PROTOCOL = 'annora.explorer/0.1-draft';
const STYLES = ['engineering', 'linework', 'flat'];
const QUALITIES = ['balanced', 'performance', 'quality'];
const SPEEDS = [.25, .5, 1];
const QUERIES = new Set(['getState', 'getCapabilities', 'getNode', 'getChildren', 'getTour', 'captureView']);
const TOUR_COMMANDS = new Set(['startTour', 'pauseTour', 'resumeTour', 'seekTour', 'goToTourChapter', 'exitTour']);
const ERROR_CODES = new Set(['NOT_READY', 'UNKNOWN_NODE', 'UNKNOWN_TOUR', 'UNKNOWN_CHAPTER', 'UNSUPPORTED_ACTION', 'INVALID_ARGUMENT', 'INVALID_REQUEST', 'BUSY_STATE', 'ASSET_LOAD_FAILED', 'INCOMPATIBLE_VIEW', 'PROTOCOL_MISMATCH', 'SESSION_MISMATCH', 'DISPOSED']);
const PARAMETERS = {
  getState: [], getCapabilities: [], getNode: ['nodeId'], getChildren: ['nodeId'], getTour: ['tourId'],
  select: ['nodeId'], focus: ['nodeId'], frame: ['nodeId', 'view'], isolate: ['nodeId'],
  setRenderStyle: ['style'], setDisplayOptions: ['options'], setMode: ['mode'], setExplosion: ['progress', 'transition'], pauseExplosion: [], resumeExplosion: [], replayExplosion: [],
  playOperation: [], replayOperation: [], pauseOperation: [], seekOperation: ['progress'], setOperationSpeed: ['speed'], setFollowCamera: ['enabled'],
  startTour: ['tourId'], pauseTour: [], resumeTour: [], seekTour: ['seconds', 'chapterId'], goToTourChapter: ['chapterId'], exitTour: ['restore'],
  setTheme: ['themeId'], setQuality: ['profile'], captureView: [], restoreView: ['bookmark'], cancel: ['requestId'], dispose: [],
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => JSON.parse(JSON.stringify(value));
const immutable = value => { if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); } return value; };
const fail = (code, message, retryable = false) => Object.assign(new Error(message), { code, retryable });
const check = (value, message, code = 'INVALID_ARGUMENT') => { if (!value) throw fail(code, message); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const fraction = value => finite(value) && value >= 0 && value <= 1;
const vector = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const canonical = value => JSON.stringify(value, (_, item) => plain(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function jsonValue(value, depth = 0) {
  if (depth > 24) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 10000 && value.every(item => jsonValue(item, depth + 1));
  return plain(value) && Object.keys(value).length <= 1000 && Object.values(value).every(item => jsonValue(item, depth + 1));
}
const laneFor = method => method === 'setRenderStyle' ? ['render']
  : ['startTour', 'exitTour', 'restoreView'].includes(method) ? ['pose', 'render', 'tour']
  : ['focus', 'frame', 'isolate', 'setMode', 'setExplosion', 'pauseExplosion', 'resumeExplosion', 'replayExplosion', 'seekOperation', 'playOperation', 'replayOperation', 'pauseOperation', 'pauseTour', 'resumeTour', 'seekTour', 'goToTourChapter'].includes(method) ? ['pose'] : [];

/** The scene is private. Both the existing shell and an iframe host use this boundary.
 * Port getters allow loading-time discovery without constructing a second scene or clock.
 */
export class ExplorerController {
  constructor({ model, port, instanceId = globalThis.crypto?.randomUUID?.() || `explorer-${Date.now()}-${Math.random().toString(36).slice(2)}`, enabled = {} }) {
    this.model = model; this.port = port; this.instanceId = instanceId; this.enabled = intersectCapabilities(model.allowedCapabilities, enabled);
    this.authoredTourRequirements = tourRequirements(model.tour);
    this.lifecycle = 'created'; this.stateRevision = 0; this.eventSequence = 0;
    this.listeners = new Set(); this.requests = new Map(); this.requestSequence = 0; this.lastPublished = ''; this.lastDiscrete = ''; this.lastNotify = 0;
    this.environment = { visible: true, reducedMotion: false };
  }

  get scene() { return this.port.getScene?.(); }
  get tour() { return this.port.getTour?.(); }
  get hierarchy() { return this.port.getHierarchy?.(); }
  get identity() { return { id: this.model.packageId || this.model.id, revision: this.model.revision || 'unversioned' }; }
  get ready() { return this.lifecycle === 'ready' && Boolean(this.scene?.ready); }
  get operationSupported() { return Boolean(this.model.capabilities?.operation ?? this.model.operation ?? this.scene?.operationConfig); }

  subscribe(listener) {
    if (typeof listener !== 'function') throw new TypeError('A subscription needs a function.');
    if (this.lifecycle === 'disposed') return () => {};
    this.listeners.add(listener); return () => this.listeners.delete(listener);
  }
  emit(type, payload, requestId) {
    const event = { protocolVersion: EXPLORER_PROTOCOL, instanceId: this.instanceId, eventSequence: ++this.eventSequence, stateRevision: this.stateRevision, type, ...(requestId ? { requestId } : {}), payload: copy(payload) };
    for (const listener of this.listeners) { try { listener(copy(event)); } catch { /* A host listener cannot interrupt presentation or another subscriber. */ } }
    return event;
  }
  setLifecycle(value, error) {
    if (this.lifecycle === 'disposed' || this.lifecycle === 'disposing') return;
    const allowed = { created: ['loading', 'error'], loading: ['ready', 'error'], ready: ['error'], error: [] };
    if (value !== this.lifecycle && !allowed[this.lifecycle]?.includes(value)) throw new Error(`Invalid Explorer lifecycle: ${this.lifecycle} → ${value}`);
    this.lifecycle = value; this.notify({ force: true });
    if (value === 'ready') this.emit('ready', { state: this.getState(), capabilities: this.getCapabilities() });
    if (value === 'error') this.emit('error', { code: 'ASSET_LOAD_FAILED', message: 'The model could not be loaded.', retryable: true });
  }
  setEnvironment(environment) { Object.assign(this.environment, environment); this.notify({ force: true }); }

  getCapabilities() {
    const active = this.ready, supportedModes = ['explore', 'explode', ...(this.operationSupported ? ['operate'] : [])];
    const allowed = (name, values) => this.enabled[name] === false ? [] : Array.isArray(this.enabled[name]) ? values.filter(value => this.enabled[name].includes(value)) : values;
    const supportedStyles = this.model.capabilities?.renderStyles || STYLES;
    const styles = allowed('renderStyles', supportedStyles), modes = allowed('modes', supportedModes).filter(mode => mode !== 'operate' || this.enabled.operation !== false);
    const operation = this.operationSupported && this.enabled.operation !== false && modes.includes('operate');
    const authored = this.model.tour, requires = this.authoredTourRequirements;
    const tourAllowed = requires.renderStyles.every(style => styles.includes(style)) && (!requires.explode || modes.includes('explode')) && (!requires.operation || operation);
    const tours = authored && tourAllowed && allowed('tours', [authored.id]).length ? [authored] : [];
    const clipId = this.scene?.operationConfig?.clip || this.model.operationClipId || null;
    return copy({ protocolVersion: EXPLORER_PROTOCOL, runtimeVersion: '0.1.0', instanceId: this.instanceId, lifecycle: this.lifecycle, model: this.identity,
      renderStyles: { supported: supportedStyles, enabled: styles, available: active ? styles : [] },
      modes: { supported: supportedModes, enabled: modes, available: active ? modes : [] },
      operation: { supported: this.operationSupported, enabled: operation, available: active && operation && Boolean(this.scene.getOperationState().available), clips: clipId ? [clipId] : [], speeds: operation ? SPEEDS : [] },
      tours: { supported: Boolean(authored), enabled: Boolean(tours.length), available: active && Boolean(this.tour) && Boolean(tours.length), items: tours.map(tour => ({ id: tour.id, title: tour.title, duration: tour.duration })) },
      displayOptions: { defaults: DISPLAY_DEFAULTS, lineWeights: Object.keys(LINE_WEIGHTS) },
      qualityProfiles: allowed('qualityProfiles', QUALITIES), themes: allowed('themes', CLIENT_THEMES.map(theme => theme.id)),
    });
  }
  getState() {
    const scene = this.scene, available = this.ready, operation = available ? scene.getOperationState() : null;
    const tour = this.tour, transport = tour?.player?.state();
    const activity = this.lifecycle === 'disposed' ? [] : [...this.requests.values()].filter(item => !item.terminal && !QUERIES.has(item.method)).map(item => ({ requestId: item.id, activity: item.method }));
    return copy({ protocolVersion: EXPLORER_PROTOCOL, instanceId: this.instanceId, stateRevision: this.stateRevision, lifecycle: this.lifecycle, model: this.identity,
      navigation: { selectedId: available ? scene.selectedId : null, scopeId: available ? scene.scopeId : null, isolated: available ? Boolean(scene.isolated) : null },
      presentation: { mode: available ? scene.mode : null, renderStyle: available ? scene.renderStyle || 'engineering' : null, explosion: available ? scene.fraction || 0 : null, explosionTarget: available ? scene.explosionTarget || 0 : null, separation: available ? scene.getSeparationState?.() || null : null, transitioning: available ? this.transitioning() : null },
      operation: { available: Boolean(available && operation.available && this.getCapabilities().operation.enabled), clipId: this.getCapabilities().operation.clips[0] || null, status: !available || !operation.available ? 'unavailable' : operation.playing ? 'playing' : operation.progress >= 1 ? 'completed' : 'paused', progress: available && operation.available ? operation.progress : null, duration: available && operation.available ? operation.duration ?? null : null, sourceDuration: available && operation.available ? operation.sourceDuration ?? null : null, speed: available && operation.available ? operation.speed : null, followCamera: Boolean(available && operation.followCamera) },
      tour: { active: Boolean(tour?.active), tourId: tour?.tour?.id || null, playback: tour?.tour?.playback || 'continuous', status: tour?.pending ? 'preparing' : tour?.active ? transport.status : 'idle', time: transport?.time || 0, duration: tour?.tour?.duration || 0, chapterId: tour?.active ? transport?.chapter?.id || null : null, reason: tour?.active ? transport.reason : null },
      appearance: { display: { ...DISPLAY_DEFAULTS, ...scene?.displayOptions }, theme: this.port.getTheme?.() || { id: 'ember', revision: '1' }, quality: scene?.quality || 'balanced', effectiveQuality: scene?.effectiveQuality || 'balanced' },
      environment: this.environment, busy: activity,
    });
  }
  transitioning() {
    const scene = this.scene;
    return Boolean(scene && (scene.transformTransition || scene.separationAction?.playing || scene.cameraMotion?.active || scene.separationMotion?.active || [...(scene.movingMeshes || [])].some(mesh => mesh.userData.pose?.active || mesh.userData.visibility?.active)));
  }
  notify({ force = false } = {}) {
    if (this.lifecycle === 'disposed') return;
    const state = this.getState(), key = canonical({ ...state, stateRevision: 0 });
    if (key === this.lastPublished) return;
    const discrete = canonical({ ...state, stateRevision: 0, presentation: { ...state.presentation, explosion: null, explosionTarget: null, separation: state.presentation.separation ? { ...state.presentation.separation, progress:null, time:null, value:null } : null }, operation: { ...state.operation, progress: null }, tour: { ...state.tour, time: null } });
    const now = globalThis.performance?.now?.() || Date.now();
    if (!force && discrete === this.lastDiscrete && now - this.lastNotify < 100) return;
    this.lastPublished = key; this.lastDiscrete = discrete; this.lastNotify = now;
    ++this.stateRevision; this.emit('stateChanged', this.getState());
  }

  request(envelope) {
    let requestId = envelope?.requestId, method, params, fingerprint;
    try {
      check(plain(envelope) && typeof requestId === 'string' && requestId.length > 0 && requestId.length <= 256, 'A request needs a bounded string requestId.', 'INVALID_REQUEST');
      method = envelope.method; params = envelope.params ?? {};
      check(typeof method === 'string' && Object.hasOwn(PARAMETERS, method), 'Unknown Explorer command.', 'INVALID_REQUEST');
      check(plain(params) && jsonValue(params) && canonical(params).length <= 65536, 'Command parameters must be bounded JSON data.', 'INVALID_REQUEST');
      check(Object.keys(params).every(key => PARAMETERS[method].includes(key)), 'Unexpected command parameter.');
      params = copy(params); fingerprint = canonical({ method, params });
      const existing = this.requests.get(requestId);
      if (existing) {
        check(existing.fingerprint === fingerprint, 'This requestId was already used for different arguments.', 'INVALID_REQUEST');
        return existing.promise;
      }
      check(this.lifecycle !== 'disposed' && this.lifecycle !== 'disposing' || ['getState', 'getCapabilities', 'dispose'].includes(method), 'The Explorer instance has been disposed.', 'DISPOSED');
    } catch (error) {
      return Promise.resolve(immutable(this.emit('commandResult', { status: 'failed', error: this.errorValue(error) }, typeof requestId === 'string' && requestId.length <= 256 ? requestId : undefined)));
    }
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    const record = { id: requestId, order: ++this.requestSequence, method, params, fingerprint, promise, resolve, abort: new AbortController(), lanes: laneFor(method), terminal: false };
    this.requests.set(requestId, record);
    // Register first: subscribers may synchronously submit or cancel another request.
    queueMicrotask(async () => {
      if (record.terminal) return;
      try {
        const execute = this.prepare(method, params);
        if (!QUERIES.has(method) && !['cancel', 'dispose'].includes(method)) {
          for (const other of this.requests.values()) if (other.order < record.order && !other.terminal && record.lanes.some(lane => other.lanes.includes(lane))) this.cancelRecord(other, 'superseded');
          if (!TOUR_COMMANDS.has(method) && (this.tour?.active || this.tour?.pending)) {
            // A pending tour still owns a future semantic commit. Even a selection
            // (which otherwise preserves camera/style preparation) must take that
            // ownership away before late line assets can start or restore a tour.
            for (const other of this.requests.values()) if (other.order < record.order && !other.terminal && ['startTour', 'exitTour'].includes(other.method)) this.cancelRecord(other, 'superseded');
            this.takeover('host-command', { cancelPending: false });
          }
        }
        this.emit('commandAccepted', { method }, requestId); if (!QUERIES.has(method)) this.notify({ force: true });
        const result = await execute(record);
        if (record.terminal || record.abort.signal.aborted) return;
        this.finish(record, { status: 'completed', result: result ?? {} });
        if (method === 'dispose') this.listeners.clear();
      } catch (error) {
        if (!record.terminal) this.finish(record, record.abort.signal.aborted ? { status: 'cancelled', reason: 'cancelled' } : { status: 'failed', error: this.errorValue(error) });
      }
    });
    return promise;
  }
  errorValue(error) { const known = ERROR_CODES.has(error?.code); return { code: known ? error.code : 'ASSET_LOAD_FAILED', message: known ? error.message : 'The requested presentation could not be prepared.', retryable: Boolean(error?.retryable ?? !known) }; }
  finish(record, payload) {
    if (record.terminal) return;
    record.terminal = true; if (!QUERIES.has(record.method)) { this.port.sync?.(); this.notify({ force: true }); }
    const event = this.emit('commandResult', payload, record.id); record.resolve(immutable(copy(event)));
    while (this.requests.size > 128) {
      const oldest = [...this.requests].find(([, entry]) => entry.terminal);
      if (!oldest) break; this.requests.delete(oldest[0]);
    }
  }
  cancelRecord(record, reason) {
    if (!record || record.terminal) return false;
    record.abort.abort();
    if (record.lanes.includes('tour')) this.tour?.cancelPending?.();
    if (record.lanes.length) this.scene?.cancelPresentationRequest?.({ render: record.lanes.includes('render'), motion: record.lanes.includes('pose') });
    this.finish(record, { status: 'cancelled', reason }); return true;
  }
  takeover(reason = 'user-takeover', { cancelPending = true } = {}) {
    if (this.lifecycle === 'disposed') return;
    if (cancelPending) for (const record of this.requests.values()) if (!record.terminal && record.lanes.includes('pose')) this.cancelRecord(record, reason);
    if (this.tour?.pending) { this.tour.cancelPending(); this.scene?.cancelPresentationRequest?.({ render: false, motion: true }); }
    if (this.tour?.active) this.tour.interact();
    this.notify({ force: true }); this.emit('takeover', { reason });
  }
  node(id) {
    check(typeof id === 'string' && id.length > 0, 'nodeId must be a nonempty string.');
    const node = this.hierarchy?.nodes.get(id); check(node, 'The component is not present in this model revision.', 'UNKNOWN_NODE'); return node;
  }
  descriptor(node) { return { id: node.id, title: node.title, kind: node.type, parentId: node.parent || null, childIds: [...node.children], description: node.description || '', attribution: this.model.attribution || '' }; }
  within(node, scopeId) { for (let current = node; current; current = this.hierarchy.nodes.get(current.parent)) if (current.id === scopeId) return true; return false; }
  async wait(record, settle = true, ignorePlayback = false) {
    if (record.abort.signal.aborted) throw fail('DISPOSED', 'The request was cancelled.');
    this.port.sync?.(); this.notify({ force: true });
    await this.scene.whenSettled({ signal: record.abort.signal, settle, ignorePlayback, frame: true });
    if (record.abort.signal.aborted) throw fail('DISPOSED', 'The request was cancelled.');
  }

  prepare(method, params) {
    if (method === 'getState') return () => this.getState();
    if (method === 'getCapabilities') return () => this.getCapabilities();
    if (method === 'dispose') return record => { this.dispose(record); return { disposed: true }; };
    if (method === 'cancel') {
      check(typeof params.requestId === 'string' && params.requestId.length > 0, 'cancel needs a requestId.');
      return () => ({ cancelled: this.cancelRecord(this.requests.get(params.requestId), 'cancelled') });
    }
    check(this.ready, 'The model is not ready. Wait for the ready event.', 'NOT_READY');
    const scene = this.scene, tour = this.tour, caps = this.getCapabilities();
    if (['getNode', 'getChildren', 'select', 'focus', 'frame'].includes(method)) {
      const node = this.node(params.nodeId);
      if (method === 'getNode') return () => this.descriptor(node);
      if (method === 'getChildren') return () => node.children.map(id => this.descriptor(this.node(id)));
      if (method === 'select') return async record => { scene.setSelected(node.id); scene.invalidate(); await this.wait(record, false); return { selectedId: scene.selectedId }; };
      if (method === 'focus') return async record => {
        const entering = node.children.length && node.id !== scene.scopeId || !this.within(node, scene.scopeId);
        if (entering) { scene.setScope(node.id); scene.setIsolated(false); }
        else if (scene.mode === 'operate') scene.setScope(scene.scopeId);
        scene.setSelected(node.id); scene.focusSelected(); if (entering) this.port.focus?.();
        await this.wait(record); return { scopeId: scene.scopeId, selectedId: scene.selectedId };
      };
      check(this.within(node, scene.scopeId), 'The component is outside this scope. Use focus to enter it first.', 'UNSUPPORTED_ACTION');
      check(params.view === undefined || ['current', 'front', 'rear'].includes(params.view), 'Unknown authored camera view.');
      return async record => {
        const meshes = node.meshNames.map(name => scene.meshes.get(name)).filter(mesh => scene.active.includes(mesh));
        check(meshes.length, 'This component is hidden. Use focus to enter it first.', 'UNSUPPORTED_ACTION');
        let direction;
        if (params.view && params.view !== 'current') {
          const [x, y, z] = this.model.defaultDirection; const reverse = params.view === 'rear';
          direction = scene.camera.position.clone().set(reverse ? -x : x, y, reverse ? -z : z); scene.setFollowCamera(false);
        }
        scene.fitMeshes(meshes, true, direction); scene.invalidate(); await this.wait(record, true, true); return { framedId: node.id };
      };
    }
    if (method === 'isolate') {
      const node = params.nodeId === null ? null : this.node(params.nodeId);
      return async record => { if (node && (scene.scopeId !== node.id || scene.mode === 'operate')) scene.setScope(node.id); else if (!node && scene.mode === 'operate') scene.setScope(scene.scopeId); scene.setIsolated(Boolean(node)); if (node) scene.setSelected(node.id); await this.wait(record); return { scopeId: scene.scopeId, isolated: scene.isolated }; };
    }
    if (method === 'setRenderStyle') {
      check(caps.renderStyles.enabled.includes(params.style), 'This rendering style is not enabled.', 'UNSUPPORTED_ACTION');
      return async record => { const applied = await scene.setRenderStyle(params.style); if (record.abort.signal.aborted) return; check(applied !== false, 'The rendering change was interrupted.', 'BUSY_STATE'); await this.wait(record, false); return { renderStyle: scene.renderStyle }; };
    }
    if (method === 'setMode') {
      check(caps.modes.enabled.includes(params.mode), 'This mode is not supported by the model.', 'UNSUPPORTED_ACTION');
      if (params.mode === 'explode') check(this.node(scene.scopeId).type !== 'component', 'An individual component cannot be separated.', 'UNSUPPORTED_ACTION');
      return async record => { scene.setMode(params.mode); await this.wait(record); return { mode: scene.mode }; };
    }
    if (method === 'setExplosion') {
      check(fraction(params.progress), 'Explosion progress must be a finite fraction from 0 to 1.');
      check(params.transition === undefined || ['animate', 'immediate'].includes(params.transition), 'Unknown transition type.');
      check(caps.modes.enabled.includes('explode'), 'Exploded presentation is not enabled.', 'UNSUPPORTED_ACTION');
      check(params.progress === 0 || this.node(scene.scopeId).type !== 'component', 'An individual component cannot be separated.', 'UNSUPPORTED_ACTION');
      return async record => { scene.explode(params.progress, params.transition !== 'immediate'); await this.wait(record, params.transition !== 'immediate'); return { explosion: scene.fraction }; };
    }
    if (['pauseExplosion', 'resumeExplosion', 'replayExplosion'].includes(method)) {
      check(caps.modes.enabled.includes('explode'), 'Exploded presentation is not enabled.', 'UNSUPPORTED_ACTION');
      check(scene.getSeparationState?.().available, 'Start a separation action before using its transport.', 'UNSUPPORTED_ACTION');
      return async record => {
        if (method === 'pauseExplosion') scene.pauseSeparation();
        else scene.resumeSeparation({ replay: method === 'replayExplosion' });
        await this.wait(record, false); return scene.getSeparationState();
      };
    }
    if (['playOperation', 'replayOperation', 'pauseOperation', 'seekOperation', 'setOperationSpeed', 'setFollowCamera'].includes(method)) {
      check(caps.operation.available, 'This model has no enabled operating clip.', 'UNSUPPORTED_ACTION');
      if (method === 'seekOperation') check(fraction(params.progress), 'Operation progress must be a finite fraction from 0 to 1.');
      if (method === 'setOperationSpeed') check(SPEEDS.includes(params.speed), 'Use an advertised operation speed.');
      if (method === 'setFollowCamera') check(typeof params.enabled === 'boolean', 'enabled must be a boolean.');
      return async record => {
        if (method === 'playOperation') { if (scene.mode !== 'operate') scene.setMode('operate'); if (!scene.operationPlayer.state().playing) scene.togglePlayback(); }
        if (method === 'replayOperation') scene.playOneCycle();
        if (method === 'pauseOperation') { scene.operationPlayer.pause(); scene.emitOperation(true); scene.invalidate(); }
        if (method === 'seekOperation') scene.setPlaybackProgress(params.progress);
        if (method === 'setOperationSpeed') scene.setPlaybackSpeed(params.speed);
        if (method === 'setFollowCamera') scene.setFollowCamera(params.enabled);
        await this.wait(record, false); return this.getState().operation;
      };
    }
    if (method === 'getTour' || TOUR_COMMANDS.has(method)) {
      check(caps.tours.enabled && tour, 'This model has no enabled guided tour.', 'UNSUPPORTED_ACTION');
      if (['getTour', 'startTour'].includes(method)) check(params.tourId === tour.tour.id, 'This tour is not available for this model.', 'UNKNOWN_TOUR');
      if (method === 'getTour') return () => ({ id: tour.tour.id, title: tour.tour.title, duration: tour.tour.duration, playback: tour.tour.playback || 'continuous', chapters: tour.tour.chapters.map(({ id, label, title, start, duration, previewAt = 0, settledAt }) => ({ id, label: label || title, start, duration, previewAt, ...(settledAt === undefined ? {} : { settledAt }) })) });
      if (method !== 'startTour') check(tour.active || method === 'exitTour' && tour.pending, 'Start a tour before using its transport.', 'UNSUPPORTED_ACTION');
      if (method === 'seekTour') {
        check(finite(params.seconds) && params.seconds >= 0 && params.seconds <= tour.tour.duration, 'Tour time is outside the authored duration.');
        if (params.chapterId !== undefined) {
          const chapter = tour.tour.chapters.find(chapter => chapter.id === params.chapterId);
          check(chapter && params.seconds >= chapter.start && params.seconds <= chapter.end, 'The requested time is outside this chapter.');
        }
      }
      if (method === 'goToTourChapter') check(tour.tour.chapters.some(chapter => chapter.id === params.chapterId), 'The chapter is not present in this tour.', 'UNKNOWN_CHAPTER');
      if (method === 'exitTour') check(params.restore === undefined || typeof params.restore === 'boolean', 'restore must be a boolean.');
      return async record => {
        if (method === 'startTour') { const started = await tour.start({ signal: record.abort.signal }); if (!record.abort.signal.aborted) check(started !== false && tour.active, 'The tour could not be prepared.', 'ASSET_LOAD_FAILED'); }
        if (method === 'pauseTour') tour.pause('user');
        if (method === 'resumeTour') tour.resume();
        if (method === 'seekTour') tour.jump('seek', params.seconds, params.chapterId);
        if (method === 'goToTourChapter') tour.jump('chapter', tour.tour.chapters.findIndex(chapter => chapter.id === params.chapterId));
        if (method === 'exitTour') await tour.exit({ restore: params.restore !== false, signal: record.abort.signal });
        await this.wait(record, method === 'exitTour'); return this.getState().tour;
      };
    }
    if (method === 'setTheme') {
      check(caps.themes.includes(params.themeId), 'Choose an enabled registered client theme.', 'UNSUPPORTED_ACTION');
      return async record => { this.port.setTheme(params.themeId); await this.wait(record, false); return this.getState().appearance; };
    }
    if (method === 'setDisplayOptions') {
      let options;try { options=displayOptions(params.options,scene.displayOptions); } catch(error) { throw fail('INVALID_ARGUMENT',error.message); }
      check(plain(params.options), 'Supply display options.');
      return async record => { scene.setDisplayOptions(options);await this.wait(record,false);return this.getState().appearance; };
    }
    if (method === 'setQuality') {
      check(QUALITIES.includes(params.profile), 'Choose an advertised quality profile.');
      check(caps.qualityProfiles.includes(params.profile), 'This quality profile is not enabled.', 'UNSUPPORTED_ACTION');
      return async record => { scene.setQuality(params.profile); await this.wait(record, false); return this.getState().appearance; };
    }
    if (method === 'captureView') return () => this.captureView();
    if (method === 'restoreView') {
      const bookmark = this.validateBookmark(params.bookmark);
      return async record => {
        // Preparing line data is the only asynchronous work before the semantic commit.
        if (bookmark.renderStyle !== 'engineering') await scene.prepareEdges();
        if (record.abort.signal.aborted) return;
        await scene.setRenderStyle(bookmark.renderStyle);
        if (record.abort.signal.aborted) return;
        scene.setDisplayOptions?.(bookmark.displayOptions || DISPLAY_DEFAULTS);
        scene.setScope(bookmark.scopeId); scene.setIsolated(bookmark.isolated); scene.setSelected(bookmark.selectedId);
        if (bookmark.mode === 'operate') { scene.setMode('operate'); scene.setPlaybackProgress(bookmark.operation.progress); scene.setSelected(bookmark.selectedId); }
        else scene.explode(bookmark.separation, false, bookmark.mode);
        scene.setFollowCamera(false); await this.wait(record);
        scene.restoreCameraView(bookmark.camera); await this.wait(record); return { restored: true };
      };
    }
    throw fail('INVALID_REQUEST', 'Unknown Explorer command.');
  }

  captureView() {
    const settled = this.scene.isSettled?.() ?? (!this.transitioning() && !this.scene.controlsMoving && !this.scene.benchmark?.active);
    check(!this.tour?.active && !this.tour?.pending && settled && !this.scene.presentationPoseDetached && !this.scene.getOperationState().playing && ![...this.requests.values()].some(item => !item.terminal && item.lanes.length), 'Pause playback, exit the tour and let the presentation settle before capturing a view. Restore or seek a source pose after an interrupted pose transition.', 'BUSY_STATE');
    const scene = this.scene, operation = scene.getOperationState();
    return copy({ viewVersion: '0.1', model: this.identity, coordinateFrame: 'normalized-assembly-v1', selectedId: scene.selectedId, scopeId: scene.scopeId, isolated: Boolean(scene.isolated), mode: scene.mode, renderStyle: scene.renderStyle, displayOptions: { ...DISPLAY_DEFAULTS, ...scene.displayOptions }, separation: scene.fraction || 0,
      operation: scene.mode === 'operate' ? { clipId: this.getCapabilities().operation.clips[0], progress: operation.progress, status: 'paused' } : null, camera: scene.captureCameraView() });
  }
  validateBookmark(value) {
    check(plain(value) && value.viewVersion === '0.1' && value.coordinateFrame === 'normalized-assembly-v1' && value.model?.id === this.identity.id && value.model?.revision === this.identity.revision, 'This view belongs to another model revision or coordinate convention.', 'INCOMPATIBLE_VIEW');
    if(value.displayOptions!==undefined)try { displayOptions(value.displayOptions); } catch(error) { throw fail('INVALID_ARGUMENT',error.message); }
    this.node(value.selectedId); this.node(value.scopeId);
    check(typeof value.isolated === 'boolean' && this.getCapabilities().modes.enabled.includes(value.mode) && this.getCapabilities().renderStyles.enabled.includes(value.renderStyle) && fraction(value.separation), 'Invalid bookmark presentation.');
    check(value.separation === 0 || this.node(value.scopeId).type !== 'component', 'A component bookmark cannot be separated.');
    check(value.mode !== 'explore' || value.separation === 0, 'An Explore bookmark must be assembled.');
    if (value.mode === 'operate') check(this.getCapabilities().operation.available && value.scopeId === this.model.rootId && value.separation === 0 && !value.isolated && value.operation?.clipId === this.getCapabilities().operation.clips[0] && fraction(value.operation?.progress) && value.operation.status === 'paused', 'Invalid operation bookmark.');
    else check(value.operation === null, 'A non-operating bookmark must not contain source playback.');
    const camera = value.camera, projection = camera?.projection, viewport = camera?.viewport;
    check(plain(camera) && vector(camera.position) && vector(camera.target) && vector(camera.up) && [...camera.position, ...camera.target, ...camera.up].every(value => Math.abs(value) <= 1e6), 'Invalid bookmark camera vectors.');
    const direction = camera.position.map((value, index) => value - camera.target[index]), up = camera.up;
    const cross = [direction[1] * up[2] - direction[2] * up[1], direction[2] * up[0] - direction[0] * up[2], direction[0] * up[1] - direction[1] * up[0]];
    check(Math.hypot(...direction) >= .01 && Math.hypot(...up) >= 1e-6 && Math.hypot(...cross) / Math.hypot(...direction) / Math.hypot(...up) > 1e-6, 'Camera direction and up must define a stable viewing plane.');
    const authoredUp = this.scene.camera.up?.toArray?.() || [0, 1, 0];
    check(up.every((value, index) => Math.abs(value / Math.hypot(...up) - authoredUp[index] / Math.hypot(...authoredUp)) < 1e-6), 'This runtime preserves the authored camera up direction; camera roll is not supported.', 'INCOMPATIBLE_VIEW');
    check(projection?.kind === 'perspective' && finite(projection.verticalFovDegrees) && projection.verticalFovDegrees >= 1 && projection.verticalFovDegrees <= 170 && finite(projection.zoom) && projection.zoom >= .001 && projection.zoom <= 1000 && finite(projection.offsetX) && finite(projection.offsetY) && Math.abs(projection.offsetX) <= 1e6 && Math.abs(projection.offsetY) <= 1e6, 'Invalid bookmark projection.');
    check(plain(viewport) && finite(viewport.width) && viewport.width > 0 && viewport.width <= 1e6 && finite(viewport.height) && viewport.height > 0 && viewport.height <= 1e6, 'Invalid bookmark viewport.');
    return copy(value);
  }
  dispose(exemptRecord) {
    if (this.lifecycle === 'disposed' || this.lifecycle === 'disposing') return;
    this.lifecycle = 'disposing';
    for (const record of this.requests.values()) if (record !== exemptRecord && !record.terminal) this.cancelRecord(record, 'disposed');
    this.notify({ force: true }); this.port.dispose?.(); this.lifecycle = 'disposed'; ++this.stateRevision;
    this.emit('stateChanged', this.getState()); this.emit('disposed', { disposed: true });
    if (!exemptRecord) this.listeners.clear();
  }
}

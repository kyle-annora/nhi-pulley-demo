import { displayOptions } from './display-profiles.js';
/** Browser-local measurements. No hardware fingerprinting, storage or network use. */
export const QUALITY_PROFILES = Object.freeze({
  balanced: Object.freeze({ label: 'Balanced', maxPixelRatio: 1.25, lineMaxPixelRatio: 2, maxPixels: 2_000_000, aoScale: .5, outlineScale: 1 }),
  performance: Object.freeze({ label: 'Performance', maxPixelRatio: 1, lineMaxPixelRatio: 1, maxPixels: 1_200_000, aoScale: 0, outlineScale: .5 }),
  quality: Object.freeze({ label: 'Quality', maxPixelRatio: 1.5, lineMaxPixelRatio: 2, maxPixels: 4_000_000, aoScale: 1, outlineScale: 1 })
});

const RENDER_STYLES = ['engineering', 'linework', 'flat'];
// Retain legacy names in exported reports; renderStyle identifies current treatments.
const MODES = [...RENDER_STYLES, 'material', 'technical', 'mixed'];
const PHASES = ['orbit', 'explode', 'reassemble', 'linework', 'flat', 'technical', 'engineering', 'inspect'];
const LOAD_KEYS = ['metadataMs', 'modelFetchMs', 'modelParseMs', 'preparationMs', 'firstInteractiveMs', 'firstTechnicalMs', 'firstLineworkMs', 'firstFlatMs', 'linePreparationMs', 'edgeFetchMs', 'edgeParseMs', 'transferBytes', 'encodedBodyBytes'];
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const rounded = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
const fields = (source, keys) => Object.fromEntries(keys.filter(key => finite(source?.[key])).map(key => [key, rounded(source[key])]));
const percentile = (sorted, fraction) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;

/** Small HiDPI canvases gain line clarity without raising the preset's total pixel cap. */
export function renderPixelRatio({ quality = 'balanced', renderStyle = 'engineering', width, height, devicePixelRatio = 1 } = {}) {
  const profile = QUALITY_PROFILES[Object.hasOwn(QUALITY_PROFILES, quality) ? quality : 'balanced'];
  const lineStyle = ['linework', 'flat', 'technical'].includes(renderStyle);
  const w = finite(width) && width > 0 ? width : 1;
  const h = finite(height) && height > 0 ? height : 1;
  const deviceRatio = finite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(deviceRatio, lineStyle ? profile.lineMaxPixelRatio : profile.maxPixelRatio, Math.sqrt(profile.maxPixels / (w * h)));
}

function statistics(values) {
  if (!values.length) return { count: 0, mean: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: values.length,
    mean: rounded(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50: rounded(percentile(sorted, .5)),
    p95: rounded(percentile(sorted, .95)),
    max: rounded(sorted.at(-1))
  };
}

function cleanContext(context) {
  const modelId = typeof context.modelId === 'string' && /^[a-z0-9-]{1,64}$/.test(context.modelId) ? context.modelId : 'apollo';
  const renderStyle = RENDER_STYLES.includes(context.renderStyle) ? context.renderStyle
    : RENDER_STYLES.includes(context.mode) ? context.mode
    : context.mode === 'technical' ? 'linework'
    : context.mode === 'material' ? 'engineering' : null;
  return {
    // v3 includes a representative selected assembly in Engineering so the
    // outline pass participates; v2 Engineering runs are not equivalent.
    scenario: `${modelId}-standard-v3`,
    modelId,
    mode: MODES.includes(context.mode) ? context.mode : renderStyle || 'mixed',
    renderStyle,
    displayOptions: displayOptions(context.displayOptions),
    quality: Object.hasOwn(QUALITY_PROFILES, context.quality) ? context.quality : 'balanced',
    viewport: fields(context.viewport, ['width', 'height', 'pixelRatio', 'renderWidth', 'renderHeight']),
    model: fields(context.modelStats, ['meshCount', 'triangles', 'glbBytes', 'edgeBytes', 'edgeSegments', 'silhouetteSegments', 'lineBytes', 'surfaceBytes', 'paletteBytes', 'lineBatchCount', 'activePartCount', 'contextPartCount', 'flatPartCount', 'selectedPartCount']),
    loading: fields(context.loadMetrics, LOAD_KEYS)
  };
}

/**
 * Start only for an intentional scripted run, after model preparation.
 * Call frame() once per RAF tick. Use renderMs:null when no frame was rendered.
 * CPU submit time surrounds composer.render(); it is NOT a GPU timing query.
 */
export class BenchmarkRecorder {
  constructor({ now = () => performance.now(), document = globalThis.document, PerformanceObserver = globalThis.PerformanceObserver } = {}) {
    this.now = now;
    this.document = document;
    this.Observer = PerformanceObserver;
    this.active = false;
    this.lastReport = null;
    this.visibilityChanged = () => { if (this.document?.hidden) this.cancel('page-hidden'); };
  }

  begin(context = {}) {
    if (this.active) this.cancel('restarted');
    this.context = cleanContext(context);
    this.started = this.now();
    this.lastTimestamp = null;
    this.lastMoving = false;
    this.lastPhase = null;
    this.intervals = [];
    this.cpu = [];
    this.drawCalls = [];
    this.triangles = [];
    this.lines = [];
    this.phaseIntervals = new Map();
    this.longTasks = [];
    this.ticks = 0;
    this.renderedFrames = 0;
    this.longTaskSupported = false;
    this.active = true;
    this.lastReport = null;
    this.document?.addEventListener('visibilitychange', this.visibilityChanged);
    if (this.Observer?.supportedEntryTypes?.includes('longtask')) {
      try {
        this.observer = new this.Observer(list => this.collectLongTasks(list.getEntries()));
        this.observer.observe({ type: 'longtask', buffered: false });
        this.longTaskSupported = true;
      } catch { this.observer = null; }
    }
    if (this.document?.hidden) this.cancel('page-hidden');
    return this.active;
  }

  frame(timestamp, { renderMs = null, drawCalls, triangles, lines, moving = false, phase } = {}) {
    if (!this.active || !finite(timestamp)) return;
    if (this.document?.hidden) { this.cancel('page-hidden'); return; }
    // Duplicate or out-of-order timestamps must not skew the sample sequence.
    if (this.lastTimestamp !== null && timestamp <= this.lastTimestamp) return;
    const currentPhase = PHASES.includes(phase) ? phase : 'inspect';
    if (moving && this.lastMoving && this.lastTimestamp !== null) {
      const interval = timestamp - this.lastTimestamp;
      this.intervals.push(interval);
      // Do not attribute a cross-phase boundary to either phase.
      if (currentPhase === this.lastPhase) {
        if (!this.phaseIntervals.has(currentPhase)) this.phaseIntervals.set(currentPhase, []);
        this.phaseIntervals.get(currentPhase).push(interval);
      }
    }
    this.ticks++;
    if (finite(renderMs)) {
      this.renderedFrames++;
      this.cpu.push(renderMs);
      if (finite(drawCalls)) this.drawCalls.push(drawCalls);
      if (finite(triangles)) this.triangles.push(triangles);
      if (finite(lines)) this.lines.push(lines);
    }
    this.lastTimestamp = timestamp;
    this.lastMoving = Boolean(moving);
    this.lastPhase = currentPhase;
  }

  recordLoadMetric(name, milliseconds) {
    if (this.active && LOAD_KEYS.includes(name) && finite(milliseconds)) this.context.loading[name] = rounded(milliseconds);
  }

  collectLongTasks(entries) {
    if (!this.active) return;
    for (const entry of entries) {
      if (finite(entry.startTime) && finite(entry.duration) && entry.startTime >= this.started) {
        this.longTasks.push({ startMs: entry.startTime - this.started, durationMs: entry.duration });
      }
    }
  }

  finish() {
    if (!this.active) return this.lastReport;
    return this.complete('completed', null);
  }

  cancel(reason = 'cancelled') {
    if (!this.active) return this.lastReport;
    const allowed = ['cancelled', 'page-hidden', 'restarted', 'user-input', 'settings-changed'];
    return this.complete('cancelled', allowed.includes(reason) ? reason : 'cancelled');
  }

  complete(status, reason) {
    if (this.observer) {
      this.collectLongTasks(this.observer.takeRecords());
      this.observer.disconnect();
      this.observer = null;
    }
    this.document?.removeEventListener('visibilitychange', this.visibilityChanged);
    const interval = statistics(this.intervals);
    const longTaskDurations = this.longTasks.map(task => task.durationMs);
    this.active = false;
    this.lastReport = {
      schemaVersion: 1,
      scope: 'Current browser and complete selected assembly',
      status, reason,
      ...this.context,
      durationMs: rounded(Math.max(0, this.now() - this.started)),
      frames: {
        observedTicks: this.ticks,
        rendered: this.renderedFrames,
        motionIntervals: interval.count,
        motionTimeMs: rounded(this.intervals.reduce((sum, value) => sum + value, 0)),
        frameIntervalMs: interval,
        medianFps: interval.p50 > 0 ? rounded(1000 / interval.p50) : null,
        over50Ms: this.intervals.filter(value => value > 50).length,
        enoughSamples: interval.count >= 30
      },
      cpuRenderSubmissionMs: statistics(this.cpu),
      drawCallsPerRenderedFrame: statistics(this.drawCalls),
      trianglesPerRenderedFrame: statistics(this.triangles),
      linesPerRenderedFrame: statistics(this.lines),
      phases: Object.fromEntries([...this.phaseIntervals].map(([key, values]) => [key, statistics(values)])),
      longTasks: {
        supported: this.longTaskSupported,
        count: this.longTaskSupported ? longTaskDurations.length : null,
        maxMs: this.longTaskSupported ? rounded(Math.max(0, ...longTaskDurations)) : null,
        totalMs: this.longTaskSupported ? rounded(longTaskDurations.reduce((sum, value) => sum + value, 0)) : null
      },
      limitations: [
        'Frame intervals describe this browser session, not a certified device class.',
        'CPU render submission duration is not GPU execution time.',
        'Draw, triangle and line counts include all measured render passes, not unique model geometry or visible pixels.',
        'Ribbon strokes contribute triangles; native line counts do not describe all visible linework.',
        'Line, surface and palette byte counts describe prepared CPU buffers, not total GPU allocation or peak process memory.',
        'The standard scenario measures orbit, explosion and restoration, not operating-animation playback.',
        'Loading values describe this navigation; browser cache and network conditions must be recorded separately.',
        'This host measurement does not certify ordinary computers or physical mobile devices.'
      ]
    };
    return this.lastReport;
  }
}

/** Serializes a recorder report for an explicit client-side download. */
export function serializeBenchmark(report) {
  if (!report || report.schemaVersion !== 1) throw new TypeError('A benchmark report is required.');
  return JSON.stringify(report, null, 2) + '\n';
}

/** Sustained motion, not one shader-compilation spike, can lower Balanced once. */
export class AdaptiveBudget {
  constructor(){this.reset();}
  reset(){this.samples=[];this.reduced=false;}
  observe(milliseconds,moving){
    if(this.reduced)return false;
    // Resume gaps are not workload samples; sustained very slow motion still is.
    if(!moving||!Number.isFinite(milliseconds)||milliseconds<=0||milliseconds>1000){this.samples=[];return false;}
    this.samples.push(milliseconds);if(this.samples.length<90)return false;
    const slow=this.samples.filter(ms=>ms>33.3).length;this.samples=[];
    if(slow>=60){this.reduced=true;return true;}return false;
  }
}

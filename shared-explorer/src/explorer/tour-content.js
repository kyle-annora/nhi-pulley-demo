/** Pure sampler. Authored timelines enter through model manifests. */
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };
function sampleOperation(operation, elapsed, settled) {
  if (!operation) return { progress: null, pass: null, held: false };
  const pass = operation.passes.findLast(pass => elapsed + 1e-9 >= pass.start);
  if (!pass) return { progress: settled ? operation.settledProgress : 0, pass: null, held: true };
  const local = clamp(elapsed - pass.start, 0, pass.duration);
  const nextIndex = pass.keyframes.findIndex(point => point.at > local + 1e-9);
  if (nextIndex < 0) return { progress: settled ? operation.settledProgress : pass.keyframes.at(-1).progress, pass: pass.id, held: true };
  const from = pass.keyframes[Math.max(0, nextIndex - 1)], to = pass.keyframes[nextIndex];
  const fraction = to.at === from.at ? 0 : clamp((local - from.at) / (to.at - from.at), 0, 1);
  return {
    progress: settled ? operation.settledProgress : from.progress + (to.progress - from.progress) * fraction,
    pass: pass.id, held: settled || from.progress === to.progress,
  };
}

/** Resolve complete state from absolute seconds; no prior frame or callback order is required. */
export function sampleTour(tourDefinition, seconds, { settled = false, chapterIndex } = {}) {
  const definition = tourDefinition;
  if (!definition?.chapters?.length || !(definition.duration > 0)) throw new TypeError('A tour needs an authored timeline.');
  const time = clamp(Number.isFinite(seconds) ? seconds : 0, 0, definition.duration);
  let index = Number.isInteger(chapterIndex) && chapterIndex >= 0 && chapterIndex < definition.chapters.length
    ? chapterIndex : definition.chapters.findIndex(chapter => time < chapter.end);
  if (index < 0) index = definition.chapters.length - 1;
  const chapter = definition.chapters[index];
  const elapsed = clamp(time - chapter.start, 0, chapter.duration);
  const presented = settled ? chapter.settledAt ?? chapter.previewAt ?? chapter.duration : elapsed;
  let pose = chapter, cueId = 'establish';
  for (const cue of chapter.cues || []) {
    if (cue.at > presented + 1e-9) break;
    pose = { ...pose, ...cue }; cueId = cue.id;
  }
  const transition = chapter.transition || 1.6;
  const mix = smooth((presented - (chapter.transitionStart || 0)) / transition);
  const explosion = chapter.explosion[0] + (chapter.explosion[1] - chapter.explosion[0]) * mix;
  const operation = sampleOperation(chapter.operation, presented, settled);
  return {
    key: `${definition.id}:${chapter.id}`, chapterId: chapter.id, cueId,
    scopeId: pose.scopeId, selectedId: pose.selectedId,
    highlightIds: [...pose.highlightIds], renderStyle: pose.renderStyle, technical: pose.renderStyle !== 'engineering',
    explosion, operationProgress: operation.progress, operationPass: operation.pass, operationHeld: operation.held,
    camera: { ...pose.camera, direction: [...pose.camera.direction] },
    annotations: pose.annotations.map(annotation => ({ ...annotation })),
    title: pose.title, caption: pose.caption, index,
    time, duration: definition.duration, chapterDuration: chapter.duration,
    chapterProgress: elapsed / chapter.duration, settled: Boolean(settled),
  };
}

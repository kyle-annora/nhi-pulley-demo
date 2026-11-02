import { AnimationMixer, LoopOnce, Matrix4 } from 'three';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Clock and transport state only. Playback starts only through an explicit action. */
export class OperationPlayer {
  constructor({ duration, stages = [] } = {}) {
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.stages = stages.filter(stage => Number.isFinite(stage.at)).map(stage => ({ ...stage, at: clamp(stage.at, 0, 1) })).sort((a,b) => a.at-b.at);
    this.time = 0; this.speed = 1; this.playing = false; this.once = false; this.hidden = false; this.lastTimestamp = null;
  }
  play({ once = false, restart = once } = {}) {
    if (!this.duration) return false;
    if (this.time >= this.duration || restart) this.time = 0;
    this.once = once; this.playing = true; this.lastTimestamp = null; return true;
  }
  pause() { this.playing = false; this.lastTimestamp = null; }
  toggle({ once = false } = {}) { if (this.playing) this.pause(); else this.play({once,restart:false}); }
  reset() { this.pause(); this.time = 0; this.once = false; }
  seek(fraction) { this.pause(); this.time = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1) * this.duration; }
  setSpeed(speed) { if (Number.isFinite(speed)) this.speed = clamp(speed, .25, 2); this.lastTimestamp = null; }
  setVisibility(hidden) { this.hidden = Boolean(hidden); this.lastTimestamp = null; }
  tick(timestamp, { blocked = false } = {}) {
    if (!this.playing || this.hidden || blocked || !Number.isFinite(timestamp)) { this.lastTimestamp = null; return false; }
    const previous = this.lastTimestamp; this.lastTimestamp = timestamp;
    if (previous === null || timestamp <= previous || timestamp - previous > 1000) return false;
    const next = this.time + (timestamp - previous) / 1000 * this.speed;
    if (this.once && next >= this.duration) { this.time = this.duration; this.pause(); }
    else this.time = next % this.duration;
    return true;
  }
  state() {
    const progress = this.duration ? this.time / this.duration : 0;
    let index = -1;
    for (let i=0;i<this.stages.length;i++) if (progress >= this.stages[i].at) index=i;
    return { available: this.duration > 0, playing: this.playing, progress, time: this.time, duration: this.duration, speed: this.speed,
      once: this.once, suspended: this.hidden, stage: index < 0 ? null : { ...this.stages[index], index, count: this.stages.length } };
  }
}

/** Samples a preserved source hierarchy; display meshes never become animation targets. */
export class SourceAnimationPose {
  constructor(root, clip, normalization = new Matrix4()) {
    this.root = root; this.clip = clip; this.normalization = normalization.clone(); this.rest = new Map();
    root.traverse(object => this.rest.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(), matrix: object.matrix.clone(), matrixAutoUpdate: object.matrixAutoUpdate }));
    this.mixer = new AnimationMixer(root); this.action = this.mixer.clipAction(clip); this.action.setLoop(LoopOnce, 1); this.action.clampWhenFinished = true;
    this.started = false; this.lastProgress = null;
  }
  sample(progress) {
    const fraction = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
    if (this.started && fraction === this.lastProgress) return false;
    if (!this.started) { this.action.reset().play(); this.started = true; }
    this.action.enabled = true; this.action.paused = false;
    this.mixer.setTime(fraction * this.clip.duration); this.root.updateMatrixWorld(true); this.lastProgress = fraction; return true;
  }
  matrixFor(object, target = new Matrix4()) { return target.copy(this.normalization).multiply(object.matrixWorld); }
  restore() {
    this.mixer.stopAllAction();
    for (const [object, pose] of this.rest) {
      object.position.copy(pose.position); object.quaternion.copy(pose.quaternion); object.scale.copy(pose.scale); object.matrix.copy(pose.matrix); object.matrixAutoUpdate = pose.matrixAutoUpdate; object.matrixWorldNeedsUpdate = true;
    }
    this.root.updateMatrixWorld(true); this.started = false; this.lastProgress = null;
  }
  dispose() { this.restore(); this.mixer.uncacheRoot(this.root); }
}

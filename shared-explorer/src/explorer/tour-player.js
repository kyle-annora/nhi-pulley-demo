/** A renderer-independent clock. The host owns RAF, visibility events and scene sampling. */
export class TourPlayer {
  constructor(tour, { reducedMotion = false, pauseAtChapterEnd = tour?.playback === 'steps' } = {}) {
    if (!tour?.chapters?.length) throw new TypeError('A tour needs chapters.');
    let duration = 0;
    this.chapters = tour.chapters.map(chapter => {
      if (!Number.isFinite(chapter.duration) || chapter.duration <= 0) throw new TypeError('Each chapter needs a positive duration.');
      const start = duration; duration += chapter.duration;
      return Object.freeze({ ...chapter, start, end: duration });
    });
    if (!Number.isFinite(tour.duration) || Math.abs(tour.duration - duration) > 1e-6) throw new TypeError('Tour duration must match its chapters.');
    this.duration = duration;
    this.reducedMotion = Boolean(reducedMotion);
    this.pauseAtChapterEnd = pauseAtChapterEnd;
    this.heldChapterIndex = null;
    this.hidden = false;
    this.time = 0;
    this.status = 'idle';
    this.reason = null;
    this.lastTimestamp = null;
  }

  start() {
    this.heldChapterIndex = null;
    this.time = 0; this.status = 'paused'; this.lastTimestamp = null;
    return this.resume();
  }

  pause(reason = 'user') {
    if (this.status === 'playing' || this.status === 'paused') { this.status = 'paused'; this.reason = reason; }
    this.lastTimestamp = null;
    return this.state();
  }

  resume() {
    if (this.heldChapterIndex !== null) {
      this.time = this.chapters[this.heldChapterIndex].start;
      this.heldChapterIndex = null;
    }
    this.lastTimestamp = null;
    if (this.time >= this.duration) { this.status = 'completed'; this.reason = null; }
    else if (this.hidden) { this.status = 'paused'; this.reason = 'hidden'; }
    else if (this.reducedMotion) { this.status = 'paused'; this.reason = 'reduced-motion'; }
    else { this.status = 'playing'; this.reason = null; }
    return this.state();
  }

  seek(seconds, { chapterIndex } = {}) {
    if (!Number.isFinite(seconds)) return this.state();
    this.heldChapterIndex = null;
    this.time = Math.max(0, Math.min(this.duration, seconds));
    this.status = this.time === this.duration ? 'completed' : 'paused';
    this.reason = this.status === 'completed' ? null : 'seek';
    this.lastTimestamp = null;
    if (Number.isInteger(chapterIndex) && this.chapters[chapterIndex]?.end === this.time) return this.holdChapterEnd(chapterIndex);
    return this.state();
  }

  holdChapterEnd(index) {
    if (!this.pauseAtChapterEnd || !this.chapters[index]) return this.state();
    this.time = this.chapters[index].end;
    this.heldChapterIndex = index;
    this.status = 'paused'; this.reason = 'chapter-end'; this.lastTimestamp = null;
    return this.state();
  }

  next() {
    const { index } = this.state();
    return this.seek(index + 1 < this.chapters.length ? this.chapters[index + 1].start : this.duration);
  }

  previous() {
    const { index } = this.state();
    return this.seek(this.chapters[Math.max(0, index - 1)].start);
  }

  replay() { return this.start(); }

  stop() {
    this.heldChapterIndex = null;
    this.time = 0; this.status = 'idle'; this.reason = null; this.lastTimestamp = null;
    return this.state();
  }

  setVisibility(hidden) {
    this.hidden = Boolean(hidden);
    if (this.hidden && this.status === 'playing') this.pause('hidden');
    this.lastTimestamp = null;
    return this.state();
  }

  /** Timestamps are RAF milliseconds. Background gaps and stalled frames never skip explanation. */
  tick(timestamp) {
    if (this.status !== 'playing' || this.hidden || !Number.isFinite(timestamp)) { this.lastTimestamp = null; return false; }
    const previous = this.lastTimestamp;
    this.lastTimestamp = timestamp;
    if (previous === null || timestamp <= previous || timestamp - previous > 1000) return false;
    const index = this.state().index;
    const next = this.time + (timestamp - previous) / 1000;
    if (this.pauseAtChapterEnd && next >= this.chapters[index].end) {
      this.holdChapterEnd(index); return true;
    }
    this.time = Math.min(this.duration, next);
    if (this.time >= this.duration) { this.status = 'completed'; this.reason = null; this.lastTimestamp = null; }
    return true;
  }

  state() {
    let index = this.heldChapterIndex ?? this.chapters.findIndex(chapter => this.time < chapter.end);
    if (index < 0) index = this.chapters.length - 1;
    return {
      status: this.status, reason: this.reason, time: this.time, duration: this.duration,
      progress: this.time / this.duration, index, chapter: this.chapters[index], count: this.chapters.length,
      reducedMotion: this.reducedMotion, settled: this.reducedMotion, hidden: this.hidden,
    };
  }
}

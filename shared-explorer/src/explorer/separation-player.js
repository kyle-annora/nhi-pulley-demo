import { OperationPlayer } from './operation-player.js';

/** A finite, reversible separation action sampled by the existing scene clock. */
export class SeparationPlayer extends OperationPlayer {
  constructor(duration = 2.5) { super({ duration }); this.from = 0; this.to = 0; }
  start(from, to) {
    this.from = Math.max(0, Math.min(1, from)); this.to = Math.max(0, Math.min(1, to));
    if (this.from === this.to) { this.seek(1); return; }
    this.play({ once: true });
  }
  clear(value = 0) { this.pause(); this.from = this.to = value; this.time = 0; }
  seekValue(value) {
    const v = Math.max(0, Math.min(1, value));
    if (this.from === this.to || v < Math.min(this.from, this.to) || v > Math.max(this.from, this.to)) {
      const reverse = this.to < this.from;
      this.from = reverse ? 1 : 0; this.to = reverse ? 0 : 1;
    }
    const fraction = (v - this.from) / (this.to - this.from);
    this.seek(.5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, fraction))) / 3));
  }
  state() {
    const state = super.state(), t = state.progress, eased = t * t * (3 - 2 * t);
    return { ...state, available: this.from !== this.to, from: this.from, to: this.to, value: this.from + (this.to - this.from) * eased };
  }
}

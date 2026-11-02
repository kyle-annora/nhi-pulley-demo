import { abortable } from './network-load.js';
import { TourPlayer } from './tour-player.js';
import { sampleTour } from './tour-content.js';

const $ = id => document.getElementById(id);
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const write = (node, value) => { if (node.textContent !== value) node.textContent = value; };

/** DOM adapter. The clock and scene remain separate, with one renderer-owned RAF. */
export class GuidedTour {
  constructor({ scene, model, captureNavigation, restoreNavigation, syncScene, closeOverlays, syncLayout, command, stateChange }) {
    this.scene = scene; this.tour = model.tour; this.stepwise = this.tour.playback === 'steps';
    this.command = command; this.stateChange = stateChange; this.abort = new AbortController(); this.listeners = []; this.disposed = false;
    this.captureNavigation = captureNavigation; this.restoreNavigation = restoreNavigation;
    this.syncScene = syncScene; this.closeOverlays = closeOverlays; this.syncLayout = syncLayout;
    this.motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionPreference.matches;
    this.player = new TourPlayer(this.tour, { reducedMotion: this.reducedMotion });
    this.listen(this.motionPreference, 'change', event => {
      this.reducedMotion = event.matches; this.player.reducedMotion = event.matches;
      if (this.disposed || !this.active) return;
      this.pause('reduced-motion');
      if (event.matches) this.apply();
      // Returning to normal motion never starts playback without an explicit action.
    });
    this.active = false; this.pending = false; this.generation = 0; this.captionKey = ''; this.annotationKey = '';
    $('tour-duration').textContent = this.stepwise ? `${this.tour.chapters.length} short steps` : `${this.tour.duration} sec`;
    $('tour-start').disabled = false;
    this.listen($('tour-start'), 'click', () => this.dispatch('startTour', { tourId: this.tour.id }, () => this.start()));
    this.listen($('tour-exit'), 'click', () => this.dispatch('exitTour', {}, () => this.exit()));
    this.listen($('tour-chapters-toggle'), 'click', () => {
      if (!$('tour-chapters').hidden) { this.closeChapters(); return; }
      this.closeOverlays(); this.pause('chapters');
      $('tour-chapters').hidden = false; $('tour-chapters-toggle').setAttribute('aria-expanded', 'true');
      ($('tour-chapters').querySelector('[aria-current="step"]') || $('tour-chapters').firstElementChild)?.focus({ preventScroll: true });
    });
    this.listen(document, 'pointerdown', event => {
      if (!$('tour-chapters').contains(event.target) && !$('tour-chapters-toggle').contains(event.target)) this.closeChapters();
    });
    this.listen($('tour-chapters'), 'focusout', event => {
      // Safari may blur to no target on pointerdown without focusing the clicked
      // button. Keep that button mounted until its subsequent click can seek.
      const next = event.relatedTarget;
      if (next && !$('tour-chapters').contains(next) && next !== $('tour-chapters-toggle')) this.closeChapters();
    });
    this.listen($('tour-explore'), 'click', () => this.dispatch('exitTour', { restore: false }, () => this.exit({ restore: false })));
    this.listen($('tour-play'), 'click', () => {
      if (this.player.state().status === 'playing') this.dispatch('pauseTour', {}, () => this.pause('user'));
      else if (this.stepwise && (this.player.heldChapterIndex !== null || this.player.state().status === 'completed')) {
        const index = this.player.state().index;
        if (index === this.tour.chapters.length - 1) this.dispatch('exitTour', { restore: false }, () => this.exit({ restore: false }));
        else this.playChapter(index + 1);
      }
      else if (this.reducedMotion && this.stepwise && this.player.state().index === this.tour.chapters.length - 1) this.dispatch('exitTour', { restore: false }, () => this.exit({ restore: false }));
      else if (this.reducedMotion) this.requestJump('next');
      else this.dispatch('resumeTour', {}, () => this.resume());
    });
    this.listen($('tour-prev'), 'click', () => this.requestJump('previous'));
    this.listen($('tour-next'), 'click', () => this.requestJump('next'));
    this.listen($('tour-replay'), 'click', () => {
      if (this.stepwise) { this.playChapter(this.player.state().index); return; }
      if (this.command) {
        const replay = this.dispatch('seekTour', { seconds: 0 }, () => {}), intent = this.intent, generation = this.generation;
        replay.then(result => {
          if (result?.payload?.status === 'completed' && intent === this.intent && generation === this.generation && this.active && !this.disposed && !this.reducedMotion) this.dispatch('resumeTour', {}, () => {});
        }); return;
      }
      this.closeChapters(); this.closeOverlays(); this.scene.pausePresentation(); this.scene.leaveTour(); this.player.replay(); this.apply(); this.scene.invalidate(); $('tour-play').focus({ preventScroll: true });
    });
    this.listen($('tour-progress'), 'input', event => {
      const chapter = this.player.state().chapter, fraction = Number(event.target.value) / 100;
      this.requestJump('seek', this.stepwise ? chapter.start + fraction * chapter.duration : fraction * this.tour.duration, this.stepwise ? chapter.id : undefined);
    });
    $('tour-chapters').replaceChildren(...this.tour.chapters.map((chapter, index) => {
      const button = document.createElement('button'); button.type = 'button';
      const number = document.createElement('span'); number.className = 'chapter-number'; number.textContent = String(index + 1).padStart(2, '0');
      const label = document.createElement('span'); label.textContent = chapter.label || chapter.title; button.append(number, label);
      button.setAttribute('aria-label', `Chapter ${index + 1}: ${chapter.title}`);
      this.listen(button, 'click', () => { this.requestJump('chapter', index); $('tour-chapters-toggle').focus({ preventScroll: true }); });
      return button;
    }));
    this.listen(document, 'visibilitychange', () => {
      this.player.setVisibility(document.hidden);
      if (document.hidden && this.active) this.pause('visibility');
    });
  }

  listen(target, type, listener) {
    const guarded = event => { if (!this.disposed) listener(event); };
    target.addEventListener(type, guarded);
    this.listeners.push(() => target.removeEventListener(type, guarded));
  }

  dispatch(method, params, fallback) {
    if (this.disposed) return Promise.resolve(false);
    this.intent = (this.intent || 0) + 1;
    return Promise.resolve(this.command ? this.command(method, params) : fallback());
  }

  playChapter(index) {
    const request = this.requestJump('chapter', index), intent = this.intent, generation = this.generation;
    Promise.resolve(request).then(result => {
      if ((!this.command || result?.payload?.status === 'completed') && intent === this.intent && generation === this.generation && this.active && !this.disposed && !this.reducedMotion) this.dispatch('resumeTour', {}, () => this.resume());
    });
  }

  requestJump(action, seconds, chapterId) {
    if (!this.command) return this.jump(action, seconds, chapterId);
    if (action === 'seek') return this.dispatch('seekTour', { seconds, ...(chapterId ? { chapterId } : {}) }, () => {});
    const current = this.player.state().index;
    const index = action === 'chapter' ? seconds : action === 'next' ? current + 1 : Math.max(0, current - 1);
    const chapter = this.tour.chapters[index];
    return chapter ? this.dispatch('goToTourChapter', { chapterId: chapter.id }, () => {}) : this.dispatch('seekTour', { seconds: this.tour.duration }, () => {});
  }

  cancelPending() {
    ++this.generation; this.pendingAbort?.abort(); this.pendingAbort = null;
    if (this.disposed) return;
    this.pending = false; $('tour-start').disabled = false;
    write($('tour-start').querySelector('span'), 'Start guided tour');
  }

  dispose() {
    if (this.disposed) return;
    if (this.pending && !this.scene.disposed) this.scene.cancelPresentationRequest?.();
    this.cancelPending(); this.disposed = true; this.abort.abort();
    for (const remove of this.listeners.splice(0)) remove();
    if (this.active && !this.scene.disposed) { this.scene.pausePresentation(); this.scene.leaveTour(); }
    this.active = false; this.player.stop();
    document.body.classList.remove('tour-active');
    for (const key of ['tourStatus', 'tourReason', 'tourTime', 'tourPlayback']) delete document.body.dataset[key];
    $('tour-panel').hidden = true; $('tour-chapters').hidden = true;
    $('tour-chapters-toggle').setAttribute('aria-expanded', 'false');
    $('tour-annotations').replaceChildren();
    document.querySelector('.stage-tools').inert = false; document.querySelector('.detail-panel').inert = false;
    this.snapshot = this.navigation = this.frame = null;
  }

  closeChapters(restoreFocus = false) {
    if (this.disposed) return false;
    if ($('tour-chapters').hidden) return false;
    const hadFocus = $('tour-chapters').contains(document.activeElement);
    $('tour-chapters').hidden = true; $('tour-chapters-toggle').setAttribute('aria-expanded', 'false');
    if (restoreFocus || hadFocus) $('tour-chapters-toggle').focus({ preventScroll: true });
    return true;
  }

  async start({ signal } = {}) {
    if (this.disposed || this.active || this.pending || !this.scene.ready) return;
    const generation = ++this.generation;
    this.pendingAbort = new AbortController();
    this.pending = true; $('tour-start').disabled = true;
    write($('tour-start').querySelector('span'), 'Preparing tour…');
    try {
      // Load the optional linework before starting the clock, never during a chapter.
      await abortable(this.scene.prepareEdges(), this.abort.signal, this.pendingAbort.signal, signal);
      if (this.disposed || generation !== this.generation) return false;
      this.snapshot = this.scene.capturePresentation(); this.navigation = this.captureNavigation();
      this.closeOverlays(); this.scene.cancelBenchmark(); this.scene.pausePresentation();
      this.active = true; document.body.dataset.tourPlayback = this.stepwise ? 'steps' : 'continuous'; document.body.classList.add('tour-active'); $('tour-panel').hidden = false;
      document.querySelector('.stage-tools').inert = true; document.querySelector('.detail-panel').inert = true;
      this.syncLayout?.(); this.player.start(); if (this.stepwise) this.player.pause('ready'); this.apply(); this.scene.refitLayout(); this.scene.invalidate(); $('tour-play').focus({ preventScroll: true });
      return true;
    } catch (error) {
      if (this.disposed || generation !== this.generation || signal?.aborted || error?.name === 'AbortError') return false;
      console.error(error); $('status-message').textContent = 'The tour could not load. Please try again.';
      return false;
    } finally {
      if (!this.disposed && generation === this.generation) { this.pending = false; this.pendingAbort = null; $('tour-start').disabled = false; write($('tour-start').querySelector('span'), 'Start guided tour'); this.stateChange?.(); }
    }
  }

  pause(reason = 'user') {
    if (this.disposed || !this.active) return;
    this.intent = (this.intent || 0) + 1;
    this.player.pause(reason); this.scene.pausePresentation();
    if (reason === 'takeover') this.scene.leaveTour();
    this.updateUI(); this.updateAnnotations();
  }
  interact() { if (this.active) this.pause('takeover'); }
  resume() {
    if (this.disposed || !this.active) return;
    this.closeChapters(); this.closeOverlays(); this.scene.pausePresentation(); this.scene.leaveTour();
    this.player.resume(); this.apply(); this.scene.invalidate();
  }
  jump(action, seconds, chapterId) {
    if (this.disposed || !this.active) return;
    this.closeChapters(); this.closeOverlays();
    this.scene.pausePresentation(); this.scene.leaveTour();
    if (action === 'seek') this.player.seek(seconds, { chapterIndex: chapterId ? this.tour.chapters.findIndex(chapter => chapter.id === chapterId) : undefined });
    else {
      const state = this.player.state();
      const index = action === 'chapter' ? seconds : action === 'next' ? state.index + 1 : Math.max(0, state.index - 1);
      const chapter = this.tour.chapters[index];
      this.player.seek(chapter ? chapter.start + (chapter.previewAt || 0) : this.tour.duration);
    }
    this.apply(); this.scene.invalidate();
  }
  async exit({ restore = true, signal } = {}) {
    if (this.disposed) return false;
    if (!this.active) { this.cancelPending(); return false; }
    this.closeChapters(); this.closeOverlays();
    const generation = ++this.generation; this.pendingAbort?.abort(); this.pendingAbort = new AbortController(); this.pending = true; $('tour-start').disabled = true; this.active = false; this.player.stop(); this.scene.pausePresentation(); this.scene.leaveTour();
    document.body.classList.remove('tour-active'); delete document.body.dataset.tourStatus; delete document.body.dataset.tourReason; delete document.body.dataset.tourPlayback;
    $('tour-panel').hidden = true; $('tour-annotations').replaceChildren(); this.annotationKey = '';
    document.querySelector('.stage-tools').inert = false; document.querySelector('.detail-panel').inert = false;
    this.syncLayout?.();
    try {
      if (restore && this.snapshot) {
        const restored = await abortable(this.scene.restorePresentation(this.snapshot, { animate: !this.reducedMotion }), this.abort.signal, this.pendingAbort.signal, signal);
        if (this.disposed || generation !== this.generation || restored === false) return false;
        this.restoreNavigation(this.navigation);
      }
      if (this.disposed || generation !== this.generation) return false;
      this.syncScene(); this.scene.refitLayout(); $('tour-start').focus({ preventScroll: true });
      return true;
    } catch (error) {
      if (this.disposed || generation !== this.generation || signal?.aborted || error?.name === 'AbortError') return false;
      throw error;
    } finally {
      if (!this.disposed && generation === this.generation) { this.pending = false; this.pendingAbort = null; $('tour-start').disabled = false; this.stateChange?.(); }
    }
  }
  tick(timestamp) {
    if (this.disposed || !this.active || this.player.state().status !== 'playing') return false;
    this.player.tick(timestamp); this.apply();
    return this.player.state().status === 'playing';
  }
  apply() {
    if (this.disposed || !this.active) return;
    const state = this.player.state();
    this.frame = sampleTour(this.tour, state.time, { settled: state.settled || this.reducedMotion, chapterIndex: this.stepwise ? state.index : undefined });
    this.scene.applyTourFrame(this.frame, { immediate: this.reducedMotion });
    this.syncScene(); this.updateUI();
    // A caption/label-only cue need not render WebGL, but its labels must update now.
    if (JSON.stringify([innerWidth, this.frame.annotations || []]) !== this.annotationKey) this.updateAnnotations();
  }
  updateUI() {
    if (this.disposed || !this.active) return;
    const state = this.player.state(), frame = this.frame;
    if (this.stepwise) { this.updateStepUI(state, frame); return; }
    this.stateChange?.();
    const completed = state.status === 'completed';
    const moveCompletionFocus = completed && !this.completed && document.querySelector('.tour-playback').contains(document.activeElement);
    this.completed = completed;
    document.body.dataset.tourStatus = state.status; document.body.dataset.tourReason = state.reason || '';
    document.body.dataset.tourTime = state.time.toFixed(2);
    write($('tour-count'), `${String(state.index + 1).padStart(2, '0')} / ${String(this.tour.chapters.length).padStart(2, '0')}`);
    const chapterLabel = `Chapter ${state.index + 1} of ${this.tour.chapters.length}: ${frame.title.replace(/[.!?]+$/, '')}. Choose chapter`;
    if ($('tour-chapters-toggle').getAttribute('aria-label') !== chapterLabel) $('tour-chapters-toggle').setAttribute('aria-label', chapterLabel);
    write($('tour-title'), completed ? 'Now explore it yourself.' : frame.title);
    // Only content changes announce. The time slider never becomes a live region.
    write($('tour-caption'), completed ? this.tour.completion || 'Select a component. Follow its place in the assembly.' : frame.caption);
    const status = this.reducedMotion ? 'Reduced motion · Choose your next chapter.' : state.status === 'playing' ? 'Drag to pause and explore.' : state.reason === 'takeover' ? 'You have control · Continue to rejoin the tour.' : state.reason === 'visibility' ? 'Paused while away · Continue when ready.' : 'Paused · Look around, or continue.';
    write($('tour-status'), status);
    $('tour-status').hidden = completed || (state.status === 'playing' && state.time > 3);
    $('tour-annotations').hidden = state.reason === 'takeover';
    const label = state.status === 'playing' ? 'Pause' : this.reducedMotion ? 'Next chapter' : 'Continue tour';
    write($('tour-play').querySelector('span'), label);
    $('tour-play').setAttribute('aria-label', `${label}${label === 'Pause' ? ' guided tour' : ''}`);
    $('tour-play').querySelector('use').setAttribute('href', state.status === 'playing' ? '#i-pause' : '#i-play');
    $('tour-play').hidden = completed; $('tour-prev').disabled = state.index === 0;
    $('tour-next').disabled = completed;
    $('tour-progress').value = String(state.progress * 100);
    $('tour-progress').style.setProperty('--tour-progress', `${state.progress * 100}%`);
    $('tour-progress').setAttribute('aria-valuetext', `${clock(state.time)} of ${clock(state.duration)}, ${frame.title}`);
    $('tour-time').value = `${clock(state.time)} / ${clock(state.duration)}`;
    $('tour-explore').hidden = !completed; $('tour-replay').hidden = !completed;
    if (moveCompletionFocus) $('tour-explore').focus({ preventScroll: true });
    [...$('tour-chapters').children].forEach((button, index) => {
      if (index === state.index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
  }
  updateStepUI(state, frame) {
    this.stateChange?.();
    const { chapter, index } = state, local = state.time - chapter.start;
    const held = this.player.heldChapterIndex !== null || state.status === 'completed', last = index === this.tour.chapters.length - 1;
    document.body.dataset.tourStatus = state.status;
    document.body.dataset.tourReason = state.reason || '';
    document.body.dataset.tourTime = state.time.toFixed(3);
    write($('tour-count'), `${String(index + 1).padStart(2, '0')} / ${String(state.count).padStart(2, '0')}`);
    $('tour-chapters-toggle').setAttribute('aria-label', `Step ${index + 1} of ${state.count}: ${chapter.label}. Choose step`);
    write($('tour-title'), frame.title); write($('tour-caption'), frame.caption);
    const label = state.status === 'playing' ? 'Pause' : held ? last ? 'Explore freely' : 'Next step' : this.reducedMotion ? last ? 'Finish tour' : 'Next step' : local > 0 ? 'Resume' : 'Play step';
    write($('tour-play').querySelector('span'), label);
    $('tour-play').setAttribute('aria-label', label);
    $('tour-play').querySelector('use').setAttribute('href', state.status === 'playing' ? '#i-pause' : held ? '#i-arrow' : '#i-play');
    $('tour-play').hidden = false;
    $('tour-prev').disabled = index === 0; $('tour-next').disabled = last;
    const progress = 100 * local / chapter.duration;
    $('tour-progress').value = String(progress); $('tour-progress').style.setProperty('--tour-progress', `${progress}%`);
    $('tour-progress').setAttribute('aria-label', 'Current step progress');
    $('tour-progress').setAttribute('aria-valuetext', `${Math.round(progress)} percent, ${chapter.label}`);
    $('tour-time').value = `${local.toFixed(1)} / ${chapter.duration.toFixed(1)} s`;
    $('tour-explore').hidden = true; $('tour-replay').hidden = false;
    $('tour-replay').setAttribute('aria-label', `Replay step: ${chapter.label}`);
    $('tour-annotations').hidden = state.reason === 'takeover';
    write($('tour-status'), this.reducedMotion ? 'Reduced motion · Inspect each stable view.' : state.reason === 'takeover' ? 'You have control · Resume to rejoin.' : held ? 'Step complete · Replay or move on.' : 'Each action takes 2–3 seconds. Drag to inspect.');
    $('tour-status').hidden = false;
    [...$('tour-chapters').children].forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'step'); else button.removeAttribute('aria-current');
    });
  }
  updateAnnotations() {
    if (this.disposed || !this.active || !this.frame) return;
    if ($('tour-annotations').hidden) { this.annotationKey = ''; return; }
    const annotations = this.frame.annotations || [], key = JSON.stringify([innerWidth, annotations]);
    if (key !== this.annotationKey) {
      this.annotationKey = key;
      $('tour-annotations').replaceChildren(...annotations.slice(0, 2).map(annotation => {
        const label = document.createElement('span'); label.className = 'tour-annotation'; label.dataset.node = annotation.nodeId;
        if (['rotate', 'linear'].includes(annotation.motion)) {
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
          const path = document.createElementNS(svg.namespaceURI, 'path');
          // Schematic glyphs identify motion type without asserting a screen-space axis or handedness.
          path.setAttribute('d', annotation.motion === 'linear' ? 'M4 12h16M8 8l-4 4 4 4m8-8 4 4-4 4' : 'M12 4a8 8 0 0 1 8 8m-8 8a8 8 0 0 1-8-8M12 2v4m0 12v4');
          svg.append(path); label.append(svg);
        }
        const text = document.createElement('span'); text.textContent = annotation.label; label.append(text); return label;
      }));
      this.annotationSizes = [...$('tour-annotations').children].map(label => ({ width: label.offsetWidth, height: label.offsetHeight }));
    }
    const panel = $('tour-panel').getBoundingClientRect();
    const top = document.querySelector('.stage-heading').getBoundingClientRect().bottom + 8;
    const labels = [...$('tour-annotations').children];
    const points = labels.map(label => this.scene.projectTourAnchor(label.dataset.node));
    const placed = [];
    for (const [index, label] of labels.entries()) {
      const point = points[index], { width, height } = this.annotationSizes[index];
      const x = Math.max(width / 2 + 14, Math.min(innerWidth - width / 2 - 14, point.x));
      let leader = 15;
      for (const other of placed) if (Math.abs(x - other.x) < (width + other.width) / 2 + 8 && point.y - leader > other.top - 8 && point.y - leader - height < other.bottom + 8) leader = point.y - other.top + 8;
      const box = { x, width, top: point.y - leader - height, bottom: point.y - leader };
      const underPanel = x + width / 2 > panel.left && x - width / 2 < panel.right && box.bottom > panel.top - 8 && box.top < panel.bottom;
      label.hidden = !point?.visible || box.top < top || underPanel;
      if (!label.hidden) { placed.push(box); label.style.left = `${x}px`; label.style.top = `${point.y}px`; label.style.setProperty('--leader-length', `${leader}px`); }
    }
  }
}

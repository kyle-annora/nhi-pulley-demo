import { Box3, Vector3 } from 'three';

/** Exact critically damped motion: retargeting preserves position and velocity. */
export class DampedMotion {
  constructor(values, smoothTime = .14, epsilon = .0001) {
    this.values = [...values]; this.target = [...values];
    this.velocity = values.map(() => 0); this.smoothTime = smoothTime;
    this.epsilon = epsilon; this.active = false;
  }

  to(target, immediate = false) {
    this.target = [...target];
    if (immediate) { this.values = [...target]; this.velocity.fill(0); this.active = false; }
    else this.active = this.values.some((value, i) => Math.abs(value - target[i]) > this.epsilon || Math.abs(this.velocity[i]) > this.epsilon);
  }

  stop() { this.to(this.values, true); }

  step(seconds) {
    if (!this.active || seconds <= 0) return false;
    const omega = 2 / this.smoothTime, decay = Math.exp(-omega * seconds);
    let settled = true;
    for (let i = 0; i < this.values.length; i++) {
      const displacement = this.values[i] - this.target[i];
      const impulse = this.velocity[i] + omega * displacement;
      this.values[i] = this.target[i] + (displacement + impulse * seconds) * decay;
      this.velocity[i] = (this.velocity[i] - omega * impulse * seconds) * decay;
      if (Math.abs(this.values[i] - this.target[i]) > this.epsilon || Math.abs(this.velocity[i]) > this.epsilon * 10) settled = false;
    }
    if (settled) this.to(this.target, true);
    return true;
  }
}

export function nearestAngle(angle, current) {
  return current + Math.atan2(Math.sin(angle - current), Math.cos(angle - current));
}

/** Fit individual transformed bounds, rather than the empty corners of a union box. */
export function fitProjectedPoints(points, direction, fov, aspect, region, viewport, fill = .94) {
  const center = new Box3().setFromPoints(points).getCenter(new Vector3());
  const forward = direction.clone().normalize();
  const right = new Vector3().crossVectors(new Vector3(0, 1, 0), forward);
  if (right.lengthSq() < .0001) right.set(1, 0, 0); else right.normalize();
  const up = new Vector3().crossVectors(forward, right).normalize();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    const delta = point.clone().sub(center), x = delta.dot(right), y = delta.dot(up);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  center.addScaledVector(right, (minX + maxX) / 2).addScaledVector(up, (minY + maxY) / 2);
  const tangent = Math.tan(fov * Math.PI / 360);
  const halfV = tangent * region.height / viewport.height * fill;
  const halfH = tangent * aspect * region.width / viewport.width * fill;
  let distance = .75;
  for (const point of points) {
    const delta = point.clone().sub(center), depth = delta.dot(forward);
    distance = Math.max(distance, Math.abs(delta.dot(right)) / halfH + depth, Math.abs(delta.dot(up)) / halfV + depth);
  }
  return { center, distance };
}

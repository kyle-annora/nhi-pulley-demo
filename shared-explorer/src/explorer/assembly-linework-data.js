import * as THREE from 'three';

/** Start, end, adjacent face normals. Coordinates are immutable mesh-local values. */
export const CONTOUR_STRIDE = 12;
export const CONTOUR_RECORD_BYTES = 16;

export function encodeOctNormal(x, y, z) {
  const length = Math.abs(x) + Math.abs(y) + Math.abs(z);
  if (!(length > 0)) throw new Error('Cannot encode a zero normal.');
  x /= length; y /= length; z /= length;
  if (z < 0) {
    const oldX = x;
    x = (1 - Math.abs(y)) * (oldX >= 0 ? 1 : -1);
    y = (1 - Math.abs(oldX)) * (y >= 0 ? 1 : -1);
  }
  return [Math.round(x * 32767), Math.round(y * 32767)];
}

export function decodeOctNormal(x, y) {
  x /= 32767; y /= 32767;
  let z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const oldX = x;
    x = (1 - Math.abs(y)) * (oldX >= 0 ? 1 : -1);
    y = (1 - Math.abs(oldX)) * (y >= 0 ? 1 : -1);
  }
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/** Source vertex indices are lossless; only unit normals use bounded oct16 encoding. */
export function packContourSegments(source, segments) {
  const position = source.getAttribute('position'), lookup = new Map();
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i)}:${position.getY(i)}:${position.getZ(i)}`;
    if (!lookup.has(key)) lookup.set(key, i);
  }
  const count = segments.length / CONTOUR_STRIDE, bytes = new ArrayBuffer(count * CONTOUR_RECORD_BYTES);
  const indices = new Uint32Array(bytes), normals = new Int16Array(bytes);
  for (let i = 0; i < count; i++) {
    const offset = i * CONTOUR_STRIDE;
    for (let end = 0; end < 2; end++) {
      const begin = offset + end * 3, vertex = lookup.get(`${segments[begin]}:${segments[begin + 1]}:${segments[begin + 2]}`);
      if (vertex === undefined) throw new Error('Contour endpoint differs from source geometry.');
      indices[i * 4 + end] = vertex;
    }
    const first = encodeOctNormal(...segments.subarray(offset + 6, offset + 9));
    const second = encodeOctNormal(...segments.subarray(offset + 9, offset + 12));
    normals.set([...first, ...second], i * 8 + 4);
  }
  return bytes;
}

/**
 * Offline topology preparation. Same weld/normal test as the approved latch study;
 * triangle diagonals are excluded, while both smooth and sharp silhouettes remain.
 * The renderer consumes the result without rebuilding adjacency during interaction.
 */
export function buildContourSegments(source) {
  const positions = source.getAttribute('position'), index = source.index;
  if (!positions || positions.itemSize !== 3) throw new Error('Contour geometry requires positions.');
  const box = new THREE.Box3().setFromBufferAttribute(positions);
  const tolerance = Math.max(box.getSize(new THREE.Vector3()).length() * 1e-7, 1e-8);
  const vertices = new Map(), ids = new Uint32Array(positions.count), points = [];
  for (let i = 0; i < positions.count; i++) {
    const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    if (!point.every(Number.isFinite)) throw new Error('Non-finite contour position.');
    const key = point.map(value => Math.round(value / tolerance)).join(':');
    if (!vertices.has(key)) { vertices.set(key, points.length); points.push(point); }
    ids[i] = vertices.get(key);
  }
  const edges = new Map(), count = index ? index.count : positions.count;
  if (count % 3) throw new Error('Contour source must contain triangles.');
  const normal = new THREE.Vector3(), side = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map(offset => ids[index ? index.getX(i + offset) : i + offset]);
    if (triangle.some(id => id === undefined)) throw new Error('Invalid contour triangle index.');
    a.fromArray(points[triangle[0]]); b.fromArray(points[triangle[1]]); c.fromArray(points[triangle[2]]);
    normal.subVectors(b, a).cross(side.subVectors(c, a));
    if (normal.lengthSq() < 1e-20) continue;
    const faceNormal = normal.normalize().toArray();
    for (let j = 0; j < 3; j++) {
      const start = triangle[j], end = triangle[(j + 1) % 3];
      if (start === end) continue;
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      if (!edges.has(key)) edges.set(key, { start, end, normals: [] });
      edges.get(key).normals.push(faceNormal);
    }
  }
  const values = [];
  for (const edge of edges.values()) {
    const normals = edge.normals.length === 1 ? [edge.normals[0], edge.normals[0].map(value => -value)] : edge.normals;
    for (let first = 0; first < normals.length; first++) for (let second = first + 1; second < normals.length; second++) {
      const nA = normals[first], nB = normals[second];
      const dot = nA[0] * nB[0] + nA[1] * nB[1] + nA[2] * nB[2];
      if (dot > 1 - 1e-7) continue;
      values.push(...points[edge.start], ...points[edge.end], ...nA, ...nB);
    }
  }
  return new Float32Array(values);
}

export function contourRecord(buffer, record) {
  if (!(buffer instanceof ArrayBuffer) || !record || !Number.isInteger(record.byteOffset) || record.byteOffset < 0 || record.byteOffset % 4 || !Number.isInteger(record.segmentCount) || record.segmentCount < 0) throw new Error('Invalid contour buffer record.');
  const bytes = record.segmentCount * CONTOUR_RECORD_BYTES;
  if (record.byteOffset + bytes > buffer.byteLength) throw new Error('Contour record exceeds its asset.');
  return { indices: new Uint32Array(buffer, record.byteOffset, record.segmentCount * 4), normals: new Int16Array(buffer, record.byteOffset, record.segmentCount * 8), count: record.segmentCount };
}

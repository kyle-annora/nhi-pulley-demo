import { ancestors } from './model-state.js';

export function createNavigation(rootId) {
  return { scopeId: rootId, selectedId: rootId, expanded: new Set([rootId]), isolated: false };
}
export function selectNode(state, nodes, id) {
  if (!nodes.has(id)) return state;
  const path = ancestors(nodes, id).map(node => node.id);
  const expanded = new Set(path.slice(0, -1));
  if (state.expanded.has(id)) expanded.add(id);
  return { ...state, selectedId: id, expanded };
}
export function enterScope(state, nodes, id) {
  if (!nodes.has(id)) return state;
  return { scopeId: id, selectedId: id, expanded: new Set(ancestors(nodes, id).map(node => node.id)), isolated: false };
}
export function toggleBranch(state, nodes, id) {
  if (!nodes.get(id)?.children.length) return state;
  const expanded = new Set(state.expanded);
  if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
  return { ...state, expanded };
}

import { ancestors } from './model-state.js';

// Customer-facing descriptions of existing state. No geometry or camera mutation.
export function inspectionState(nodes, selectedId, scopeId) {
  const selected = nodes.get(selectedId), scope = nodes.get(scopeId);
  if (!selected || !scope) return null;
  const path = ancestors(nodes, selectedId);
  const within = path.some(node => node.id === scopeId);
  const canInspect = !within || (selected.children.length > 0 && selectedId !== scopeId);
  return {
    selected, scope, within, canInspect,
    parent: selected.parent ? nodes.get(selected.parent) : null,
    scopeParent: scope.parent ? nodes.get(scope.parent) : null,
    kind: selected.type === 'component' ? 'Part' : selected.type === 'assembly' ? 'Whole assembly' : 'Assembly',
    action: canInspect ? (selected.children.length ? 'Inspect assembly' : 'Inspect part') : 'Fit in view',
    context: !within ? 'Outside this view. Inspect to open.' : selectedId === scopeId ? 'Viewing this ' + (selected.children.length ? 'assembly.' : 'part.') : 'Selected in the current view.',
  };
}

export function inspectionFacts(state, model) {
  const facts = [];
  if (state.parent) facts.push(['Part of', state.parent.title]);
  // Only explicitly authored facts are product facts. Mesh counts are not BOM quantities.
  if (state.selected.id === model.rootId) for (const fact of model.facts || []) facts.push([fact.label, fact.value]);
  return facts;
}

/** Build a searchable index once per loaded package, never once per rendered frame. */
export function createAssemblySearch(nodes) {
  const index = [...nodes.values()].map(node => ({
    id: node.id,
    text: [node.title, node.sourceName, node.meshName].filter(Boolean).join(' ').toLocaleLowerCase(),
    path: ancestors(nodes, node.id).map(parent => parent.id),
  }));
  return (query, limit = 60) => {
    const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return null;
    const matches = index.filter(item => terms.every(term => item.text.includes(term)));
    const displayed = matches.slice(0, limit), visible = new Set(), expanded = new Set();
    for (const item of displayed) {
      item.path.forEach(id => visible.add(id));
      item.path.slice(0, -1).forEach(id => expanded.add(id));
    }
    return { visible, expanded, matches: new Set(displayed.map(item => item.id)), total: matches.length, shown: displayed.length };
  };
}

import { CLIENT_THEMES, resolveTheme } from './themes.js';

export function preferenceNamespace(project) { return `annora-explorer:${project.id}:theme:v1`; }

export function openingTheme(project, params, saved) {
  const accent = project.brand.accent.toLowerCase();
  const configured = CLIENT_THEMES.find(theme => theme.accent === accent) || resolveTheme('custom', accent);
  if (!project.features.themes) return configured;
  const requested = params.get('theme') || saved?.id;
  return requested ? resolveTheme(requested, params.get('accent') || saved?.accent) : configured;
}

/** Config is validated at build time; use DOM text/image properties, never markup. */
export function applyProjectBrand(project, document) {
  document.title = project.title;
  document.querySelector('meta[name="description"]')?.setAttribute('content', project.description);
  const link = document.querySelector('.lab-brand');
  if (!link) return;
  link.href = project.brand.homeUrl; link.setAttribute('aria-label', `${project.brand.name} ${project.brand.product} home`);
  document.getElementById('brand-name').textContent = project.brand.name;
  document.getElementById('brand-product').textContent = project.brand.product;
  if (project.brand.logoUrl) {
    const mark = link.querySelector('.brand-mark'), image = document.createElement('img');
    image.src = project.brand.logoUrl; image.alt = ''; image.width = 24; image.height = 24;
    image.style.objectFit = 'contain'; image.style.maxWidth = '100%'; image.style.maxHeight = '100%';
    mark.style.transform = 'none'; mark.replaceChildren(image);
  }
}

// Browsers without import maps (iOS Safari before 16.4) get them from the vendored es-module-shims; others skip it.
// A classic external script (not inline) so the page CSP can say script-src 'self'.
if (!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'))) {
  const s = document.createElement('script');
  s.async = true;
  s.src = 'vendor/es-module-shims.js';
  document.head.appendChild(s);
}

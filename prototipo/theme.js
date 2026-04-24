// Theme toggle simples — pro protótipo. No app real vem via next-themes.
(function () {
  const KEY = 'logifit-proto-theme';
  const root = document.documentElement;

  function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
      root.setAttribute('data-theme', theme);
    } else {
      root.removeAttribute('data-theme');
    }
  }

  function current() {
    return root.getAttribute('data-theme')
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  // Aplica o tema salvo
  const saved = localStorage.getItem(KEY);
  if (saved) apply(saved);

  window.logifitToggleTheme = function () {
    const next = current() === 'dark' ? 'light' : 'dark';
    apply(next);
    localStorage.setItem(KEY, next);
    const btn = document.querySelector('[data-theme-toggle]');
    if (btn) btn.textContent = next === 'dark' ? 'Tema claro' : 'Tema escuro';
  };

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.querySelector('[data-theme-toggle]');
    if (btn) {
      btn.textContent = current() === 'dark' ? 'Tema claro' : 'Tema escuro';
      btn.addEventListener('click', window.logifitToggleTheme);
    }
  });
})();

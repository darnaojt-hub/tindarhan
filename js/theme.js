/**
 * theme.js
 * Dark / light theme handling. The neon rebuild's flagship look lives in
 * dark mode (that's where the aurora glow, glowing borders and glowing
 * text really read as "neon"), so dark is the default for anyone who
 * hasn't chosen a theme yet -- it no longer falls back to the OS-level
 * prefers-color-scheme. A manual toggle always overrides this and is
 * remembered in localStorage. The <head> of index.html also applies the
 * saved (or default-dark) theme inline before paint to avoid a flash of
 * the wrong theme.
 */
const Theme = (() => {
  const KEY = 'tindarhan_theme';

  function apply(mode) {
    document.documentElement.setAttribute('data-theme', mode === 'light' ? 'light' : 'dark');
  }

  function init() {
    const saved = localStorage.getItem(KEY);
    apply(saved || 'dark');
    updateIcon();

    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.addEventListener('click', toggle);
  }

  function isDark() {
    const saved = localStorage.getItem(KEY);
    return saved ? saved === 'dark' : true;
  }

  function toggle() {
    const next = isDark() ? 'light' : 'dark';
    localStorage.setItem(KEY, next);
    apply(next);
    updateIcon();
  }

  function updateIcon() {
    const iconEl = document.getElementById('themeToggleIcon');
    const labelEl = document.getElementById('themeToggleLabel');
    const btn = document.getElementById('themeToggleBtn');
    const dark = isDark();
    if (iconEl) iconEl.innerHTML = dark ? Icons.sun : Icons.moon;
    if (labelEl) labelEl.textContent = dark ? 'Light Mode' : 'Dark Mode';
    if (btn) {
      const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      btn.setAttribute('aria-label', label);
      btn.setAttribute('title', label);
    }
  }

  return { init, isDark, toggle, updateIcon };
})();

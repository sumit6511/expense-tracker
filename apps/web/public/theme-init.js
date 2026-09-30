// Runs before the app loads so the page never flashes the wrong theme.
(() => {
  let theme = 'system';
  try {
    theme = localStorage.getItem('et.theme') || 'system';
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  const dark =
    theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
})();

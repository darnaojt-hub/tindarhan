/**
 * auth.js
 * Client-side login gate. This is a UI convenience (single shared shop
 * account), not real per-request security -- credentials are checked
 * against the server's bcrypt hash via DB.login(), and the session flag
 * lives in sessionStorage so each browser tab/device must log in once.
 */
const Auth = (() => {
  const SESSION_KEY = 'tindarhan_auth';

  function isAuthenticated() {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
  }

  function showApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
  }

  function showLogin() {
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    const userInput = document.getElementById('loginUsername');
    if (userInput) userInput.focus();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    const submitBtn = document.getElementById('loginSubmitBtn');

    errorEl.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in...';

    try {
      await DB.login(username, password);
      sessionStorage.setItem(SESSION_KEY, 'true');
      const cashierInput = document.getElementById('cashierName');
      if (cashierInput && !cashierInput.value) cashierInput.value = username;
      showApp();
      if (window.App && typeof window.App.onLogin === 'function') window.App.onLogin();
    } catch (err) {
      errorEl.textContent = err.message || 'Invalid username or password.';
      errorEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log In';
    }
  }

  async function handleLogout() {
    const ok = await UI.confirm('Are you sure you want to log out?', {
      title: 'Log Out', okText: 'Log Out', okClass: 'btn-danger',
    });
    if (!ok) return;
    sessionStorage.removeItem(SESSION_KEY);
    showLogin();
  }

  function init() {
    const form = document.getElementById('loginForm');
    if (form) form.addEventListener('submit', handleLogin);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

    if (isAuthenticated()) showApp(); else showLogin();
  }

  return { init, isAuthenticated, showApp, showLogin };
})();

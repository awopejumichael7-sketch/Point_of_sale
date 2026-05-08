/**
 * NexaPOS — Authentication Module
 * Handles login, session, role-based access, and logout.
 */

// ─── Default Credentials ───
const DEFAULT_USERS = [
  { username: 'admin',  password: 'admin123', role: 'admin',  name: 'Administrator' },
  { username: 'sales',  password: 'sales123', role: 'sales',  name: 'Sales Rep'     }
];

// ─── Session Helpers ───
function setSession(user) {
  localStorage.setItem('nexapos_user', JSON.stringify({
    username: user.username,
    role:     user.role,
    name:     user.name
  }));
}

function getSession() {
  try {
    const raw = localStorage.getItem('nexapos_user');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearSession() {
  localStorage.removeItem('nexapos_user');
}

// ─── Route Guard ───
function requireAuth(allowedRoles) {
  const user = getSession();
  if (!user) {
    window.location.href = 'admin.html';
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    // Redirect to appropriate dashboard
    redirectByRole(user.role);
    return null;
  }
  // Populate UI elements if present
  populateSidebarUser(user);
  applyTheme();
  return user;
}

function redirectByRole(role) {
  if (role === 'admin') {
    window.location.href = 'dashboard.html';
  } else {
    window.location.href = 'sales.html';
  }
}

function populateSidebarUser(user) {
  const nameEl = document.getElementById('sidebarUserName');
  const roleEl = document.getElementById('sidebarUserRole');
  const avatarEl = document.getElementById('sidebarAvatar');
  if (nameEl) nameEl.textContent = user.name;
  if (roleEl) roleEl.textContent = user.role === 'admin' ? 'Administrator' : 'Sales Representative';
  if (avatarEl) {
    avatarEl.innerHTML = user.role === 'admin'
      ? '<i class="fas fa-user-shield"></i>'
      : '<i class="fas fa-user-tie"></i>';
  }
  // Hide admin-only links for sales role
  if (user.role === 'sales') {
    const invLink = document.getElementById('inventoryLink');
    const rptLink = document.getElementById('reportsLink');
    // Sales can VIEW inventory read-only but not manage it; adjust as needed
  }
}

// ─── Login Handler ───
function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const alertEl = document.getElementById('loginAlert');

  if (!username || !password) {
    showLoginError('Please enter both username and password.');
    return;
  }

  const user = DEFAULT_USERS.find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    showLoginError('Invalid username or password. Please try again.');
    shakeLoginCard();
    return;
  }

  setSession(user);

  // Also try Firebase Auth if configured (optional)
  if (firebaseAvailable && auth) {
    // In production: sign in with Firebase Auth
    // auth.signInWithEmailAndPassword(email, password).catch(() => {});
  }

  // Redirect
  redirectByRole(user.role);
}

function showLoginError(msg) {
  const el = document.getElementById('loginAlert');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function shakeLoginCard() {
  const card = document.querySelector('.login-card');
  if (!card) return;
  card.style.animation = 'none';
  card.offsetHeight; // reflow
  card.style.animation = 'shake 0.4s ease';
}

// ─── Logout ───
function handleLogout() {
  clearSession();
  if (firebaseAvailable && auth) {
    auth.signOut().catch(() => {});
  }
  window.location.href = 'index.html';
}

// ─── Toggle Password ───
function togglePwd() {
  const input = document.getElementById('loginPassword');
  const icon  = document.getElementById('eyeIcon');
  if (input.type === 'password') {
    input.type = 'text';
    icon.className = 'fas fa-eye-slash';
  } else {
    input.type = 'password';
    icon.className = 'fas fa-eye';
  }
}

// ─── Theme ───
function applyTheme() {
  const saved = localStorage.getItem('nexapos_theme') || 'dark';
  document.body.setAttribute('data-theme', saved);
  updateThemeIcon(saved);
}

function toggleTheme() {
  const current = document.body.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.body.setAttribute('data-theme', next);
  localStorage.setItem('nexapos_theme', next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById('themeIcon');
  if (!icon) return;
  icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
}

// ─── Sidebar Toggle ───
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('open');
}

// ─── Toast Notification ───
function showToast(msg, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  setTimeout(() => { toast.className = 'toast'; }, duration);
}

// ─── Login Page Init ───
if (document.querySelector('.login-card')) {
  // Already logged in?
  const session = getSession();
  if (session) redirectByRole(session.role);

  applyTheme();

  // Enter key support
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleLogin();
  });
}

// ─── CSS for shake animation (injected) ───
const shakeStyle = document.createElement('style');
shakeStyle.textContent = `@keyframes shake {
  0%,100%{transform:translateX(0)}
  20%{transform:translateX(-8px)}
  40%{transform:translateX(8px)}
  60%{transform:translateX(-6px)}
  80%{transform:translateX(6px)}
}`;
document.head.appendChild(shakeStyle);

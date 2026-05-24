const App = {
  currentPage: 'dashboard',
  pages: {},

  init() {
    Storage.init();
    this._initClock();
    this._initRouter();
    this._initSidebar();
    this._initExportImport();
    this._initModal();
    window.addEventListener('hashchange', () => this._route());
    this._route();
  },

  registerPage(name, handler) {
    this.pages[name] = handler;
  },

  _initClock() {
    const update = () => {
      const now = new Date();
      document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      document.getElementById('current-time').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };
    update();
    setInterval(update, 30000);
  },

  _initRouter() {
    this._route();
  },

  _route() {
    const hash = location.hash.slice(2) || 'dashboard';
    const page = hash.split('/')[0] || 'dashboard';
    const sub = hash.split('/').slice(1).join('/');
    this.currentPage = page;
    this._setActiveNav(page);
    this._setPageTitle(page);
    const container = document.getElementById('page-content');
    container.scrollTop = 0;
    if (this.pages[page]) {
      this.pages[page].render(container, sub);
    } else {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">&#9888;</div><div class="empty-state-text">Page not found</div></div>';
    }
  },

  _setActiveNav(page) {
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.page === page);
    });
  },

  _setPageTitle(page) {
    const titles = {
      dashboard: 'Dashboard',
      tasks: 'Task CRM',
      finance: 'Finance Pulse',
      habits: 'Habit Tracker',
      nutrition: 'Nutrition',
      calendar: 'Calendar',
      brain: 'Second Brain',
      journal: 'Journal'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
  },

  _initSidebar() {
    const toggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    toggle.addEventListener('click', () => sidebar.classList.toggle('open'));
    document.querySelectorAll('.nav-link').forEach(l => {
      l.addEventListener('click', () => sidebar.classList.remove('open'));
    });
  },

  _initExportImport() {
    document.getElementById('btn-export').addEventListener('click', () => {
      Storage.exportAll();
      App.toast('Data exported', 'success');
    });
    const fileInput = document.getElementById('import-file');
    document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          Storage.importAll(ev.target.result);
          App.toast('Data imported successfully', 'success');
          this._route();
        } catch (err) {
          App.toast('Import failed: invalid file', 'error');
        }
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
  },

  _initModal() {
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeModal();
    });
  },

  openModal(title, bodyHtml) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = bodyHtml;
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(100%)';
      el.style.transition = '0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  },

  formatDate(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },

  formatCurrency(n) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  },

  getToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  escAttr(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());

/**
 * NexaPOS — Dashboard Module
 */

'use strict';

let salesChartInstance = null;
let catChartInstance   = null;

document.addEventListener('DOMContentLoaded', () => {
  const user = requireAuth(['admin']);
  if (!user) return;
  loadDashboardData();
});

async function loadDashboardData() {
  const products     = JSON.parse(localStorage.getItem('nexapos_products') || '[]');
  const transactions = JSON.parse(localStorage.getItem('nexapos_transactions') || '[]');

  // Try to pull from Firebase first
  if (firebaseAvailable && db) {
    try {
      const [pSnap, tSnap] = await Promise.all([
        db.collection('products').get(),
        db.collection('transactions').orderBy('date','desc').limit(50).get()
      ]);
      const fbProducts = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const fbTx       = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      localStorage.setItem('nexapos_products',     JSON.stringify(fbProducts));
      localStorage.setItem('nexapos_transactions', JSON.stringify(fbTx));
      renderDashboard(fbProducts, fbTx);
      return;
    } catch (err) {
      console.warn('Firebase dashboard load failed, using local:', err.message);
    }
  }

  renderDashboard(products, transactions);
}

function renderDashboard(products, transactions) {
  const now   = new Date();
  const today = now.toDateString();
  const monthYear = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

  const todayTx  = transactions.filter(t => new Date(t.date).toDateString() === today);
  const monthTx  = transactions.filter(t => t.date?.startsWith(monthYear));

  const todayRev   = todayTx.reduce((s,t) => s + (t.total||0), 0);
  const monthProfit= monthTx.reduce((s,t) => s + (t.profit||0), 0);
  const lowStock   = products.filter(p => p.quantity > 0 && p.quantity <= 5);
  const outStock   = products.filter(p => p.quantity <= 0);

  // Stats
  setText('todayRevenue', `₦${fmt(todayRev)}`);
  setText('todaySales',   todayTx.length);
  setText('totalProducts',products.length);
  setText('monthlyProfit',`₦${fmt(monthProfit)}`);
  setText('lowStockCount',`${lowStock.length} low, ${outStock.length} out`);

  // Show notif dot
  if ((lowStock.length + outStock.length) > 0) {
    const dot = document.getElementById('notifDot');
    if (dot) dot.style.display = 'block';
  }

  // Recent Transactions
  renderRecentTx(transactions.slice(0, 8));

  // Stock Alerts
  renderAlerts(lowStock, outStock);

  // Charts
  loadSalesTrend('week');
  renderCategoryChart(products);
}

function renderRecentTx(txList) {
  const tbody = document.getElementById('recentTxBody');
  if (!tbody) return;
  if (!txList.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No transactions yet</td></tr>';
    return;
  }
  tbody.innerHTML = txList.map(t => `
    <tr>
      <td><code>${t.receiptNo || '—'}</code></td>
      <td>${escHtml(t.cashier || '—')}</td>
      <td>${t.items?.length || 0}</td>
      <td><strong>₦${fmt(t.total)}</strong></td>
      <td>${new Date(t.date).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
    </tr>`).join('');
}

function renderAlerts(low, out) {
  const el = document.getElementById('stockAlerts');
  if (!el) return;

  const items = [
    ...out.map(p => `<div class="alert-item out"><span class="alert-dot"></span><span>${escHtml(p.name)} — Out of stock</span></div>`),
    ...low.map(p => `<div class="alert-item low"><span class="alert-dot"></span><span>${escHtml(p.name)} — Only ${p.quantity} left</span></div>`)
  ];

  el.innerHTML = items.length
    ? items.join('')
    : '<p class="empty-alert"><i class="fas fa-check-circle" style="color:var(--green)"></i> All stock levels are healthy</p>';
}

// ─── Sales Chart ───
function loadSalesTrend(period, btn) {
  // Update active chip
  if (btn) {
    document.querySelectorAll('.chart-filter .chip').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
  }

  const transactions = JSON.parse(localStorage.getItem('nexapos_transactions') || '[]');
  const labels = [];
  const data   = [];
  const now    = new Date();

  if (period === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toDateString();
      labels.push(d.toLocaleDateString('en', { weekday: 'short' }));
      data.push(transactions.filter(t => new Date(t.date).toDateString() === key)
        .reduce((s, t) => s + (t.total || 0), 0));
    }
  } else {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const key = d.toDateString();
      labels.push(i % 5 === 0 ? d.getDate() : '');
      data.push(transactions.filter(t => new Date(t.date).toDateString() === key)
        .reduce((s, t) => s + (t.total || 0), 0));
    }
  }

  const ctx = document.getElementById('salesChart');
  if (!ctx) return;

  if (salesChartInstance) salesChartInstance.destroy();

  const isDark = document.body.getAttribute('data-theme') !== 'light';
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const textColor = isDark ? '#8a91a8' : '#5a6080';

  salesChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Revenue (₦)',
        data,
        borderColor: '#4f8ef7',
        backgroundColor: 'rgba(79,142,247,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#4f8ef7'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 } } },
        y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 },
          callback: v => '₦' + fmt(v) } }
      }
    }
  });
}

// ─── Category Chart ───
function renderCategoryChart(products) {
  const ctx = document.getElementById('categoryChart');
  if (!ctx) return;
  if (catChartInstance) catChartInstance.destroy();

  const cats = {};
  products.forEach(p => { cats[p.category || 'Other'] = (cats[p.category || 'Other'] || 0) + 1; });
  const labels = Object.keys(cats);
  const data   = Object.values(cats);
  const colors = ['#4f8ef7','#22d3a5','#f7914f','#a97bf7','#f74f4f','#f7cf4f','#4ff7b6'];

  catChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors.slice(0, labels.length), borderWidth: 0 }] },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { position: 'bottom', labels: { color: '#8a91a8', font: { size: 11 }, padding: 12, boxWidth: 12 } } }
    }
  });
}

// ─── Utilities ───
function fmt(n) { return parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

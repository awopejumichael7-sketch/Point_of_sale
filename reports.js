
/**

 * NexaPOS — Reports Module

 */


'use strict';


let allTransactions = [];

let revenueChartInst = null;

let topProductsChartInst = null;

let deletingTxId = null;


document.addEventListener('DOMContentLoaded', () => {

  const user = requireAuth(['admin']);

  if (!user) return;

  loadReportsData();

});


async function loadReportsData() {

  try {

    if (firebaseAvailable && db) {

      const [tSnap, pSnap] = await Promise.all([

        db.collection('transactions').orderBy('date','desc').get(),

        db.collection('products').get()

      ]);

      allTransactions = tSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      localStorage.setItem('nexapos_transactions', JSON.stringify(allTransactions));

    } else {

      allTransactions = JSON.parse(localStorage.getItem('nexapos_transactions') || '[]');

    }

  } catch {

    allTransactions = JSON.parse(localStorage.getItem('nexapos_transactions') || '[]');

  }


  renderReportsSummary();

  renderTransactionTable(allTransactions);

  renderBestSellers(allTransactions);

  loadRevenueChart('daily');

  renderTopProductsChart(allTransactions);

}


// ─── Summary ───

function renderReportsSummary() {

  const now       = new Date();

  const todayStr  = now.toDateString();

  const weekAgo   = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);

  const monthYear = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;


  const dailyRev   = allTransactions.filter(t => new Date(t.date).toDateString() === todayStr).reduce((s,t) => s+(t.total||0),0);

  const weeklyRev  = allTransactions.filter(t => new Date(t.date) >= weekAgo).reduce((s,t) => s+(t.total||0),0);

  const monthlyRev = allTransactions.filter(t => t.date?.startsWith(monthYear)).reduce((s,t) => s+(t.total||0),0);

  const totalProfit= allTransactions.reduce((s,t) => s+(t.profit||0),0);


  setText('rptDailyRevenue',   `₦${fmt(dailyRev)}`);

  setText('rptWeeklyRevenue',  `₦${fmt(weeklyRev)}`);

  setText('rptMonthlyRevenue', `₦${fmt(monthlyRev)}`);

  setText('rptTotalProfit',    `₦${fmt(totalProfit)}`);

}


// ─── Revenue Chart ───

function loadRevenueChart(period, btn) {

  if (btn) {

    document.querySelectorAll('.chart-filter .chip').forEach(c => c.classList.remove('active'));

    btn.classList.add('active');

  }


  const ctx = document.getElementById('revenueChart');

  if (!ctx) return;

  if (revenueChartInst) revenueChartInst.destroy();


  const now    = new Date();

  const labels = [];

  const revenue= [];

  const profit = [];


  const isDark    = document.body.getAttribute('data-theme') !== 'light';

  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const textColor = isDark ? '#8a91a8' : '#5a6080';


  if (period === 'daily') {

    for (let i = 13; i >= 0; i--) {

      const d = new Date(now); d.setDate(d.getDate() - i);

      const key = d.toDateString();

      labels.push(d.toLocaleDateString('en', { month:'short', day:'numeric' }));

      const dayTx = allTransactions.filter(t => new Date(t.date).toDateString() === key);

      revenue.push(dayTx.reduce((s,t) => s+(t.total||0),0));

      profit.push(dayTx.reduce((s,t) => s+(t.profit||0),0));

    }

  } else if (period === 'weekly') {

    for (let i = 7; i >= 0; i--) {

      const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - i * 7);

      const weekEnd   = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);

      labels.push(`W${8-i}`);

      const wkTx = allTransactions.filter(t => { const d = new Date(t.date); return d >= weekStart && d < weekEnd; });

      revenue.push(wkTx.reduce((s,t) => s+(t.total||0),0));

      profit.push(wkTx.reduce((s,t) => s+(t.profit||0),0));

    }

  } else {

    for (let i = 5; i >= 0; i--) {

      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);

      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;

      labels.push(d.toLocaleDateString('en', { month:'short', year:'2-digit' }));

      const mTx = allTransactions.filter(t => t.date?.startsWith(key));

      revenue.push(mTx.reduce((s,t) => s+(t.total||0),0));

      profit.push(mTx.reduce((s,t) => s+(t.profit||0),0));

    }

  }


  revenueChartInst = new Chart(ctx, {

    type: 'bar',

    data: {

      labels,

      datasets: [

        { label: 'Revenue', data: revenue, backgroundColor: 'rgba(79,142,247,0.7)', borderRadius: 6 },

        { label: 'Profit',  data: profit,  backgroundColor: 'rgba(34,211,165,0.7)', borderRadius: 6 }

      ]

    },

    options: {

      responsive: true, maintainAspectRatio: true,

      plugins: { legend: { labels: { color: textColor, font: { size: 11 } } } },

      scales: {

        x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },

        y: { grid: { color: gridColor }, ticks: { color: textColor, callback: v => '₦'+fmt(v) } }

      }

    }

  });

}


// ─── Top Products Chart ───

function renderTopProductsChart(txList) {

  const ctx = document.getElementById('topProductsChart');

  if (!ctx) return;

  if (topProductsChartInst) topProductsChartInst.destroy();


  const productMap = {};

  txList.forEach(t => {

    (t.items || []).forEach(item => {

      if (!productMap[item.name]) productMap[item.name] = { qty: 0, revenue: 0 };

      productMap[item.name].qty += item.qty;

      productMap[item.name].revenue += item.total;

    });

  });


  const sorted = Object.entries(productMap).sort((a,b) => b[1].qty - a[1].qty).slice(0,6);

  const labels = sorted.map(([name]) => name.length > 12 ? name.substring(0,12)+'…' : name);

  const data   = sorted.map(([,v]) => v.qty);

  const isDark = document.body.getAttribute('data-theme') !== 'light';

  const textColor = isDark ? '#8a91a8' : '#5a6080';


  topProductsChartInst = new Chart(ctx, {

    type: 'doughnut',

    data: {

      labels,

      datasets: [{ data, backgroundColor: ['#4f8ef7','#22d3a5','#f7914f','#a97bf7','#f74f4f','#f7cf4f'], borderWidth: 0 }]

    },

    options: {

      responsive: true,

      plugins: { legend: { position: 'bottom', labels: { color: textColor, font: { size: 10 }, boxWidth: 12, padding: 10 } } }

    }

  });

}


// ─── Transaction Table ───

function renderTransactionTable(list) {

  const tbody = document.getElementById('transactionBody');

  if (!tbody) return;

  if (!list.length) {

    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">No transactions found</td></tr>';

    return;

  }

  tbody.innerHTML = list.map(t => {

    const items    = t.items || [];

    const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

    const productLabel = items.length

      ? items.map(i => `${escHtml(i.name)} ×${Number(i.qty)||0}`).join(', ')

      : '—';

    return `

    <tr>

      <td>${productLabel}</td>

      <td>${escHtml(t.customer||'Walk-in')}</td>

      <td>${escHtml(t.cashier||'—')}</td>

      <td>${totalQty}</td>

      <td>₦${fmt(t.subtotal)}</td>

      <td>₦${fmt(t.tax)}</td>

      <td>₦${fmt(t.discount)}</td>

      <td><strong>₦${fmt(t.total)}</strong></td>

      <td>${new Date(t.date).toLocaleDateString()}</td>

      <td>

        <div class="action-btns">

          <button class="action-btn edit" onclick="viewReceipt('${t.id}')" title="View Receipt"><i class="fas fa-eye"></i></button>

          <button class="action-btn delete" onclick="openDeleteTxModal('${t.id}','${escHtml(t.receiptNo||t.id)}')" title="Delete Transaction"><i class="fas fa-trash"></i></button>

        </div>

      </td>

    </tr>`;

  }).join('');

}


// ─── Best Sellers ───

function renderBestSellers(txList) {

  const tbody = document.getElementById('bestSellerBody');

  if (!tbody) return;


  const productMap = {};

  txList.forEach(t => {

    (t.items || []).forEach(item => {

      if (!productMap[item.name]) productMap[item.name] = { name: item.name, category: '—', qty: 0, revenue: 0 };

      productMap[item.name].qty += item.qty;

      productMap[item.name].revenue += item.total;

    });

  });


  const sorted = Object.values(productMap).sort((a,b) => b.qty - a.qty).slice(0, 10);


  if (!sorted.length) {

    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">No sales data yet</td></tr>';

    return;

  }


  tbody.innerHTML = sorted.map((p, i) => `

    <tr>

      <td><strong>${i+1}</strong></td>

      <td>${escHtml(p.name)}</td>

      <td>—</td>

      <td>${p.qty}</td>

      <td>₦${fmt(p.revenue)}</td>

    </tr>`).join('');

}


// ─── Filter ───

function filterTransactions() {

  const q      = (document.getElementById('txSearch')?.value || '').toLowerCase();

  const from   = document.getElementById('txDateFrom')?.value;

  const to     = document.getElementById('txDateTo')?.value;


  const filtered = allTransactions.filter(t => {

    const matchQ   = !q || t.receiptNo?.toLowerCase().includes(q) || t.customer?.toLowerCase().includes(q) || t.cashier?.toLowerCase().includes(q);

    const txDate   = new Date(t.date);

    const matchFrom= !from || txDate >= new Date(from);

    const matchTo  = !to   || txDate <= new Date(to + 'T23:59:59');

    return matchQ && matchFrom && matchTo;

  });


  renderTransactionTable(filtered);

}


// ─── View Receipt Modal ───

function viewReceipt(txId) {

  const tx = allTransactions.find(t => t.id === txId);

  if (!tx) return;


  const modal = document.getElementById('viewReceiptModal');

  const el    = document.getElementById('viewReceiptContent');

  if (!el || !modal) return;

  el.innerHTML = buildReceiptHtml(tx);

  modal.classList.add('open');

}


function buildReceiptHtml(tx) {

  const itemRows = (tx.items||[]).map(i =>

    `<div class="r-item"><span class="r-item-name">${escHtml(i.name)} ×${i.qty}</span><span>₦${fmt(i.total)}</span></div>`

  ).join('');

  return `

    <div class="r-header"><div class="r-logo">⚡ NexaPOS</div><div class="r-sub">Sales Receipt</div></div>

    <hr class="r-divider"/>

    <div class="r-info">

      <span><b>Receipt #:</b><span>${tx.receiptNo||'—'}</span></span>

      <span><b>Date:</b><span>${new Date(tx.date).toLocaleString()}</span></span>

      <span><b>Cashier:</b><span>${tx.cashier||'—'}</span></span>

      <span><b>Customer:</b><span>${tx.customer||'Walk-in'}</span></span>

    </div>

    <hr class="r-divider"/>

    <div class="r-items">${itemRows}</div>

    <hr class="r-divider"/>

    <div class="r-totals">

      <div class="r-item"><span>Subtotal</span><span>₦${fmt(tx.subtotal)}</span></div>

      ${tx.discount>0?`<div class="r-item"><span>Discount</span><span>−₦${fmt(tx.discount)}</span></div>`:''}

      <div class="r-item"><span>Tax (7.5%)</span><span>₦${fmt(tx.tax)}</span></div>

      <div class="r-item r-grand"><span><b>TOTAL</b></span><span><b>₦${fmt(tx.total)}</b></span></div>

    </div>

    <div class="r-footer"><hr class="r-divider"/><p>Thank you for your purchase!</p><p>Powered by NexaPOS</p></div>`;

}


function printViewedReceipt() { window.print(); }


// ─── Export ───

function exportSalesReport() { exportTransactionsCSV(); }


function exportTransactionsCSV() {

  const headers = ['Receipt #','Product','Customer','Cashier','Items','Subtotal','Tax','Discount','Total','Date'];

  const rows = allTransactions.map(t => {

    const items    = t.items || [];

    const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

    const products = items.map(i => i.name).join(' | ');

    return [

      t.receiptNo, products, t.customer, t.cashier, totalQty,

      t.subtotal, t.tax, t.discount, t.total, new Date(t.date).toLocaleString()

    ];

  });

  const csv = [headers,...rows].map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');

  const a = document.createElement('a');

  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));

  a.download = 'sales-report.csv';

  a.click();

  showToast('CSV exported!', 'success');

}


function exportTransactionsPDF() {

  const win = window.open('','_blank');

  const rows = allTransactions.map(t => {

    const items    = t.items || [];

    const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

    const products = escHtml(items.map(i => i.name).join(', '));

    return `

    <tr><td>${escHtml(t.receiptNo||'')}</td><td>${products}</td><td>${escHtml(t.customer||'')}</td><td>${escHtml(t.cashier||'')}</td>

    <td>${totalQty}</td><td>₦${fmt(t.total)}</td><td>${new Date(t.date).toLocaleDateString()}</td></tr>`;

  }).join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Sales Report</title>

  <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}

  th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f5f5f5}</style></head>

  <body><h1>NexaPOS — Sales Report</h1><p>Generated: ${new Date().toLocaleString()}</p>

  <table><thead><tr><th>Receipt#</th><th>Product</th><th>Customer</th><th>Cashier</th><th>Items</th><th>Total</th><th>Date</th></tr></thead>

  <tbody>${rows}</tbody></table></body></html>`);

  win.document.close(); win.print();

}


// ─── Delete Transaction ───

function openDeleteTxModal(txId, receiptNo) {

  deletingTxId = txId;

  const el = document.getElementById('deleteTxReceipt');

  if (el) el.textContent = receiptNo || txId;

  document.getElementById('deleteTxModal')?.classList.add('open');

}


function closeDeleteTxModal() {

  document.getElementById('deleteTxModal')?.classList.remove('open');

  deletingTxId = null;

}


async function confirmDeleteTransaction() {

  if (!deletingTxId) return;

  const id = deletingTxId;

  try {

    if (firebaseAvailable && db && !String(id).startsWith('local_')) {

      await db.collection('transactions').doc(id).delete();

    }

    allTransactions = allTransactions.filter(t => t.id !== id);

    localStorage.setItem('nexapos_transactions', JSON.stringify(allTransactions));

    closeDeleteTxModal();

    renderReportsSummary();

    renderTransactionTable(allTransactions);

    renderBestSellers(allTransactions);

    loadRevenueChart(document.querySelector('.chart-filter .chip.active')?.textContent.toLowerCase() || 'daily');

    renderTopProductsChart(allTransactions);

    showToast('Transaction deleted', 'success');

  } catch (err) {

    console.error('Delete transaction error:', err);

    showToast('Error deleting transaction', 'error');

  }

}


// ─── Utilities ───

function fmt(n) { return parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }


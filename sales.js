/**
 * NexaPOS — Sales / POS Module
 */

'use strict';

// ─── State ───
let posProducts = [];
let cart = [];
let currentReceipt = null;
const TAX_RATE = 0.075;

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  const user = requireAuth(['admin','sales']);
  if (!user) return;
  loadPosProducts();
});

// ─── Load Products ───
async function loadPosProducts() {
  const grid = document.getElementById('posProductGrid');
  if (grid) grid.innerHTML = '<div class="grid-loading"><div class="spinner"></div></div>';

  try {
    if (firebaseAvailable && db) {
      const snap = await db.collection('products').get();
      posProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sync to local
      localStorage.setItem('nexapos_products', JSON.stringify(posProducts));
    } else {
      posProducts = JSON.parse(localStorage.getItem('nexapos_products') || '[]');
    }
  } catch (err) {
    posProducts = JSON.parse(localStorage.getItem('nexapos_products') || '[]');
  }

  renderPosGrid(posProducts);
}

// ─── Render Product Grid ───
function renderPosGrid(products) {
  const grid = document.getElementById('posProductGrid');
  if (!grid) return;

  if (!products.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--text2);padding:40px"><i class="fas fa-box-open" style="font-size:2rem;opacity:0.3;display:block;margin-bottom:8px"></i>No products available</div>';
    return;
  }

  grid.innerHTML = products.map(p => {
    const isOut = p.quantity <= 0;
    const imgHtml = p.imageBase64
      ? `<img src="${p.imageBase64}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`
      : `<i class="fas fa-box"></i>`;

    return `<div class="product-grid-card ${isOut ? 'out' : ''}" onclick="addToCart('${p.id}')">
      ${isOut ? '<span class="out-tag">OUT</span>' : ''}
      <div class="pg-img">${imgHtml}</div>
      <h4>${escHtml(p.name)}</h4>
      <div class="pg-price">₦${fmt(p.sellingPrice)}</div>
      <div class="pg-stock">${isOut ? 'Out of stock' : `${p.quantity} left`}</div>
    </div>`;
  }).join('');
}

// ─── Filter POS Products ───
function filterPosProducts() {
  const q   = (document.getElementById('posSearch')?.value || '').toLowerCase();
  const cat = document.getElementById('posCategoryFilter')?.value || '';
  const filtered = posProducts.filter(p =>
    (!q || p.name?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q)) &&
    (!cat || p.category === cat)
  );
  renderPosGrid(filtered);
}

// ─── Cart ───
function addToCart(productId) {
  const product = posProducts.find(p => p.id === productId);
  if (!product || product.quantity <= 0) return;

  const existing = cart.find(c => c.id === productId);
  if (existing) {
    if (existing.qty >= product.quantity) {
      showToast('Not enough stock', 'warning');
      return;
    }
    existing.qty++;
  } else {
    cart.push({
      id: productId, name: product.name, price: product.sellingPrice,
      costPrice: product.costPrice, qty: 1, maxQty: product.quantity
    });
  }

  renderCart();
  recalcTotals();
}

function removeFromCart(productId) {
  cart = cart.filter(c => c.id !== productId);
  renderCart();
  recalcTotals();
}

function changeQty(productId, delta) {
  const item = cart.find(c => c.id === productId);
  if (!item) return;
  item.qty += delta;
  if (item.qty <= 0) { removeFromCart(productId); return; }
  if (item.qty > item.maxQty) { item.qty = item.maxQty; showToast('Max stock reached', 'warning'); }
  renderCart();
  recalcTotals();
}

function clearCart() {
  cart = [];
  renderCart();
  recalcTotals();
  const cashEl = document.getElementById('cashReceived');
  if (cashEl) cashEl.value = '';
  const changeEl = document.getElementById('cartChange');
  if (changeEl) changeEl.textContent = '₦0.00';
}

function renderCart() {
  const el = document.getElementById('cartItems');
  if (!el) return;

  if (!cart.length) {
    el.innerHTML = '<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Cart is empty</p></div>';
    return;
  }

  el.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <h4>${escHtml(item.name)}</h4>
        <p>₦${fmt(item.price)} × ${item.qty} = ₦${fmt(item.price * item.qty)}</p>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn" onclick="changeQty('${item.id}',-1)">−</button>
        <span class="qty-num">${item.qty}</span>
        <button class="qty-btn" onclick="changeQty('${item.id}',1)">+</button>
        <button class="cart-item-del" onclick="removeFromCart('${item.id}')"><i class="fas fa-trash"></i></button>
      </div>
    </div>`).join('');
}

function recalcTotals() {
  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);

  const discVal  = parseFloat(document.getElementById('discountVal')?.value) || 0;
  const discType = document.getElementById('discountType')?.value || 'percent';
  const discount = discType === 'percent'
    ? subtotal * (discVal / 100)
    : Math.min(discVal, subtotal);

  const taxable  = subtotal - discount;
  const tax      = taxable * TAX_RATE;
  
  setText('cartSubtotal', `₦${fmt(subtotal)}`);
  setText('cartTax',      `₦${fmt(tax)}`);
  setText('cartTotal',    `₦${fmt(total)}`);

  calcChange();
}

function calcChange() {
  const total = parseFloat(getText('cartTotal').replace(/[₦,]/g,'')) || 0;
  const cash  = parseFloat(document.getElementById('cashReceived')?.value) || 0;
  const change = cash - total;
  const changeEl = document.getElementById('cartChange');
  if (changeEl) {
    changeEl.textContent = `₦${fmt(Math.max(0, change))}`;
    changeEl.style.color = change < 0 ? 'var(--red)' : 'var(--green)';
  }
}

// ─── Checkout ───
async function processCheckout() {
  if (!cart.length) { showToast('Cart is empty', 'error'); return; }

  const total    = parseFloat(getText('cartTotal').replace(/[₦,]/g,'')) || 0;
  const subtotal = parseFloat(getText('cartSubtotal').replace(/[₦,]/g,'')) || 0;
  const tax      = parseFloat(getText('cartTax').replace(/[₦,]/g,'')) || 0;
  const cash     = parseFloat(document.getElementById('cashReceived')?.value) || 0;
  const discVal  = parseFloat(document.getElementById('discountVal')?.value) || 0;
  const discType = document.getElementById('discountType')?.value || 'percent';

  if (cash > 0 && cash < total) {
    showToast('Cash received is less than total', 'error');
    return;
  }

  const discount = discType === 'percent' ? subtotal * (discVal / 100) : Math.min(discVal, subtotal);
  const change   = cash - total;
  const user     = getSession();
  const receiptNo = 'RCP-' + Date.now().toString(36).toUpperCase();
  const profit    = cart.reduce((s, i) => s + (i.price - i.costPrice) * i.qty, 0);

  const transaction = {
    receiptNo, cashier: user?.name || 'Cashier',
    customer: document.getElementById('customerName')?.value.trim() || 'Walk-in',
    items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty, total: i.price * i.qty })),
    subtotal, discount, tax, total, cash, change: Math.max(0, change), profit,
    date: new Date().toISOString()
  };

  try {
    // Update stock
    await updateStock(cart);

    // Save transaction
    if (firebaseAvailable && db) {
      await db.collection('transactions').add(transaction);
    }
    // Always save locally
    const txList = JSON.parse(localStorage.getItem('nexapos_transactions') || '[]');
    txList.unshift({ id: 'local_' + Date.now(), ...transaction });
    localStorage.setItem('nexapos_transactions', JSON.stringify(txList));

    currentReceipt = transaction;
    showReceipt(transaction);

    clearCart();
    await loadPosProducts(); // refresh stock display
  } catch (err) {
    console.error('Checkout error:', err);
    showToast('Error processing sale: ' + err.message, 'error');
  }
}

// ─── Update Stock ───
async function updateStock(cartItems) {
  const products = JSON.parse(localStorage.getItem('nexapos_products') || '[]');

  for (const cartItem of cartItems) {
    const idx = products.findIndex(p => p.id === cartItem.id);
    if (idx > -1) {
      products[idx].quantity = Math.max(0, products[idx].quantity - cartItem.qty);
      if (firebaseAvailable && db) {
        await db.collection('products').doc(cartItem.id).update({ quantity: products[idx].quantity });
      }
    }
  }
  localStorage.setItem('nexapos_products', JSON.stringify(products));
  posProducts = products;
}

// ─── Receipt ───
function showReceipt(tx) {
  const modal = document.getElementById('receiptModal');
  const el    = document.getElementById('receiptContent');
  if (!el || !modal) return;

  el.innerHTML = buildReceiptHtml(tx);
  modal.classList.add('open');
}

function buildReceiptHtml(tx) {
  const itemRows = tx.items.map(i =>
    `<div class="r-item">
      <span class="r-item-name">${escHtml(i.name)} ×${i.qty}</span>
      <span>₦${fmt(i.total)}</span>
    </div>`
  ).join('');

  return `
    <div class="r-header">
      <div class="r-logo">⚡ NexaPOS</div>
      <div class="r-sub">Sales Receipt</div>
    </div>
    <hr class="r-divider"/>
    <div class="r-info">
      <span><b>Receipt #:</b> <span>${tx.receiptNo}</span></span>
      <span><b>Date:</b> <span>${new Date(tx.date).toLocaleString()}</span></span>
      <span><b>Cashier:</b> <span>${tx.cashier}</span></span>
      <span><b>Customer:</b> <span>${tx.customer}</span></span>
    </div>
    <hr class="r-divider"/>
    <div class="r-items">${itemRows}</div>
    <hr class="r-divider"/>
    <div class="r-totals">
      <div class="r-item"><span>Subtotal</span><span>₦${fmt(tx.subtotal)}</span></div>
      ${tx.discount > 0 ? `<div class="r-item"><span>Discount</span><span>−₦${fmt(tx.discount)}</span></div>` : ''}
      <div class="r-item"><span>Tax (7.5%)</span><span>₦${fmt(tx.tax)}</span></div>
      <div class="r-item r-grand"><span><b>TOTAL</b></span><span><b>₦${fmt(tx.total)}</b></span></div>
      ${tx.cash > 0 ? `<div class="r-item"><span>Cash</span><span>₦${fmt(tx.cash)}</span></div>` : ''}
      ${tx.cash > 0 ? `<div class="r-item"><span>Change</span><span>₦${fmt(tx.change)}</span></div>` : ''}
    </div>
    <div class="r-footer">
      <hr class="r-divider"/>
      <p>Thank you for your purchase!</p>
      <p>Powered by NexaPOS</p>
    </div>`;
}

function closeReceipt() {
  document.getElementById('receiptModal')?.classList.remove('open');
}

function printReceipt() {
  window.print();
}

// ─── Utilities ───
function fmt(n) { return parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function getText(id) { return document.getElementById(id)?.textContent || '0'; }

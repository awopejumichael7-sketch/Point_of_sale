/**
 * NexaPOS — Sales / POS Module
 */

'use strict';

// ─── State ───
let posProducts = [];
let cart = [];
let currentReceipt = null;
const TAX_RATE = 0.000;

// ─── Unit Types ───
// multiplier = how many pieces this unit represents (for stock deduction)
// priceField = key on the product object that holds this unit's selling price
const UNIT_TYPES = {
  piece:        { label: 'Piece',      multiplier: 1,    priceField: 'sellingPrice'       },
  half:         { label: 'Half (½)',   multiplier: 0.5,  priceField: 'priceHalf'          },
  threequarter: { label: '¾',          multiplier: 0.75, priceField: 'priceThreequarter'  },
  halfpack:     { label: 'Half Pack',  multiplier: 6,    priceField: 'priceHalfpack'      },
  pack:         { label: 'Pack',       multiplier: 12,   priceField: 'pricePack'          },
  dozen:        { label: 'Dozen',      multiplier: 12,   priceField: 'priceDozens'        },
};

function getUnitPrice(product, unitKey) {
  const unit = UNIT_TYPES[unitKey];
  if (!unit) return product.sellingPrice;
  const specific = parseFloat(product[unit.priceField]);
  if (specific > 0) return specific;
  return product.sellingPrice * unit.multiplier;
}

function getUnitCost(product, unitKey) {
  const mul = UNIT_TYPES[unitKey]?.multiplier || 1;
  return (product.costPrice || 0) * mul;
}

function stockUnitsUsed(qty, unitKey) {
  return qty * (UNIT_TYPES[unitKey]?.multiplier || 1);
}

function getAvailableUnits(product) {
  return Object.entries(UNIT_TYPES).filter(([key]) => {
    if (key === 'piece') return true;
    const field = UNIT_TYPES[key].priceField;
    return parseFloat(product[field]) > 0;
  });
}

// ─── Stock deduction label for display ───
function stockDeductionLabel(qty, unitKey) {
  const mul = UNIT_TYPES[unitKey]?.multiplier || 1;
  const total = qty * mul;
  if (total === Math.floor(total)) return `${total} pcs`;
  return `${total.toFixed(2)} pcs`;
}

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

    const availableUnits = getAvailableUnits(p);
    const unitOptions = availableUnits.map(([key, u]) => {
      const price = getUnitPrice(p, key);
      return `<option value="${key}">${u.label} — ₦${fmt(price)}</option>`;
    }).join('');

    const defaultPrice = getUnitPrice(p, 'piece');

    return `<div class="product-grid-card ${isOut ? 'out' : ''}">
      ${isOut ? '<span class="out-tag">OUT</span>' : ''}
      <div class="pg-img">${imgHtml}</div>
      <h4>${escHtml(p.name)}</h4>
      <div class="pg-price" id="pgprice_${p.id}">₦${fmt(defaultPrice)} / Piece</div>
      <div class="pg-stock">${isOut ? 'Out of stock' : `${p.quantity} pcs left`}</div>
      <div class="pg-unit-wrap">
        <select class="pg-unit-select" id="unit_${p.id}"
          onchange="updateCardPrice('${p.id}', this.value)" ${isOut ? 'disabled' : ''}>
          ${unitOptions}
        </select>
      </div>
      <div class="pg-add-row">
        <input type="number" class="pg-qty-input" id="qty_${p.id}"
          value="1" min="1" placeholder="Qty" ${isOut ? 'disabled' : ''}/>
        <button class="pg-add-btn"
          onclick="addToCart('${p.id}', document.getElementById('unit_${p.id}').value, parseFloat(document.getElementById('qty_${p.id}').value) || 1)"
          ${isOut ? 'disabled' : ''}>
          <i class="fas fa-cart-plus"></i> Add to Cart
        </button>
      </div>
    </div>`;
  }).join('');
}

// ─── Update displayed price when unit changes ───
function updateCardPrice(productId, unitKey) {
  const product = posProducts.find(p => p.id === productId);
  if (!product) return;
  const priceEl = document.getElementById(`pgprice_${productId}`);
  if (priceEl) {
    const price = getUnitPrice(product, unitKey);
    const label = UNIT_TYPES[unitKey]?.label || 'Piece';
    priceEl.textContent = `₦${fmt(price)} / ${label}`;
  }
}

// ─── Quick Add (Cart-side search + add) ───
let quickAddSelected = null; // the currently chosen product from dropdown

function onQuickAddSearch(query) {
  quickAddSelected = null;
  const dropdown = document.getElementById('quickAddDropdown');
  if (!dropdown) return;

  const q = query.trim().toLowerCase();
  if (!q) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }

  const matches = posProducts
    .filter(p => p.name?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q))
    .slice(0, 8);

  if (!matches.length) {
    dropdown.innerHTML = '<div class="qa-drop-empty">No products found</div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = matches.map(p => {
    const stockLabel = p.quantity <= 0
      ? '<span class="qa-out">Out</span>'
      : `<span class="qa-stock">${p.quantity} pcs</span>`;
    return `<div class="qa-drop-item" data-id="${p.id}" onclick="selectQuickProduct('${p.id}')">
      <span class="qa-drop-name">${escHtml(p.name)}</span>
      <span class="qa-drop-meta">₦${fmt(p.sellingPrice)} ${stockLabel}</span>
    </div>`;
  }).join('');
  dropdown.style.display = 'block';
}

function selectQuickProduct(productId) {
  const product = posProducts.find(p => p.id === productId);
  if (!product) return;

  quickAddSelected = product;

  const searchEl = document.getElementById('quickAddSearch');
  if (searchEl) searchEl.value = product.name;

  const dropdown = document.getElementById('quickAddDropdown');
  if (dropdown) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }

  // Populate unit selector with only the units this product supports
  const unitSel = document.getElementById('quickAddUnit');
  if (unitSel) {
    const available = getAvailableUnits(product);
    unitSel.innerHTML = available.map(([key, u]) => {
      const price = getUnitPrice(product, key);
      return `<option value="${key}">${u.label} — ₦${fmt(price)}</option>`;
    }).join('');
  }

  // Focus qty
  document.getElementById('quickAddQty')?.select();
}

function onQuickAddKey(e) {
  const dropdown = document.getElementById('quickAddDropdown');
  if (!dropdown || dropdown.style.display === 'none') return;
  const items = dropdown.querySelectorAll('.qa-drop-item');
  if (!items.length) return;

  let active = dropdown.querySelector('.qa-drop-item.active');
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!active) { items[0].classList.add('active'); }
    else {
      active.classList.remove('active');
      const next = active.nextElementSibling;
      if (next) next.classList.add('active');
      else items[0].classList.add('active');
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (!active) { items[items.length-1].classList.add('active'); }
    else {
      active.classList.remove('active');
      const prev = active.previousElementSibling;
      if (prev) prev.classList.add('active');
      else items[items.length-1].classList.add('active');
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (active) active.click();
    else if (items.length === 1) items[0].click();
  } else if (e.key === 'Escape') {
    dropdown.style.display = 'none';
  }
}

function quickAddToCart() {
  if (!quickAddSelected) {
    // Try to match by exact name if nothing was selected from dropdown
    const query = document.getElementById('quickAddSearch')?.value.trim().toLowerCase();
    if (query) {
      const match = posProducts.find(p => p.name.toLowerCase() === query);
      if (match) { selectQuickProduct(match.id); return; }
    }
    showToast('Please select a product from the list', 'warning');
    return;
  }

  const unitKey = document.getElementById('quickAddUnit')?.value || 'piece';
  const qty     = Math.max(1, parseInt(document.getElementById('quickAddQty')?.value) || 1);

  addToCart(quickAddSelected.id, unitKey, qty);

  // Reset quick-add bar
  quickAddSelected = null;
  const searchEl = document.getElementById('quickAddSearch');
  if (searchEl) searchEl.value = '';
  const qtyEl = document.getElementById('quickAddQty');
  if (qtyEl) qtyEl.value = 1;
  const unitSel = document.getElementById('quickAddUnit');
  if (unitSel) unitSel.innerHTML = '<option value="piece">Piece</option>';
}

// Close dropdown when clicking outside
document.addEventListener('click', e => {
  if (!e.target.closest('.quick-add-search-wrap')) {
    const d = document.getElementById('quickAddDropdown');
    if (d) d.style.display = 'none';
  }
});

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
function addToCart(productId, unitKey, qtyToAdd) {
  unitKey  = unitKey  || 'piece';
  qtyToAdd = Math.max(1, Math.floor(parseFloat(qtyToAdd) || 1));

  const product = posProducts.find(p => p.id === productId);
  if (!product || product.quantity <= 0) return;

  const cartKey    = `${productId}_${unitKey}`;
  const stockPerUnit = UNIT_TYPES[unitKey]?.multiplier || 1;
  const stockNeeded  = stockPerUnit * qtyToAdd;

  const currentStockUsed = cart
    .filter(c => c.id === productId)
    .reduce((s, c) => s + stockUnitsUsed(c.qty, c.unitKey), 0);

  if (currentStockUsed + stockNeeded > product.quantity) {
    showToast('Not enough stock for this quantity', 'warning');
    return;
  }

  const existing = cart.find(c => c.cartKey === cartKey);
  if (existing) {
    existing.qty += qtyToAdd;
    if (existing.qty > existing.maxQty) {
      existing.qty = existing.maxQty;
      showToast('Max stock reached', 'warning');
    }
  } else {
    const unitLabel = UNIT_TYPES[unitKey]?.label || 'Piece';
    const price     = getUnitPrice(product, unitKey);
    const costPrice = getUnitCost(product, unitKey);
    cart.push({
      cartKey, id: productId,
      name: product.name,
      unitKey, unitLabel,
      price, costPrice,
      qty: qtyToAdd,
      maxQty: Math.floor(product.quantity / stockPerUnit)
    });
  }

  // Reset the qty input on the card back to 1
  const qtyInput = document.getElementById(`qty_${productId}`);
  if (qtyInput) qtyInput.value = 1;

  renderCart();
  recalcTotals();
  showToast(`Added ${qtyToAdd} × ${UNIT_TYPES[unitKey]?.label || 'Piece'} of ${product.name}`, 'success');
}

function removeFromCart(cartKey) {
  cart = cart.filter(c => c.cartKey !== cartKey);
  renderCart();
  recalcTotals();
}

// Called by +/- buttons
function changeQty(cartKey, delta) {
  const item = cart.find(c => c.cartKey === cartKey);
  if (!item) return;
  const newQty = item.qty + delta;
  setCartItemQty(cartKey, newQty);
}

// Called when the inline qty input is changed manually
function onCartQtyInput(cartKey, inputEl) {
  const val = parseInt(inputEl.value);
  if (isNaN(val) || val < 1) { inputEl.value = 1; return; }
  setCartItemQty(cartKey, val);
}

function setCartItemQty(cartKey, newQty) {
  const item = cart.find(c => c.cartKey === cartKey);
  if (!item) return;
  if (newQty <= 0) { removeFromCart(cartKey); return; }
  if (newQty > item.maxQty) {
    newQty = item.maxQty;
    showToast('Max stock reached', 'warning');
  }
  item.qty = newQty;
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
    <div class="cart-item cart-item-selected">
      <div class="cart-item-info">
        <h4 class="cart-item-name-bold">${escHtml(item.name)} <span class="cart-unit-badge">${escHtml(item.unitLabel)}</span></h4>
        <p class="cart-item-unit-price">₦${fmt(item.price)} each</p>
        <p class="cart-item-stock-info"><i class="fas fa-boxes"></i> Deducts: ${stockDeductionLabel(item.qty, item.unitKey)} from inventory</p>
        <p class="cart-item-subtotal">= ₦${fmt(item.price * item.qty)}</p>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn" onclick="changeQty('${item.cartKey}',-1)" title="Decrease">−</button>
        <input
          type="number"
          class="cart-qty-input"
          value="${item.qty}"
          min="1"
          max="${item.maxQty}"
          onchange="onCartQtyInput('${item.cartKey}', this)"
          oninput="onCartQtyInput('${item.cartKey}', this)"
          title="Type quantity"
        />
        <button class="qty-btn" onclick="changeQty('${item.cartKey}',1)" title="Increase">+</button>
        <button class="cart-item-del" onclick="removeFromCart('${item.cartKey}')" title="Remove"><i class="fas fa-trash"></i></button>
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

  const taxable = subtotal - discount;
  const tax     = taxable * TAX_RATE;
  const total   = taxable + tax;

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

  const discount  = discType === 'percent' ? subtotal * (discVal / 100) : Math.min(discVal, subtotal);
  const change    = cash - total;
  const user      = getSession();
  const receiptNo = 'RCP-' + Date.now().toString(36).toUpperCase();
  const profit    = cart.reduce((s, i) => s + (i.price - i.costPrice) * i.qty, 0);

  const transaction = {
    receiptNo, cashier: user?.name || 'Cashier',
    customer: document.getElementById('customerName')?.value.trim() || 'Walk-in',
    items: cart.map(i => ({
      id: i.id, name: i.name,
      unitLabel: i.unitLabel, unitKey: i.unitKey,
      price: i.price, qty: i.qty,
      total: i.price * i.qty,
      stockUsed: stockUnitsUsed(i.qty, i.unitKey)
    })),
    subtotal, discount, tax, total, cash, change: Math.max(0, change), profit,
    date: new Date().toISOString()
  };

  try {
    await updateStock(cart);

    if (firebaseAvailable && db) {
      await db.collection('transactions').add(transaction);
    }
    const txList = JSON.parse(localStorage.getItem('nexapos_transactions') || '[]');
    txList.unshift({ id: 'local_' + Date.now(), ...transaction });
    localStorage.setItem('nexapos_transactions', JSON.stringify(txList));

    currentReceipt = transaction;
    showReceipt(transaction);
    clearCart();
    await loadPosProducts();
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
      const piecesUsed = stockUnitsUsed(cartItem.qty, cartItem.unitKey);
      // Round to 4 decimal places to avoid floating-point drift (important for ½ and ¾ units)
      const newQty = Math.max(0, Math.round((products[idx].quantity - piecesUsed) * 10000) / 10000);
      products[idx].quantity = newQty;
      if (firebaseAvailable && db) {
        await db.collection('products').doc(cartItem.id).update({ quantity: newQty });
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
      <span class="r-item-name">${escHtml(i.name)} (${escHtml(i.unitLabel || 'Piece')}) ×${i.qty}</span>
      <span>₦${fmt(i.total)}</span>
    </div>`
  ).join('');

  return `
    <div class="r-header">
      <div class="r-logo">⚡ Redemption building and household materials store</div>
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
      <div class="r-item"><span>Tax</span><span>₦${fmt(tx.tax)}</span></div>
      <div class="r-item r-grand"><span><b>TOTAL</b></span><span><b>₦${fmt(tx.total)}</b></span></div>
      ${tx.cash > 0 ? `<div class="r-item"><span>Cash</span><span>₦${fmt(tx.cash)}</span></div>` : ''}
      ${tx.cash > 0 ? `<div class="r-item"><span>Change</span><span>₦${fmt(tx.change)}</span></div>` : ''}
    </div>
    <div class="r-footer">
      <hr class="r-divider"/>
      <p>Thank you for your purchase!</p>
      <p>Powered by Redemption building and household materials store</p>
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

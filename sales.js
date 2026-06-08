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
// multiplier  = base stock units this represents (for inventory deduction)
// priceField  = key on the product object holding this unit's selling price
// qtyLabel    = what the "qty" number means for display (e.g. "kg", "yd", "pcs")
// fractional  = true → allow decimal quantities (0.5 kg, 1.25 yd, etc.)
const UNIT_TYPES = {
  piece:        { label: 'Piece',      multiplier: 1,    priceField: 'sellingPrice',      qtyLabel: 'pcs', fractional: false },
  half:         { label: 'Half (½)',   multiplier: 0.5,  priceField: 'priceHalf',         qtyLabel: 'pcs', fractional: false },
  threequarter: { label: '¾',          multiplier: 0.75, priceField: 'priceThreequarter', qtyLabel: 'pcs', fractional: false },
  halfpack:     { label: 'Half Pack',  multiplier: 6,    priceField: 'priceHalfpack',     qtyLabel: 'pcs', fractional: false },
  pack:         { label: 'Pack',       multiplier: 12,   priceField: 'pricePack',         qtyLabel: 'pcs', fractional: false },
  dozen:        { label: 'Dozen',      multiplier: 12,   priceField: 'priceDozens',       qtyLabel: 'pcs', fractional: false },
  kilo:         { label: 'Kilogram',   multiplier: 1,    priceField: 'priceKilo',         qtyLabel: 'kg',  fractional: true  },
  yard:         { label: 'Yard',       multiplier: 1,    priceField: 'priceYard',         qtyLabel: 'yd',  fractional: true  },
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

/**
 * stockUnitsUsed — THE CORE DEDUCTION FUNCTION
 * ----------------------------------------------
 * Returns the number of STOCK UNITS (rolls / bags / pieces) to subtract
 * from the product's `quantity` field in Firestore / localStorage.
 *
 * For YARD sales:
 *   If the product has yardsPerRoll set (e.g. 40), buying 10 yards deducts
 *   10 ÷ 40 = 0.25 rolls from stock.
 *
 * For KILO sales:
 *   If the product has kilosPerBag set (e.g. 50), buying 25 kg deducts
 *   25 ÷ 50 = 0.5 bags from stock.
 *
 * For all other units (piece, half, pack, dozen, etc.) the original
 * multiplier-based logic is kept exactly as before.
 */
function stockUnitsUsed(qty, unitKey, product) {
  if (unitKey === 'yard') {
    const yardsPerRoll = parseFloat(product?.yardsPerRoll) || 0;
    if (yardsPerRoll > 0) {
      // Convert yards sold → rolls deducted
      return qty / yardsPerRoll;
    }
    // Fallback: no yardsPerRoll configured → treat 1 yard as 1 stock unit
    // (same as old behaviour; admin should set yardsPerRoll to fix this)
    return qty * (UNIT_TYPES[unitKey]?.multiplier || 1);
  }

  if (unitKey === 'kilo') {
    const kilosPerBag = parseFloat(product?.kilosPerBag) || 0;
    if (kilosPerBag > 0) {
      // Convert kg sold → bags deducted
      return qty / kilosPerBag;
    }
    // Fallback: no kilosPerBag configured → treat 1 kg as 1 stock unit
    return qty * (UNIT_TYPES[unitKey]?.multiplier || 1);
  }

  // All other unit types: use the multiplier directly (unchanged behaviour)
  return qty * (UNIT_TYPES[unitKey]?.multiplier || 1);
}

function getAvailableUnits(product) {
  return Object.entries(UNIT_TYPES).filter(([key]) => {
    if (key === 'piece') return true;
    const field = UNIT_TYPES[key].priceField;
    return parseFloat(product[field]) > 0;
  });
}

// ─── Stock deduction label for display in cart ───
function stockDeductionLabel(qty, unitKey, product) {
  if (unitKey === 'yard') {
    const yardsPerRoll = parseFloat(product?.yardsPerRoll) || 0;
    if (yardsPerRoll > 0) {
      const rollsUsed = Math.round((qty / yardsPerRoll) * 10000) / 10000;
      return `${qty} yds (${rollsUsed} roll${rollsUsed !== 1 ? 's' : ''})`;
    }
    return `${qty} yd`;
  }
  if (unitKey === 'kilo') {
    const kilosPerBag = parseFloat(product?.kilosPerBag) || 0;
    if (kilosPerBag > 0) {
      const bagsUsed = Math.round((qty / kilosPerBag) * 10000) / 10000;
      return `${qty} kg (${bagsUsed} bag${bagsUsed !== 1 ? 's' : ''})`;
    }
    return `${qty} kg`;
  }
  const unit  = UNIT_TYPES[unitKey];
  const mul   = unit?.multiplier || 1;
  const label = unit?.qtyLabel || 'pcs';
  const total = Math.round(qty * mul * 10000) / 10000;
  return `${total} ${label}`;
}

// ─── Maximum qty a customer can buy in a given unit ───
function maxQtyForUnit(product, unitKey) {
  const isFrac = UNIT_TYPES[unitKey]?.fractional;

  if (unitKey === 'yard') {
    const yardsPerRoll = parseFloat(product.yardsPerRoll) || 0;
    if (yardsPerRoll > 0) {
      // Total yards available = rolls in stock × yards per roll
      const totalYards = product.quantity * yardsPerRoll;
      return Math.round(totalYards * 10000) / 10000;
    }
  }

  if (unitKey === 'kilo') {
    const kilosPerBag = parseFloat(product.kilosPerBag) || 0;
    if (kilosPerBag > 0) {
      // Total kg available = bags in stock × kg per bag
      const totalKg = product.quantity * kilosPerBag;
      return Math.round(totalKg * 10000) / 10000;
    }
  }

  // Default: for fractional units use raw qty, for others floor it
  const mul = UNIT_TYPES[unitKey]?.multiplier || 1;
  return isFrac
    ? Math.round((product.quantity / mul) * 10000) / 10000
    : Math.floor(product.quantity / mul);
}

// ─── Minimum qty step for a unit (fractional = 0.01, else 1) ───
function unitStep(unitKey) {
  return UNIT_TYPES[unitKey]?.fractional ? '0.01' : '1';
}
function unitMin(unitKey) {
  return UNIT_TYPES[unitKey]?.fractional ? '0.01' : '1';
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
    const isOut    = p.quantity <= 0;
    const imgHtml  = p.imageBase64
      ? `<img src="${p.imageBase64}" alt="" style="width:100%;height:100%;object-fit:cover;"/>`
      : `<i class="fas fa-box"></i>`;

    const availableUnits = getAvailableUnits(p);
    const unitOptions    = availableUnits.map(([key, u]) => {
      const price = getUnitPrice(p, key);
      return `<option value="${key}">${u.label} — ₦${fmt(price)}</option>`;
    }).join('');

    const defaultPrice = getUnitPrice(p, 'piece');
    const firstUnitKey = availableUnits[0]?.[0] || 'piece';

    // Show available stock in meaningful units so cashiers know what's left
    const stockLabel = buildStockLabel(p, firstUnitKey);

    return `<div class="product-grid-card ${isOut ? 'out' : ''}">
      ${isOut ? '<span class="out-tag">OUT</span>' : ''}
      <div class="pg-img">${imgHtml}</div>
      <h4>${escHtml(p.name)}</h4>
      <div class="pg-price" id="pgprice_${p.id}">₦${fmt(defaultPrice)} / Piece</div>
      <div class="pg-stock" id="pgstock_${p.id}">${stockLabel}</div>
      <div class="pg-unit-wrap">
        <select class="pg-unit-select" id="unit_${p.id}"
          onchange="updateCardPrice('${p.id}', this.value)" ${isOut ? 'disabled' : ''}>
          ${unitOptions}
        </select>
      </div>
      <div class="pg-add-row">
        <input type="number" class="pg-qty-input" id="qty_${p.id}"
          value="1" min="0.01" step="1" placeholder="Qty" ${isOut ? 'disabled' : ''}/>
        <button class="pg-add-btn"
          onclick="addToCart('${p.id}', document.getElementById('unit_${p.id}').value, parseFloat(document.getElementById('qty_${p.id}').value) || 1)"
          ${isOut ? 'disabled' : ''}>
          <i class="fas fa-cart-plus"></i> Add
        </button>
      </div>
    </div>`;
  }).join('');
}

// Build a human-readable stock availability string for a given unit
function buildStockLabel(product, unitKey) {
  if (product.quantity <= 0) return 'Out of stock';

  if (unitKey === 'yard') {
    const yardsPerRoll = parseFloat(product.yardsPerRoll) || 0;
    if (yardsPerRoll > 0) {
      const totalYards = Math.round(product.quantity * yardsPerRoll * 10) / 10;
      return `${product.quantity} rolls · ${totalYards} yds left`;
    }
  }

  if (unitKey === 'kilo') {
    const kilosPerBag = parseFloat(product.kilosPerBag) || 0;
    if (kilosPerBag > 0) {
      const totalKg = Math.round(product.quantity * kilosPerBag * 10) / 10;
      return `${product.quantity} bags · ${totalKg} kg left`;
    }
  }

  const isFrac = UNIT_TYPES[unitKey]?.fractional;
  return `${product.quantity} ${isFrac ? UNIT_TYPES[unitKey].qtyLabel : 'pcs'} left`;
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

  // Update qty input step/min for fractional units
  const qtyInput = document.getElementById(`qty_${productId}`);
  if (qtyInput) {
    const isFrac = UNIT_TYPES[unitKey]?.fractional;
    qtyInput.step  = isFrac ? '0.01' : '1';
    qtyInput.min   = isFrac ? '0.01' : '1';
    qtyInput.value = isFrac ? '0.5'  : '1';
    qtyInput.placeholder = isFrac ? '0.00' : 'Qty';
  }

  // Update stock label with correct unit context
  const stockEl = document.getElementById(`pgstock_${productId}`);
  if (stockEl) stockEl.textContent = buildStockLabel(product, unitKey);
}

// ─── Quick Add (Cart-side search + add) ───
let quickAddSelected = null;

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

  const unitSel = document.getElementById('quickAddUnit');
  if (unitSel) {
    const available = getAvailableUnits(product);
    unitSel.innerHTML = available.map(([key, u]) => {
      const price = getUnitPrice(product, key);
      return `<option value="${key}">${u.label} — ₦${fmt(price)}</option>`;
    }).join('');
  }

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

  quickAddSelected = null;
  const searchEl = document.getElementById('quickAddSearch');
  if (searchEl) searchEl.value = '';
  const qtyEl = document.getElementById('quickAddQty');
  if (qtyEl) qtyEl.value = 1;
  const unitSel = document.getElementById('quickAddUnit');
  if (unitSel) unitSel.innerHTML = '<option value="piece">Piece</option>';
}

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
  unitKey  = unitKey || 'piece';
  const isFrac = UNIT_TYPES[unitKey]?.fractional;
  qtyToAdd = isFrac
    ? Math.round((parseFloat(qtyToAdd) || 0.01) * 10000) / 10000
    : Math.max(1, Math.floor(parseFloat(qtyToAdd) || 1));
  if (qtyToAdd <= 0) { showToast('Quantity must be greater than 0', 'warning'); return; }

  const product = posProducts.find(p => p.id === productId);
  if (!product || product.quantity <= 0) return;

  const cartKey     = `${productId}_${unitKey}`;
  // stockNeeded = how many stock units (rolls/bags/pieces) this sale will consume
  const stockNeeded = Math.round(stockUnitsUsed(qtyToAdd, unitKey, product) * 10000) / 10000;

  // Sum all stock already committed to this product across all unit types in cart
  const currentStockUsed = cart
    .filter(c => c.id === productId)
    .reduce((s, c) => {
      const p = posProducts.find(x => x.id === c.id);
      return s + stockUnitsUsed(c.qty, c.unitKey, p);
    }, 0);

  if (Math.round((currentStockUsed + stockNeeded) * 10000) / 10000 > product.quantity) {
    showToast('Not enough stock for this quantity', 'warning');
    return;
  }

  const existing = cart.find(c => c.cartKey === cartKey);
  if (existing) {
    const newQty = Math.round((existing.qty + qtyToAdd) * 10000) / 10000;
    existing.qty = Math.min(newQty, existing.maxQty);
    if (newQty > existing.maxQty) showToast('Max stock reached', 'warning');
  } else {
    const unitLabel = UNIT_TYPES[unitKey]?.label || 'Piece';
    const price     = getUnitPrice(product, unitKey);
    const costPrice = getUnitCost(product, unitKey);
    // maxQty: the most the customer can buy of this unit given current stock
    const maxQ = maxQtyForUnit(product, unitKey);
    cart.push({
      cartKey, id: productId,
      name: product.name,
      unitKey, unitLabel,
      price, costPrice,
      qty: qtyToAdd,
      maxQty: maxQ,
      fractional: isFrac,
      // Store the product snapshot so deduction logic has yardsPerRoll / kilosPerBag
      yardsPerRoll: product.yardsPerRoll || 0,
      kilosPerBag:  product.kilosPerBag  || 0,
    });
  }

  // Reset the qty input on the card
  const qtyInput = document.getElementById(`qty_${productId}`);
  if (qtyInput) qtyInput.value = isFrac ? '0.5' : '1';

  renderCart();
  recalcTotals();
  showToast(`Added ${qtyToAdd} × ${UNIT_TYPES[unitKey]?.label || 'Piece'} of ${product.name}`, 'success');
}

function removeFromCart(cartKey) {
  cart = cart.filter(c => c.cartKey !== cartKey);
  renderCart();
  recalcTotals();
}

function changeQty(cartKey, delta) {
  const item = cart.find(c => c.cartKey === cartKey);
  if (!item) return;
  setCartItemQty(cartKey, item.qty + delta);
}

function onCartQtyInput(cartKey, inputEl) {
  const item   = cart.find(c => c.cartKey === cartKey);
  const isFrac = item?.fractional;
  const val    = isFrac ? parseFloat(inputEl.value) : parseInt(inputEl.value);
  const min    = isFrac ? 0.01 : 1;
  if (isNaN(val) || val < min) { inputEl.value = min; return; }
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
  item.qty = Math.round(newQty * 10000) / 10000;
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
  closeCartDrawer();
  updateCartFab();
}

function renderCart() {
  const el = document.getElementById('cartItems');
  if (!el) return;

  if (!cart.length) {
    el.innerHTML = '<div class="cart-empty"><i class="fas fa-shopping-basket"></i><p>Cart is empty</p></div>';
    return;
  }

  el.innerHTML = cart.map(item => {
    // Pass the product snapshot stored on the cart item for the deduction label
    const productSnap = { yardsPerRoll: item.yardsPerRoll, kilosPerBag: item.kilosPerBag };
    const deductLabel = stockDeductionLabel(item.qty, item.unitKey, productSnap);
    return `
    <div class="cart-item cart-item-selected">
      <div class="cart-item-info">
        <h4 class="cart-item-name-bold">${escHtml(item.name)} <span class="cart-unit-badge">${escHtml(item.unitLabel)}</span></h4>
        <p class="cart-item-unit-price">₦${fmt(item.price)} / ${escHtml(item.unitLabel)}</p>
        <p class="cart-item-stock-info"><i class="fas fa-boxes"></i> Deducts: ${deductLabel} from inventory</p>
        <p class="cart-item-subtotal">= ₦${fmt(item.price * item.qty)}</p>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn" onclick="changeQty('${item.cartKey}',${item.fractional ? -0.5 : -1})" title="Decrease">−</button>
        <input
          type="number"
          class="cart-qty-input${item.fractional ? ' frac-input' : ''}"
          value="${item.qty}"
          min="${item.fractional ? '0.01' : '1'}"
          max="${item.maxQty}"
          step="${item.fractional ? '0.01' : '1'}"
          onchange="onCartQtyInput('${item.cartKey}', this)"
          oninput="onCartQtyInput('${item.cartKey}', this)"
          title="Type quantity (${item.fractional ? 'decimals allowed' : 'whole numbers'})"
        />
        <button class="qty-btn" onclick="changeQty('${item.cartKey}',${item.fractional ? 0.5 : 1})" title="Increase">+</button>
        <button class="cart-item-del" onclick="removeFromCart('${item.cartKey}')" title="Remove"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
  updateCartFab();
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
  const total  = parseFloat(getText('cartTotal').replace(/[₦,]/g,'')) || 0;
  const cash   = parseFloat(document.getElementById('cashReceived')?.value) || 0;
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

  const total    = parseFloat(getText('cartTotal').replace(/[₦,]/g,''))    || 0;
  const subtotal = parseFloat(getText('cartSubtotal').replace(/[₦,]/g,'')) || 0;
  const tax      = parseFloat(getText('cartTax').replace(/[₦,]/g,''))      || 0;
  const cash     = parseFloat(document.getElementById('cashReceived')?.value) || 0;
  const discVal  = parseFloat(document.getElementById('discountVal')?.value)  || 0;
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
    items: cart.map(i => {
      const productSnap = { yardsPerRoll: i.yardsPerRoll, kilosPerBag: i.kilosPerBag };
      return {
        id: i.id, name: i.name,
        unitLabel: i.unitLabel, unitKey: i.unitKey,
        price: i.price, qty: i.qty,
        total: i.price * i.qty,
        stockUsed: stockUnitsUsed(i.qty, i.unitKey, productSnap)
      };
    }),
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
      const product = products[idx];

      // Use the product's own yardsPerRoll / kilosPerBag for correct deduction
      const piecesUsed = stockUnitsUsed(cartItem.qty, cartItem.unitKey, product);

      // Round to 4 decimal places to avoid floating-point drift
      const newQty = Math.max(0, Math.round((product.quantity - piecesUsed) * 10000) / 10000);
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

// ─── Mobile Cart Drawer ───
let cartDrawerOpen = false;

function toggleCartDrawer() {
  cartDrawerOpen = !cartDrawerOpen;
  const cartEl   = document.querySelector('.pos-cart');
  const backdrop = document.getElementById('cartBackdrop');
  const fabIcon  = document.querySelector('.cart-fab i');
  if (!cartEl) return;
  cartEl.classList.toggle('cart-open', cartDrawerOpen);
  if (backdrop) backdrop.classList.toggle('visible', cartDrawerOpen);
  if (fabIcon)  fabIcon.className = cartDrawerOpen ? 'fas fa-times' : 'fas fa-shopping-cart';
  document.body.style.overflow = cartDrawerOpen ? 'hidden' : '';
}

function closeCartDrawer() {
  if (!cartDrawerOpen) return;
  cartDrawerOpen = false;
  const cartEl   = document.querySelector('.pos-cart');
  const backdrop = document.getElementById('cartBackdrop');
  const fabIcon  = document.querySelector('.cart-fab i');
  if (cartEl)   cartEl.classList.remove('cart-open');
  if (backdrop) backdrop.classList.remove('visible');
  if (fabIcon)  fabIcon.className = 'fas fa-shopping-cart';
  document.body.style.overflow = '';
}

function updateCartFab() {
  const badge = document.getElementById('cartFabBadge');
  if (!badge) return;
  const count   = cart.reduce((s, i) => s + i.qty, 0);
  const rounded = Math.round(count * 100) / 100;
  if (rounded > 0) {
    badge.textContent = rounded > 99 ? '99+' : rounded;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ─── Swipe-to-close cart drawer on mobile ───
(function initSwipeCart() {
  let startY = 0;
  document.addEventListener('touchstart', e => {
    const cart = document.querySelector('.pos-cart');
    if (cart && cart.classList.contains('cart-open')) {
      startY = e.touches[0].clientY;
    }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    const cart = document.querySelector('.pos-cart');
    if (cart && cart.classList.contains('cart-open')) {
      const dy = e.changedTouches[0].clientY - startY;
      if (dy > 80) closeCartDrawer();
    }
  }, { passive: true });
})();

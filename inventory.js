/**
 * NexaPOS — Inventory Module
 * Full CRUD for products with Firebase + LocalStorage fallback.
 */

'use strict';

// ─── State ───
let allProducts = [];
let editingId   = null;
let deletingId  = null;
let pendingImageBase64 = null;

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  const user = requireAuth(['admin']);
  if (!user) return;
  loadProducts();
});

// ─── LocalStorage Helpers ───
function getLocalProducts() {
  try { return JSON.parse(localStorage.getItem('nexapos_products') || '[]'); }
  catch { return []; }
}
function setLocalProducts(products) {
  localStorage.setItem('nexapos_products', JSON.stringify(products));
}

// ─── Load Products ───
async function loadProducts() {
  showSpinner(true);
  try {
    if (firebaseAvailable && db) {
      const snap = await db.collection('products').orderBy('dateAdded','desc').get();
      allProducts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setLocalProducts(allProducts);
    } else {
      allProducts = getLocalProducts();
    }
  } catch (err) {
    console.error('Load products error:', err);
    allProducts = getLocalProducts();
    showToast('Using offline data', 'warning');
  }
  showSpinner(false);
  renderProducts(allProducts);
}

// ─── Render ───
function renderProducts(products) {
  const tbody   = document.getElementById('productBody');
  const countEl = document.getElementById('productCount');
  if (!tbody) return;
  if (countEl) countEl.textContent = products.length;

  if (!products.length) {
    tbody.innerHTML = `<tr><td colspan="19" class="empty-row"><i class="fas fa-box-open"></i> No products found</td></tr>`;
    return;
  }

  tbody.innerHTML = products.map(p => {
    const stockStatus = p.quantity <= 0
      ? `<span class="badge badge-red">Out</span>`
      : p.quantity <= 5
        ? `<span class="badge badge-orange">Low (${p.quantity})</span>`
        : `<span class="badge badge-green">In Stock (${p.quantity})</span>`;

    const imgHtml = p.imageBase64
      ? `<img src="${p.imageBase64}" style="width:40px;height:40px;border-radius:8px;object-fit:cover;" alt=""/>`
      : `<div class="product-thumb-placeholder"><i class="fas fa-image"></i></div>`;

    const dash = '—';

    // Derive total yards / total kg available so stock is intuitive at a glance
    const yardInfo = (p.yardsPerRoll > 0)
      ? `<small style="display:block;color:var(--text2)">${p.yardsPerRoll} yds/roll<br>≈ ${Math.round(p.quantity * p.yardsPerRoll * 10) / 10} yds total</small>`
      : dash;
    const kiloInfo = (p.kilosPerBag > 0)
      ? `<small style="display:block;color:var(--text2)">${p.kilosPerBag} kg/bag<br>≈ ${Math.round(p.quantity * p.kilosPerBag * 10) / 10} kg total</small>`
      : dash;

    return `<tr>
      <td>${imgHtml}</td>
      <td><strong>${escHtml(p.name)}</strong></td>
      <td><small>${escHtml(p.productId||'')} / ${escHtml(p.barcode||'—')}</small></td>
      <td>${escHtml(p.category||'—')}</td>
      <td>${p.quantity}</td>
      <td>₦${fmt(p.costPrice)}</td>
      <td>₦${fmt(p.sellingPrice)}</td>
      <td>${p.priceHalf         > 0 ? '₦'+fmt(p.priceHalf)         : dash}</td>
      <td>${p.priceThreequarter > 0 ? '₦'+fmt(p.priceThreequarter) : dash}</td>
      <td>${p.priceHalfpack     > 0 ? '₦'+fmt(p.priceHalfpack)     : dash}</td>
      <td>${p.priceDozens       > 0 ? '₦'+fmt(p.priceDozens)       : dash}</td>
      <td>${p.pricePack         > 0 ? '₦'+fmt(p.pricePack)         : dash}</td>
      <td>${p.priceKilo         > 0 ? '₦'+fmt(p.priceKilo)         : dash}</td>
      <td>${yardInfo}</td>
      <td>${p.priceYard         > 0 ? '₦'+fmt(p.priceYard)         : dash}</td>
      <td>${kiloInfo}</td>
      <td>${escHtml(p.supplier||'—')}</td>
      <td>${stockStatus}</td>
      <td>
        <div class="action-btns">
          <button class="action-btn edit"   onclick="openProductModal('${p.id}')"                        title="Edit"><i class="fas fa-edit"></i></button>
          <button class="action-btn delete" onclick="openDeleteModal('${p.id}','${escHtml(p.name)}')"  title="Delete"><i class="fas fa-trash"></i></button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ─── Filter ───
function filterProducts() {
  const q   = (document.getElementById('searchInput')?.value || '').toLowerCase();
  const cat = document.getElementById('categoryFilter')?.value || '';
  const stk = document.getElementById('stockFilter')?.value || '';

  const list = allProducts.filter(p => {
    const matchQ   = !q   || p.name?.toLowerCase().includes(q) || p.productId?.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q) || p.supplier?.toLowerCase().includes(q);
    const matchCat = !cat || p.category === cat;
    const matchStk = !stk ||
      (stk === 'out' && p.quantity <= 0) ||
      (stk === 'low' && p.quantity > 0 && p.quantity <= 5) ||
      (stk === 'ok'  && p.quantity > 5);
    return matchQ && matchCat && matchStk;
  });

  renderProducts(list);
}

// ─── Modal ───
function openProductModal(productId = null) {
  editingId = productId;
  pendingImageBase64 = null;

  const modal = document.getElementById('productModal');
  const title = document.getElementById('modalTitle');

  // Reset all fields
  [
    'pName','pCategory','pID','pBarcode','pQty','pCost','pPrice',
    'pPriceHalf','pPriceThreequarter','pPriceHalfpack','pPriceDozens',
    'pPricePack','pPriceKilo','pPriceYard',
    'pYardsPerRoll','pKilosPerBag',   // ← NEW fields
    'pSupplier'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const preview     = document.getElementById('imagePreview');
  const placeholder = document.getElementById('uploadPlaceholder');
  if (preview)     { preview.style.display = 'none'; preview.src = ''; }
  if (placeholder)   placeholder.style.display = 'flex';

  if (productId) {
    title.textContent = 'Edit Product';
    const p = allProducts.find(x => x.id === productId);
    if (!p) return;
    setValue('pName',             p.name);
    setValue('pCategory',         p.category);
    setValue('pID',               p.productId);
    setValue('pBarcode',          p.barcode);
    setValue('pQty',              p.quantity);
    setValue('pCost',             p.costPrice);
    setValue('pPrice',            p.sellingPrice);
    setValue('pPriceHalf',        p.priceHalf        || '');
    setValue('pPriceThreequarter',p.priceThreequarter|| '');
    setValue('pPriceHalfpack',    p.priceHalfpack    || '');
    setValue('pPriceDozens',      p.priceDozens      || '');
    setValue('pPricePack',        p.pricePack        || '');
    setValue('pPriceKilo',        p.priceKilo        || '');
    setValue('pPriceYard',        p.priceYard        || '');
    setValue('pYardsPerRoll',     p.yardsPerRoll     || '');  // ← NEW
    setValue('pKilosPerBag',      p.kilosPerBag      || '');  // ← NEW
    setValue('pSupplier',         p.supplier);
    if (p.imageBase64 && preview && placeholder) {
      preview.src = p.imageBase64;
      preview.style.display = 'block';
      placeholder.style.display = 'none';
    }
    pendingImageBase64 = p.imageBase64 || null;
  } else {
    title.textContent = 'Add Product';
    setValue('pID', generateId());
  }

  modal.classList.add('open');
}

function closeProductModal() {
  document.getElementById('productModal')?.classList.remove('open');
  editingId = null;
  pendingImageBase64 = null;
}

// ─── Save Product ───
async function saveProduct() {
  const name    = document.getElementById('pName')?.value.trim();
  const cat     = document.getElementById('pCategory')?.value;
  const pid     = document.getElementById('pID')?.value.trim();
  const barcode = document.getElementById('pBarcode')?.value.trim();
  const qty     = parseFloat(document.getElementById('pQty')?.value)  || 0;
  const cost    = parseFloat(document.getElementById('pCost')?.value)  || 0;
  const price   = parseFloat(document.getElementById('pPrice')?.value) || 0;

  const priceHalf         = parseFloat(document.getElementById('pPriceHalf')?.value)         || 0;
  const priceThreequarter = parseFloat(document.getElementById('pPriceThreequarter')?.value)  || 0;
  const priceHalfpack     = parseFloat(document.getElementById('pPriceHalfpack')?.value)      || 0;
  const priceDozens       = parseFloat(document.getElementById('pPriceDozens')?.value)        || 0;
  const pricePack         = parseFloat(document.getElementById('pPricePack')?.value)          || 0;
  const priceKilo         = parseFloat(document.getElementById('pPriceKilo')?.value)          || 0;
  const priceYard         = parseFloat(document.getElementById('pPriceYard')?.value)          || 0;

  // ── NEW: bundle-size fields ──────────────────────────────────────────────
  // yardsPerRoll: how many yards are in one roll (e.g. 40 for a 40-yard roll)
  // kilosPerBag : how many kg are in one bag/sack (e.g. 50 for a 50 kg bag)
  const yardsPerRoll = parseFloat(document.getElementById('pYardsPerRoll')?.value) || 0;
  const kilosPerBag  = parseFloat(document.getElementById('pKilosPerBag')?.value)  || 0;
  // ────────────────────────────────────────────────────────────────────────

  const supplier = document.getElementById('pSupplier')?.value.trim();

  if (!name)  { showToast('Product name is required', 'error'); return; }
  if (!cat)   { showToast('Category is required', 'error'); return; }
  if (price < 0 || cost < 0) { showToast('Prices cannot be negative', 'error'); return; }

  const data = {
    name, category: cat, productId: pid || generateId(), barcode, quantity: qty,
    costPrice: cost, sellingPrice: price,
    priceHalf, priceThreequarter, priceHalfpack, priceDozens, pricePack, priceKilo, priceYard,
    yardsPerRoll,   // ← NEW
    kilosPerBag,    // ← NEW
    supplier,
    imageBase64: pendingImageBase64 || null,
    dateAdded: editingId
      ? (allProducts.find(x => x.id === editingId)?.dateAdded || new Date().toISOString())
      : new Date().toISOString()
  };

  showSpinner(true);
  try {
    if (firebaseAvailable && db) {
      if (editingId) {
        await db.collection('products').doc(editingId).update(data);
        const idx = allProducts.findIndex(x => x.id === editingId);
        if (idx > -1) allProducts[idx] = { id: editingId, ...data };
      } else {
        const ref = await db.collection('products').add(data);
        allProducts.unshift({ id: ref.id, ...data });
      }
    } else {
      if (editingId) {
        const idx = allProducts.findIndex(x => x.id === editingId);
        if (idx > -1) allProducts[idx] = { id: editingId, ...data };
      } else {
        const newId = 'local_' + Date.now();
        allProducts.unshift({ id: newId, ...data });
      }
      setLocalProducts(allProducts);
    }
    closeProductModal();
    renderProducts(allProducts);
    showToast(editingId ? 'Product updated!' : 'Product added!', 'success');
  } catch (err) {
    console.error('Save product error:', err);
    showToast('Error saving product: ' + err.message, 'error');
  }
  showSpinner(false);
}

// ─── Delete ───
function openDeleteModal(productId, productName) {
  deletingId = productId;
  const nameEl = document.getElementById('deleteProductName');
  if (nameEl) nameEl.textContent = productName;
  document.getElementById('deleteModal')?.classList.add('open');
}
function closeDeleteModal() {
  document.getElementById('deleteModal')?.classList.remove('open');
  deletingId = null;
}
async function confirmDelete() {
  if (!deletingId) return;
  showSpinner(true);
  try {
    if (firebaseAvailable && db) {
      await db.collection('products').doc(deletingId).delete();
    }
    allProducts = allProducts.filter(x => x.id !== deletingId);
    setLocalProducts(allProducts);
    closeDeleteModal();
    renderProducts(allProducts);
    showToast('Product deleted', 'success');
  } catch (err) {
    console.error('Delete error:', err);
    showToast('Error deleting product', 'error');
  }
  showSpinner(false);
}

// ─── Image Preview ───
function previewImage(event) {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image too large (max 2MB)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    pendingImageBase64 = e.target.result;
    const preview     = document.getElementById('imagePreview');
    const placeholder = document.getElementById('uploadPlaceholder');
    if (preview)     { preview.src = pendingImageBase64; preview.style.display = 'block'; }
    if (placeholder)   placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

// ─── Export CSV ───
function exportCSV() {
  const headers = [
    'Name','Product ID','Barcode','Category','Quantity',
    'Cost Price','Price (Piece)','Price (½)','Price (3/4)','Price (Half Pack)',
    'Price (Dozen)','Price (Pack)','Price (Kilo/kg)',
    'Yards per Roll','Price (Yard/yd)','Kg per Bag',  // ← NEW columns
    'Supplier','Date Added'
  ];
  const rows = allProducts.map(p => [
    p.name, p.productId, p.barcode, p.category, p.quantity,
    p.costPrice, p.sellingPrice,
    p.priceHalf || '', p.priceThreequarter || '', p.priceHalfpack || '',
    p.priceDozens || '', p.pricePack || '', p.priceKilo || '',
    p.yardsPerRoll || '', p.priceYard || '', p.kilosPerBag || '',  // ← NEW
    p.supplier,
    p.dateAdded ? new Date(p.dateAdded).toLocaleDateString() : ''
  ]);

  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(','))
    .join('\n');
  downloadFile(csv, 'inventory.csv', 'text/csv');
  showToast('CSV exported!', 'success');
}

// ─── Export PDF ───
function exportPDF() {
  const win  = window.open('', '_blank');
  const rows = allProducts.map(p => `
    <tr>
      <td>${escHtml(p.name)}</td>
      <td>${escHtml(p.productId||'')}</td>
      <td>${escHtml(p.category||'')}</td>
      <td>${p.quantity}</td>
      <td>₦${fmt(p.costPrice)}</td>
      <td>₦${fmt(p.sellingPrice)}</td>
      <td>${p.yardsPerRoll > 0 ? p.yardsPerRoll + ' yds/roll' : '—'}</td>
      <td>${p.kilosPerBag  > 0 ? p.kilosPerBag  + ' kg/bag'  : '—'}</td>
      <td>${escHtml(p.supplier||'')}</td>
    </tr>`).join('');

  win.document.write(`<!DOCTYPE html><html><head><title>Inventory Report</title>
  <style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}
  th,td{padding:8px 10px;border:1px solid #ddd;text-align:left}th{background:#f0f0f0}
  h1{margin-bottom:20px}</style></head><body>
  <h1>NexaPOS — Inventory Report</h1><p>Generated: ${new Date().toLocaleString()}</p>
  <table><thead><tr>
    <th>Name</th><th>ID</th><th>Category</th><th>Qty</th>
    <th>Cost</th><th>Price</th>
    <th>Yds/Roll</th><th>Kg/Bag</th><th>Supplier</th>
  </tr></thead>
  <tbody>${rows}</tbody></table></body></html>`);
  win.document.close();
  win.print();
}

// ─── Utilities ───
function generateId() {
  return 'PRD-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}
function fmt(n) { return parseFloat(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function setValue(id, val) { const el = document.getElementById(id); if (el) el.value = val ?? ''; }
function downloadFile(content, filename, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
}
function showSpinner(show) {
  const el = document.getElementById('loadingSpinner');
  if (el) el.style.display = show ? 'flex' : 'none';
}

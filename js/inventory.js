/**
 * inventory.js
 * Inventory tab: item table (Photo / Item Name / Farm-Maker / Price /
 * Quantity / Date Added / Status / Actions), add/edit modal with photo
 * upload, date-added filter, and delete confirmation.
 */
const Inventory = (() => {
  let filterFrom = null;
  let filterTo = null;
  let allItems = [];
  let editingId = null;
  let pendingPhoto = null;
  let deleteTargetId = null;
  const DEFAULT_LOW_STOCK = 5;
  const MAX_PHOTO_DIMENSION = 500;
  const PLACEHOLDER_IMAGE = null; // handled via Icon('box') instead of a data-URI placeholder

  function init() {
    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) searchInput.addEventListener('input', render);

    const fromInput = document.getElementById('inventoryFilterFrom');
    const toInput = document.getElementById('inventoryFilterTo');
    const applyBtn = document.getElementById('inventoryApplyFilterBtn');
    const resetBtn = document.getElementById('inventoryResetFilterBtn');
    if (applyBtn) applyBtn.addEventListener('click', () => applyDateFilter(fromInput.value, toInput.value));
    if (resetBtn) resetBtn.addEventListener('click', resetDateFilter);

    const addBtn = document.getElementById('addItemBtn');
    if (addBtn) addBtn.addEventListener('click', () => openForm(null));

    const form = document.getElementById('itemForm');
    if (form) form.addEventListener('submit', saveForm);

    const cancelBtn = document.getElementById('itemFormCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => UI.closeModal('itemModal'));
    const closeBtn = document.getElementById('itemModalClose');
    if (closeBtn) closeBtn.addEventListener('click', () => UI.closeModal('itemModal'));

    const photoInput = document.getElementById('itemPhotoInput');
    if (photoInput) photoInput.addEventListener('change', handlePhotoSelect);
    const clearPhotoBtn = document.getElementById('itemPhotoClearBtn');
    if (clearPhotoBtn) clearPhotoBtn.addEventListener('click', clearPhoto);

    render();
  }

  function applyDateFilter(from, to) {
    filterFrom = from || null;
    filterTo = to || null;
    render();
  }

  function resetDateFilter() {
    filterFrom = null;
    filterTo = null;
    const fromInput = document.getElementById('inventoryFilterFrom');
    const toInput = document.getElementById('inventoryFilterTo');
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    render();
  }

  function matchesDateFilter(item) {
    if (!filterFrom && !filterTo) return true;
    const added = new Date(item.dateAdded || item.date_added);
    if (isNaN(added)) return true;
    if (filterFrom && added < new Date(filterFrom + 'T00:00:00')) return false;
    if (filterTo && added > new Date(filterTo + 'T23:59:59')) return false;
    return true;
  }

  async function render() {
    // Don't yank the table out from under an admin mid-edit.
    const modal = document.getElementById('itemModal');
    if (modal && !modal.classList.contains('hidden')) return;

    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    try {
      allItems = await DB.getItems();
    } catch (err) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Could not load inventory: ' + UI.escapeHtml(err.message) + '</td></tr>';
      return;
    }

    const searchInput = document.getElementById('inventorySearch');
    const term = searchInput ? searchInput.value.trim().toLowerCase() : '';

    const filtered = allItems.filter((it) =>
      matchesDateFilter(it) && (!term || it.name.toLowerCase().includes(term))
    );

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No items match your filters.</td></tr>';
    } else {
      tbody.innerHTML = filtered.map((it) => {
        const low = it.lowStockThreshold != null ? it.lowStockThreshold : DEFAULT_LOW_STOCK;
        let statusClass = 'status-ok', statusText = 'In Stock';
        if (it.stock <= 0) { statusClass = 'status-out'; statusText = 'Out of Stock'; }
        else if (it.stock <= low) { statusClass = 'status-low'; statusText = 'Low Stock'; }

        const photo = it.image
          ? '<img src="' + it.image + '" alt="" class="table-thumb">'
          : '<span class="table-thumb table-thumb-empty">' + Icon('box') + '</span>';

        return (
          '<tr data-id="' + UI.escapeHtml(it.id) + '">' +
          '<td>' + photo + '</td>' +
          '<td>' + UI.escapeHtml(it.name) + '</td>' +
          '<td>' + (it.farm ? UI.escapeHtml(it.farm) : '<span class="muted-cell">—</span>') + '</td>' +
          '<td class="peso-amt">' + UI.peso(it.price) + '</td>' +
          '<td>' + it.stock + '</td>' +
          '<td>' + UI.formatDate(it.dateAdded || it.date_added) + '</td>' +
          '<td><span class="status-text ' + statusClass + '">' + statusText + '</span></td>' +
          '<td class="table-actions">' +
          '<button type="button" class="icon-btn" data-action="edit" aria-label="Edit ' + UI.escapeHtml(it.name) + '">' + Icon('edit') + '</button>' +
          '<button type="button" class="icon-btn icon-btn-danger" data-action="delete" aria-label="Delete ' + UI.escapeHtml(it.name) + '">' + Icon('trash') + '</button>' +
          '</td>' +
          '</tr>'
        );
      }).join('');

      tbody.querySelectorAll('tr').forEach((row) => {
        const id = row.dataset.id;
        const editBtn = row.querySelector('[data-action="edit"]');
        const delBtn = row.querySelector('[data-action="delete"]');
        if (editBtn) editBtn.addEventListener('click', () => openForm(id));
        if (delBtn) delBtn.addEventListener('click', () => confirmDelete(id));
      });
    }

    if (window.POS) POS.renderItemGrid();
  }

  function openForm(itemId) {
    editingId = itemId;
    pendingPhoto = null;
    const form = document.getElementById('itemForm');
    const title = document.getElementById('itemModalTitle');
    form.reset();
    clearPhoto();

    if (itemId) {
      const item = allItems.find((it) => it.id === itemId);
      if (!item) return;
      title.textContent = 'Edit Item';
      document.getElementById('itemName').value = item.name;
      document.getElementById('itemFarm').value = item.farm || '';
      document.getElementById('itemPrice').value = item.price;
      document.getElementById('itemStock').value = item.stock;
      if (item.image) setPhotoPreview(item.image);
    } else {
      title.textContent = 'Add Item';
    }

    UI.openModal('itemModal');
    document.getElementById('itemName').focus();
  }

  function setPhotoPreview(src) {
    const preview = document.getElementById('itemPhotoPreview');
    const placeholder = document.getElementById('itemPhotoPlaceholder');
    if (preview) { preview.src = src; preview.classList.remove('hidden'); }
    if (placeholder) placeholder.classList.add('hidden');
    const clearBtn = document.getElementById('itemPhotoClearBtn');
    if (clearBtn) clearBtn.classList.remove('hidden');
  }

  function clearPhoto() {
    pendingPhoto = editingId ? undefined : null; // undefined = "no change" on edit; null = "no photo" on add
    if (editingId) pendingPhoto = null;
    const preview = document.getElementById('itemPhotoPreview');
    const placeholder = document.getElementById('itemPhotoPlaceholder');
    if (preview) { preview.src = ''; preview.classList.add('hidden'); }
    if (placeholder) placeholder.classList.remove('hidden');
    const clearBtn = document.getElementById('itemPhotoClearBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    const fileInput = document.getElementById('itemPhotoInput');
    if (fileInput) fileInput.value = '';
  }

  function handlePhotoSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION) {
          const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        pendingPhoto = canvas.toDataURL('image/jpeg', 0.82);
        setPhotoPreview(pendingPhoto);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  async function saveForm(e) {
    e.preventDefault();
    const name = document.getElementById('itemName').value.trim();
    const farm = document.getElementById('itemFarm').value.trim();
    const price = parseFloat(document.getElementById('itemPrice').value);
    const stock = parseInt(document.getElementById('itemStock').value, 10);

    if (!name || isNaN(price) || price < 0 || isNaN(stock) || stock < 0) {
      UI.toast('Please fill in all fields with valid values.');
      return;
    }

    const payload = { name, farm, price, stock };
    if (pendingPhoto !== undefined && pendingPhoto !== null) payload.image = pendingPhoto;
    if (pendingPhoto === null && editingId) {
      const existing = allItems.find((it) => it.id === editingId);
      if (!existing || !existing.image) payload.image = '';
    }

    const saveBtn = document.getElementById('itemFormSaveBtn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

    try {
      if (editingId) {
        await DB.updateItem(editingId, payload);
        UI.toast('Item updated.');
      } else {
        await DB.addItem(payload);
        UI.toast('Item added.');
      }
      UI.closeModal('itemModal');
      render();
    } catch (err) {
      UI.toast('Could not save item: ' + err.message);
    } finally {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Item'; }
    }
  }

  function confirmDelete(itemId) {
    deleteTargetId = itemId;
    const item = allItems.find((it) => it.id === itemId);
    const name = item ? item.name : 'this item';
    UI.confirm('Delete "' + name + '" from inventory? This cannot be undone.', {
      title: 'Delete Item', okText: 'Delete', okClass: 'btn-danger',
    }).then((ok) => { if (ok) deleteCurrent(); });
  }

  async function deleteCurrent() {
    if (!deleteTargetId) return;
    try {
      await DB.deleteItem(deleteTargetId);
      UI.toast('Item deleted.');
      render();
    } catch (err) {
      UI.toast('Could not delete item: ' + err.message);
    } finally {
      deleteTargetId = null;
    }
  }

  return { init, applyDateFilter, resetDateFilter, render, openForm, confirmDelete, deleteCurrent };
})();

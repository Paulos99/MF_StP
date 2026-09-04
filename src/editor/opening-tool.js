import { Room, Opening } from '../core/room-model.js';
import { OPENING_TYPES, VALIDATION } from '../core/constants.js';
import { roundMeters } from '../core/geometry.js';

export function createDefaultOpening(wallId, type = OPENING_TYPES.DOOR) {
  return new Opening({
    wallId,
    type,
    offset: 0.5,
    width: type === OPENING_TYPES.DOOR ? 0.9 : 1.2,
    height: type === OPENING_TYPES.DOOR ? 2.1 : 1.4,
    sillHeight: type === OPENING_TYPES.WINDOW ? 0.9 : 0,
  });
}

export function bindOpeningForm(form, getRoom, planEditor, onChange, onRender, onWallChange, elevationEditor) {
  const renderPlans = () => {
    planEditor?.render();
    onRender?.();
  };

  const wallSelect = form.wallSelect;
  const wallChips = form.wallChips;
  const openingType = form.openingType;
  const openingTypeToggle = form.openingTypeToggle;
  const openingOffset = form.openingOffset;
  const openingWidth = form.openingWidth;
  const openingHeight = form.openingHeight;
  const openingSill = form.openingSill;
  const sillGroup = form.sillGroup;
  const openingsList = form.openingsList;
  const openingsCount = form.openingsCount;
  const propertiesPanel = form.openingPropertiesPanel;
  const propertiesTitle = form.openingPropertiesTitle;
  const cancelEditBtn = form.cancelOpeningEditBtn;
  const deleteOpeningBtn = form.deleteOpeningBtn;
  const elevationWallLabel = form.elevationWallLabel;

  let editingId = null;

  function getSelectedWallId() {
    return wallSelect?.value || planEditor?.selectedWallId || getRoom().walls[0]?.id;
  }

  function syncTypeToggle(type) {
    if (!openingTypeToggle) return;
    openingTypeToggle.querySelectorAll('.type-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
  }

  function setOpeningType(type) {
    if (openingType) openingType.value = type;
    syncTypeToggle(type);
    if (sillGroup) sillGroup.hidden = type !== OPENING_TYPES.WINDOW;
  }

  function updateElevationLabel() {
    if (!elevationWallLabel) return;
    const wall = getRoom().walls.find((w) => w.id === getSelectedWallId());
    if (!wall) {
      elevationWallLabel.textContent = '—';
      return;
    }
    elevationWallLabel.textContent = `${wall.label} · ${wall.length.toFixed(2)} × ${getRoom().wallHeight.toFixed(2)} м`;
  }

  function updateOpeningsCount() {
    if (!openingsCount) return;
    openingsCount.textContent = String(getRoom().openings.length);
  }

  function applyFormToOpening(o) {
    o.wallId = getSelectedWallId() || o.wallId;
    o.type = openingType.value;
    o.offset = roundMeters(parseLocaleNumber(openingOffset.value) || 0);
    o.width = roundMeters(parseLocaleNumber(openingWidth.value) || o.width);
    o.height = roundMeters(parseLocaleNumber(openingHeight.value) || o.height);
    o.sillHeight = roundMeters(parseLocaleNumber(openingSill.value) || 0.9);
    const wall = getRoom().walls.find((w) => w.id === o.wallId);
    if (wall) {
      const max = Math.max(0, wall.length - o.width);
      o.offset = Math.max(0, Math.min(max, o.offset));
    }
  }

  function syncFormFromOpening(o) {
    if (wallSelect) wallSelect.value = o.wallId;
    setOpeningType(o.type);
    openingOffset.value = roundMeters(o.offset);
    openingWidth.value = roundMeters(o.width);
    openingHeight.value = roundMeters(o.height);
    openingSill.value = roundMeters(o.sillHeight);
    refreshWallChips();
    updateElevationLabel();
  }

  function showPropertiesPanel(openingId) {
    if (!propertiesPanel) return;
    const o = openingId ? getRoom().getOpening(openingId) : null;
    if (!o) {
      propertiesPanel.hidden = true;
      return;
    }
    propertiesPanel.hidden = false;
    if (propertiesTitle) {
      const label = o.type === OPENING_TYPES.DOOR ? 'Дверь' : 'Окно';
      propertiesTitle.textContent = `${label} — параметры`;
    }
  }

  function clearEditMode() {
    editingId = null;
    showPropertiesPanel(null);
    planEditor?.selectOpening(null);
    elevationEditor?.selectOpening(null);
    refreshOpeningsList();
  }

  function selectOpening(openingId) {
    if (!openingId) {
      clearEditMode();
      elevationEditor?.selectOpening(null);
      return;
    }
    const o = getRoom().getOpening(openingId);
    if (!o) return;
    if (o.wallId !== getSelectedWallId()) {
      if (wallSelect) wallSelect.value = o.wallId;
      onWallChange?.(o.wallId);
      refreshWallChips();
    }
    editingId = openingId;
    syncFormFromOpening(o);
    showPropertiesPanel(openingId);
    planEditor?.selectWall(o.wallId);
    planEditor?.selectOpening(o.id);
    elevationEditor?.selectOpening(o.id);
    refreshOpeningsList();
  }

  function refreshWallChips() {
    const room = getRoom();
    const selectedId = getSelectedWallId();

    if (wallSelect) {
      wallSelect.innerHTML = room.walls
        .map((w) => `<option value="${w.id}">${w.label} (${w.length.toFixed(2)} м)</option>`)
        .join('');
      if (selectedId) wallSelect.value = selectedId;
    }

    if (!wallChips) return;

    wallChips.innerHTML = room.walls
      .map((w) => {
        const active = w.id === selectedId ? ' active' : '';
        const short = w.label.replace('Стена ', '');
        return `<button type="button" class="wall-chip${active}" data-wall-id="${w.id}" role="tab" aria-selected="${w.id === selectedId}">
          <span>${short}</span>
          <span class="wall-chip-meta">${w.length.toFixed(1)} м</span>
        </button>`;
      })
      .join('');

    wallChips.querySelectorAll('.wall-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const wallId = chip.dataset.wallId;
        if (wallSelect) wallSelect.value = wallId;
        if (editingId) applyLiveEdit();
        else onWallChange?.(wallId);
        refreshWallChips();
        updateElevationLabel();
      });
    });

    updateElevationLabel();
  }

  function refreshOpeningsList() {
    const room = getRoom();
    updateOpeningsCount();
    if (!openingsList) return;
    if (room.openings.length === 0) {
      openingsList.innerHTML = '<p class="hint-text">Проёмов пока нет — добавьте дверь или окно на развёртке</p>';
      return;
    }
    openingsList.innerHTML = room.openings
      .map((o) => {
        const wall = room.walls.find((w) => w.id === o.wallId);
        const label = o.type === OPENING_TYPES.DOOR ? 'Дверь' : 'Окно';
        const selected = o.id === editingId ? ' opening-item--selected' : '';
        const shortWall = wall?.label.replace('Стена ', '') ?? o.wallId;
        return `<div class="opening-item${selected}" data-id="${o.id}" role="button" tabindex="0">
          <span>${label} · ${shortWall} · ${o.width}×${o.height} м</span>
          <button type="button" class="btn-icon btn-remove-opening" data-id="${o.id}" title="Удалить">×</button>
        </div>`;
      })
      .join('');

    openingsList.querySelectorAll('.opening-item').forEach((item) => {
      const openEdit = () => selectOpening(item.dataset.id);
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-opening')) return;
        openEdit();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openEdit();
        }
      });
    });

    openingsList.querySelectorAll('.btn-remove-opening').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeOpening(btn.dataset.id);
      });
    });
  }

  function removeOpening(id) {
    if (editingId === id) clearEditMode();
    getRoom().removeOpening(id);
    onChange?.();
    refreshOpeningsList();
    renderPlans();
  }

  function applyLiveEdit() {
    if (!editingId) return;
    const o = getRoom().getOpening(editingId);
    if (!o) return;
    applyFormToOpening(o);
    onChange?.();
    renderPlans();
    refreshOpeningsList();
  }

  openingTypeToggle?.querySelectorAll('.type-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      setOpeningType(btn.dataset.type);
      applyLiveEdit();
    });
  });

  openingType?.addEventListener('change', () => {
    setOpeningType(openingType.value);
    applyLiveEdit();
  });

  [openingOffset, openingWidth, openingHeight, openingSill].forEach((el) => {
    el?.addEventListener('input', applyLiveEdit);
  });

  wallSelect?.addEventListener('change', () => {
    if (editingId) applyLiveEdit();
    else onWallChange?.(wallSelect.value);
    refreshWallChips();
  });

  cancelEditBtn?.addEventListener('click', () => {
    clearEditMode();
    renderPlans();
  });

  deleteOpeningBtn?.addEventListener('click', () => {
    if (!editingId) return;
    removeOpening(editingId);
  });

  return {
    refreshWallOptions: refreshWallChips,
    refreshOpeningsList,
    selectOpening,
    clearEditMode,
    getEditingId: () => editingId,
    syncFormFromOpeningId: (id) => {
      const o = getRoom().getOpening(id);
      if (o && editingId === id) syncFormFromOpening(o);
    },
  };
}

export function parseLocaleNumber(value) {
  if (typeof value === 'number') return value;
  return Number(String(value ?? '').trim().replace(',', '.'));
}

export function validateRoomForm(form, room) {
  return room.validate();
}

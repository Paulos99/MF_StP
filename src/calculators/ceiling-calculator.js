import { PANEL_LAYOUT, RESERVES } from '../core/constants.js';

export class Orientation {
  static HORIZONTAL = 'HORIZONTAL';
  static VERTICAL = 'VERTICAL';
}

export class Panel {
  constructor(x, y, width, height, orientation, number, isCut = false, meta = {}) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
    this.orientation = orientation;
    this.number = number;
    this.isCut = isCut;
    this.meta = meta;
    /** Составные части (Г-форма и др.) в абсолютных координатах: [{x,y,w,h}, ...] */
    this.parts = Array.isArray(meta.parts) && meta.parts.length ? meta.parts.map((p) => ({ ...p })) : null;
  }

  getParts() {
    if (this.parts?.length) return this.parts;
    return [{ x: this.x, y: this.y, w: this.width, h: this.height }];
  }

  getArea() {
    if (Number.isFinite(this.meta?.coveredArea)) {
      return this.meta.coveredArea;
    }
    if (this.parts?.length) {
      return this.parts.reduce((s, p) => s + p.w * p.h, 0);
    }
    return this.width * this.height;
  }

  static fromParts(parts, orientation, number, isCut, meta = {}) {
    if (!parts?.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of parts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + p.w);
      maxY = Math.max(maxY, p.y + p.h);
    }
    return new Panel(minX, minY, maxX - minX, maxY - minY, orientation, number, isCut, {
      ...meta,
      parts: parts.length > 1 ? parts : undefined,
    });
  }
}

export class PanelCalculator {
  constructor(room) {
    this.room = room;
    this.panelLength = PANEL_LAYOUT.length;
    this.panelWidth = PANEL_LAYOUT.width;
  }

  isPointInsideRoom(x, y) {
    if (x >= 0 && x <= this.room.mainLength && y >= 0 && y <= this.room.mainWidth) {
      return true;
    }
    if (this.room.legLength > 0 && this.room.legWidth > 0) {
      if (x >= 0 && x <= this.room.legLength &&
          y >= this.room.mainWidth && y <= this.room.mainWidth + this.room.legWidth) {
        return true;
      }
    }
    return false;
  }

  isFullHorizontalPanel(width, height) {
    return Math.abs(width - this.panelLength) < 1e-6 && Math.abs(height - this.panelWidth) < 1e-6;
  }

  isFullVerticalPanel(width, height) {
    return Math.abs(width - this.panelWidth) < 1e-6 && Math.abs(height - this.panelLength) < 1e-6;
  }

  getMaxXForRow(y) {
    if (y < this.room.mainWidth) return this.room.mainLength;
    return this.room.legLength;
  }

  getMaxYForColumn(x) {
    const maxY = this.room.mainWidth + this.room.legWidth;
    if (x < this.room.legLength && x < this.room.mainLength) return maxY;
    if (x < this.room.mainLength) return this.room.mainWidth;
    if (x < this.room.legLength) return maxY;
    return 0;
  }

  tryPlacePanel(panels, x, y, width, height, orientation, isCut) {
    if (width < 1e-6 || height < 1e-6) return null;
    const panel = new Panel(x, y, width, height, orientation, 0, isCut);
    if (!this.isPanelInsideRoom(panel.x, panel.y, panel.width, panel.height)) return null;
    if (this.checkPanelCollision(panel, panels)) return null;
    panels.push(panel);
    return panel;
  }

  fillHorizontalLayout(panels, startY = 0) {
    const maxY = this.room.mainWidth + this.room.legWidth;
    let y = startY;

    while (y < maxY - 1e-6) {
      const rowHeight = Math.min(this.panelWidth, maxY - y);
      const crossesMainLegBoundary =
        this.room.legLength > 0 &&
        this.room.legWidth > 0 &&
        y < this.room.mainWidth - 1e-6 &&
        y + rowHeight > this.room.mainWidth + 1e-6;

      if (crossesMainLegBoundary) {
        const upperHeight = this.room.mainWidth - y;
        if (upperHeight > 1e-6) {
          this.fillHorizontalRow(panels, y, upperHeight, this.room.mainLength);
        }
        const lowerHeight = rowHeight - upperHeight;
        if (lowerHeight > 1e-6) {
          this.fillHorizontalRow(panels, this.room.mainWidth, lowerHeight, this.room.legLength);
        }
      } else {
        this.fillHorizontalRow(panels, y, rowHeight, this.getMaxXForRow(y));
      }
      y += rowHeight;
    }
    return this.renumberPanels(panels);
  }

  fillHorizontalRow(panels, y, rowHeight, maxX) {
    let x = 0;
    while (x < maxX - 1e-6) {
      const remainingX = maxX - x;
      const panelWidth = remainingX >= this.panelLength - 1e-6 ? this.panelLength : remainingX;
      const isCut = !this.isFullHorizontalPanel(panelWidth, rowHeight);
      this.tryPlacePanel(panels, x, y, panelWidth, rowHeight, Orientation.HORIZONTAL, isCut);
      x += panelWidth;
    }
  }

  fillVerticalLayout(panels) {
    const maxX = Math.max(this.room.mainLength, this.room.legLength);
    let x = 0;

    while (x < maxX - 1e-6) {
      const colWidth = Math.min(this.panelWidth, maxX - x);
      const crossesVerticalBoundary =
        this.room.legLength > 0 &&
        this.room.legWidth > 0 &&
        this.room.legLength !== this.room.mainLength &&
        x < Math.min(this.room.legLength, this.room.mainLength) - 1e-6 &&
        x + colWidth > Math.min(this.room.legLength, this.room.mainLength) + 1e-6;

      if (crossesVerticalBoundary) {
        const boundaryX = Math.min(this.room.legLength, this.room.mainLength);
        const leftWidth = boundaryX - x;
        if (leftWidth > 1e-6) {
          this.fillVerticalColumn(panels, x, leftWidth, 0, this.room.mainWidth + this.room.legWidth);
        }
        const rightWidth = colWidth - leftWidth;
        if (rightWidth > 1e-6) {
          const rightStartY = x + leftWidth >= this.room.mainLength - 1e-6 ? this.room.mainWidth : 0;
          this.fillVerticalColumn(panels, x + leftWidth, rightWidth, rightStartY, this.getMaxYForColumn(x + leftWidth));
        }
      } else {
        let startY = 0;
        if (x >= this.room.mainLength - 1e-6 && x < this.room.legLength - 1e-6) {
          startY = this.room.mainWidth;
        }
        this.fillVerticalColumn(panels, x, colWidth, startY, this.getMaxYForColumn(x));
      }
      x += colWidth;
    }
    return this.renumberPanels(panels);
  }

  fillVerticalColumn(panels, x, colWidth, startY, maxY) {
    let y = startY;
    while (y < maxY - 1e-6) {
      const remainingY = maxY - y;
      const panelHeight = remainingY >= this.panelLength - 1e-6 ? this.panelLength : remainingY;
      const isCut = !this.isFullVerticalPanel(colWidth, panelHeight);
      this.tryPlacePanel(panels, x, y, colWidth, panelHeight, Orientation.VERTICAL, isCut);
      y += panelHeight;
    }
  }

  isPanelInsideRoom(x, y, width, height) {
    const corners = [
      { x, y },
      { x: x + width, y },
      { x, y: y + height },
      { x: x + width, y: y + height },
    ];
    return corners.every((c) => this.isPointInsideRoom(c.x, c.y));
  }

  checkPanelCollision(panel, panels) {
    for (const existing of panels) {
      if (
        !(
          panel.x + panel.width <= existing.x ||
          existing.x + existing.width <= panel.x ||
          panel.y + panel.height <= existing.y ||
          existing.y + existing.height <= panel.y
        )
      ) {
        return true;
      }
    }
    return false;
  }

  renumberPanels(panels) {
    const sorted = [...panels].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) > 1e-6) return yDiff;
      return a.x - b.x;
    });
    sorted.forEach((p, i) => { p.number = i + 1; });
    return sorted;
  }

  calculateScheme1() {
    return this.fillHorizontalLayout([]);
  }

  calculateScheme2() {
    return this.fillVerticalLayout([]);
  }

  calculateScheme3() {
    const panels = [];
    const maxXForTop = Math.max(this.room.mainLength, this.room.legLength);
    let x = 0;
    while (x < maxXForTop - 1e-6) {
      const colWidth = Math.min(this.panelWidth, maxXForTop - x);
      const maxYForColumn = this.getMaxYForColumn(x);
      const stripHeight = Math.min(this.panelLength, maxYForColumn);
      if (stripHeight > 1e-6) {
        const isCut = !this.isFullVerticalPanel(colWidth, stripHeight);
        this.tryPlacePanel(panels, x, 0, colWidth, stripHeight, Orientation.VERTICAL, isCut);
      }
      x += colWidth;
    }
    return this.fillHorizontalLayout(panels, this.panelLength);
  }

  calculateBestScheme() {
    const schemes = [
      { name: 'Горизонтальная', panels: this.calculateScheme1() },
      { name: 'Вертикальная', panels: this.calculateScheme2() },
      { name: 'Комбинированная', panels: this.calculateScheme3() },
    ];
    schemes.forEach((s) => {
      s.stats = this.getStatistics(s.panels);
    });
    schemes.sort((a, b) => {
      if (a.stats.total !== b.stats.total) return a.stats.total - b.stats.total;
      return b.stats.cutPanels - a.stats.cutPanels;
    });
    return schemes[0];
  }

  getStatistics(panels) {
    const horizontal = panels.filter((p) => p.orientation === Orientation.HORIZONTAL).length;
    const vertical = panels.filter((p) => p.orientation === Orientation.VERTICAL).length;
    const fullPanels = panels.filter((p) => !p.isCut).length;
    const cutPanels = panels.filter((p) => p.isCut).length;
    const totalPanels = panels.length;
    const roomArea = this.room.getTotalArea();

    let coverageAreaActual = panels.reduce((s, p) => s + p.getArea(), 0);
    coverageAreaActual = Math.min(coverageAreaActual, roomArea);

    const panelsToPurchase = totalPanels;
    const withReserve = Math.ceil(panelsToPurchase * (1 + RESERVES.panels));
    const dowelsBase = totalPanels * RESERVES.dowelsPerPanel;
    const dowelsWithReserve = Math.ceil(dowelsBase * (1 + RESERVES.dowels));
    const workTimeMinutes = Math.round(totalPanels * 60 / 60);
    const workTimeHours = Math.floor(workTimeMinutes / 60);
    const remainingMinutes = workTimeMinutes % 60;

    const coveragePercent = roomArea > 0
      ? Math.min(100, (coverageAreaActual / roomArea) * 100)
      : 0;

    return {
      total: totalPanels,
      fullPanels,
      cutPanels,
      panelsToPurchase,
      horizontal,
      vertical,
      coverageArea: coverageAreaActual.toFixed(2),
      coveragePercent: coveragePercent.toFixed(1),
      withReserve,
      dowels: { base: dowelsBase, withReserve: dowelsWithReserve },
      workTime: {
        minutes: workTimeMinutes,
        hours: workTimeHours,
        remainingMinutes,
        formatted: workTimeHours > 0 ? `${workTimeHours} ч ${remainingMinutes} мин` : `${workTimeMinutes} мин`,
      },
    };
  }
}

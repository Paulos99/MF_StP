import { VALIDATION, OPENING_TYPES } from './constants.js';
import {
  cloneVertices,
  createRectangleVertices,
  getEdges,
  getPerimeter,
  hasSelfIntersection,
  migrateLegacyRoom,
  shoelaceArea,
  labelForIndex,
} from './polygon-geometry.js';
import { roundMeters } from './geometry.js';

let openingIdCounter = 1;

export class Opening {
  constructor({ id, wallId, type, offset, width, height, sillHeight = 0.9 }) {
    this.id = id ?? `opening-${openingIdCounter++}`;
    this.wallId = wallId;
    this.type = type ?? OPENING_TYPES.DOOR;
    this.offset = offset;
    this.width = width;
    this.height = height;
    this.sillHeight = sillHeight;
  }

  clone() {
    return new Opening({ ...this });
  }
}

export class WallSegment {
  constructor({ id, label, length, planStart, planEnd }) {
    this.id = id;
    this.label = label;
    this.length = length;
    this.planStart = planStart;
    this.planEnd = planEnd;
  }

  getArea(wallHeight, openings = []) {
    const gross = this.length * wallHeight;
    const openingArea = openings
      .filter((o) => o.wallId === this.id)
      .reduce((sum, o) => sum + o.width * o.height, 0);
    return Math.max(0, gross - openingArea);
  }
}

export class Room {
  constructor(data = {}) {
    this.wallHeight = data.wallHeight ?? 2.7;
    this.vertices = cloneVertices(
      data.vertices?.length >= 3 ? data.vertices : migrateLegacyRoom(data)
    );
    this.edgeDimensions = { ...(data.edgeDimensions ?? {}) };
    this.diagonalDimensions = { ...(data.diagonalDimensions ?? {}) };
    this.openings = (data.openings ?? []).map((o) => (o instanceof Opening ? o : new Opening(o)));
    this.walls = [];
    this.rebuildWalls();
  }

  get mainLength() {
    if (this.vertices.length < 2) return 5;
    let maxX = 0;
    for (const v of this.vertices) maxX = Math.max(maxX, v.x);
    return maxX;
  }

  get mainWidth() {
    if (this.vertices.length < 2) return 4;
    let maxY = 0;
    for (const v of this.vertices) maxY = Math.max(maxY, v.y);
    return maxY;
  }

  getTotalArea() {
    return shoelaceArea(this.vertices);
  }

  getTotalWallArea() {
    return this.walls.reduce((sum, w) => sum + w.getArea(this.wallHeight, this.openings), 0);
  }

  getPerimeter() {
    return getPerimeter(this.vertices);
  }

  rebuildWalls() {
    const edges = getEdges(this.vertices);
    this.walls = edges.map((e, i) => {
      const letter = e.a.label || labelForIndex(i);
      return new WallSegment({
        id: `wall-${i}`,
        label: `Стена ${letter}`,
        length: roundMeters(e.length),
        planStart: { x: e.a.x, y: e.a.y },
        planEnd: { x: e.b.x, y: e.b.y },
      });
    });
  }

  setVertices(vertices, edgeDimensions = null, diagonalDimensions = null) {
    this.vertices = cloneVertices(vertices);
    if (edgeDimensions) this.edgeDimensions = { ...edgeDimensions };
    if (diagonalDimensions) this.diagonalDimensions = { ...diagonalDimensions };
    this.rebuildWalls();
    this._remapOpeningsAfterWallChange();
  }

  _remapOpeningsAfterWallChange() {
    for (const o of this.openings) {
      if (!this.walls.find((w) => w.id === o.wallId)) {
        o.wallId = this.walls[0]?.id ?? o.wallId;
      }
      const wall = this.walls.find((w) => w.id === o.wallId);
      if (wall) {
        const max = Math.max(0, wall.length - o.width);
        o.offset = Math.max(0, Math.min(max, o.offset));
      }
    }
  }

  addOpening(opening) {
    const o = opening instanceof Opening ? opening : new Opening(opening);
    this.openings.push(o);
    return o;
  }

  removeOpening(id) {
    this.openings = this.openings.filter((o) => o.id !== id);
  }

  getOpening(id) {
    return this.openings.find((o) => o.id === id) ?? null;
  }

  updateOpening(id, patch) {
    const o = this.getOpening(id);
    if (!o) return null;
    Object.assign(o, patch);
    return o;
  }

  getOpeningsForWall(wallId) {
    return this.openings.filter((o) => o.wallId === wallId);
  }

  allEdgesDimensioned() {
    const n = this.vertices.length;
    if (n < 3) return false;
    for (let i = 0; i < n; i++) {
      const val = this.edgeDimensions[i];
      if (!val || val <= 0) return false;
    }
    return true;
  }

  validate() {
    const errors = [];
    const check = (val, min, max, name) => {
      if (val === '' || val === null || val === undefined || Number.isNaN(val)) {
        errors.push(`«${name}» обязательно`);
        return;
      }
      if (val < min || val > max) errors.push(`«${name}»: от ${min} до ${max}`);
    };

    check(this.wallHeight, VALIDATION.MIN_WALL_HEIGHT, VALIDATION.MAX_WALL_HEIGHT, 'Высота стен');

    if (this.vertices.length < 3) {
      errors.push('Нарисуйте контур помещения (минимум 3 угла)');
    }

    if (hasSelfIntersection(this.vertices)) {
      errors.push('Контур не должен пересекать сам себя');
    }

    if (this.vertices.length >= 3 && !this.allEdgesDimensioned()) {
      errors.push('Укажите размеры всех сторон контура');
    }

    for (const wall of this.walls) {
      for (const o of this.getOpeningsForWall(wall.id)) {
        if (o.offset < 0 || o.offset + o.width > wall.length + 1e-6) {
          errors.push(`${wall.label}: проём выходит за пределы стены`);
        }
        if (o.height > this.wallHeight + 1e-6) {
          errors.push(`${wall.label}: высота проёма больше высоты стены`);
        }
        if (o.type === OPENING_TYPES.WINDOW && o.sillHeight + o.height > this.wallHeight + 1e-6) {
          errors.push(`${wall.label}: окно выходит за верх стены`);
        }
      }
    }

    const area = this.getTotalArea();
    if (this.vertices.length >= 3) {
      if (area < VALIDATION.MIN_TOTAL_AREA) errors.push('Площадь потолка слишком мала');
      if (area > VALIDATION.MAX_TOTAL_AREA) errors.push('Площадь потолка слишком велика');
    }

    return errors;
  }

  clone() {
    return new Room({
      vertices: this.vertices,
      edgeDimensions: this.edgeDimensions,
      diagonalDimensions: this.diagonalDimensions,
      wallHeight: this.wallHeight,
      openings: this.openings.map((o) => o.clone()),
    });
  }

  toJSON() {
    return {
      vertices: this.vertices.map((v) => ({ x: v.x, y: v.y, label: v.label })),
      edgeDimensions: this.edgeDimensions,
      diagonalDimensions: this.diagonalDimensions,
      wallHeight: this.wallHeight,
      openings: this.openings.map((o) => ({
        id: o.id,
        wallId: o.wallId,
        type: o.type,
        offset: o.offset,
        width: o.width,
        height: o.height,
        sillHeight: o.sillHeight,
      })),
    };
  }

  static fromJSON(data) {
    if (!data) return new Room();
    return new Room(data);
  }

  static createDefault() {
    return new Room({
      vertices: createRectangleVertices(5, 4),
      edgeDimensions: { 0: 5, 1: 4, 2: 5, 3: 4 },
    });
  }
}

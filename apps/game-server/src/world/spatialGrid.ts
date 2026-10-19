/**
 * Uniform spatial hash for interest management: "who is near this point?"
 * without scanning every player on the map.
 */
export class SpatialGrid<T extends { x: number; y: number }> {
  private readonly cells = new Map<number, Set<T>>();
  private readonly where = new Map<T, number>();

  constructor(private readonly cellSize = 512) {}

  private key(x: number, y: number): number {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return cx * 65536 + cy;
  }

  insert(item: T): void {
    const k = this.key(item.x, item.y);
    let cell = this.cells.get(k);
    if (!cell) this.cells.set(k, (cell = new Set()));
    cell.add(item);
    this.where.set(item, k);
  }

  /** Call after an item's x/y changed. */
  update(item: T): void {
    const k = this.key(item.x, item.y);
    const prev = this.where.get(item);
    if (prev === k) return;
    if (prev !== undefined) this.cells.get(prev)?.delete(item);
    let cell = this.cells.get(k);
    if (!cell) this.cells.set(k, (cell = new Set()));
    cell.add(item);
    this.where.set(item, k);
  }

  remove(item: T): void {
    const k = this.where.get(item);
    if (k !== undefined) {
      const cell = this.cells.get(k);
      cell?.delete(item);
      if (cell && cell.size === 0) this.cells.delete(k);
    }
    this.where.delete(item);
  }

  /** Items whose cell overlaps the rectangle (callers do the exact distance test). */
  query(x0: number, y0: number, x1: number, y1: number, out: T[] = []): T[] {
    const cx0 = Math.floor(x0 / this.cellSize);
    const cy0 = Math.floor(y0 / this.cellSize);
    const cx1 = Math.floor(x1 / this.cellSize);
    const cy1 = Math.floor(y1 / this.cellSize);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.cells.get(cx * 65536 + cy);
        if (cell) for (const it of cell) out.push(it);
      }
    return out;
  }

  get size(): number {
    return this.where.size;
  }
}

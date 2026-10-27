/**
 * Изометрия для сцены загрузки (#78): точка плоскости (x, y) и высота z → координаты SVG.
 * Ось x уходит вправо-вниз, y — влево-вниз, z — вверх; единица — `ISO_UNIT` пикселей.
 */
export const ISO_UNIT = 12
const C = Math.cos(Math.PI / 6)

export function isoPoint(x: number, y: number, z = 0): [number, number] {
  return [Math.round((x - y) * C * ISO_UNIT * 10) / 10, Math.round(((x + y) * 0.5 - z) * ISO_UNIT * 10) / 10]
}

const pts = (list: Array<[number, number, number]>) => list.map(p => isoPoint(...p).join(',')).join(' ')

/** Грани коробки: верх, левая (к зрителю по y) и правая (к зрителю по x) — видимые три. */
export function isoBox(x: number, y: number, z: number, w: number, d: number, h: number) {
  const t = z + h
  return {
    top: pts([[x, y, t], [x + w, y, t], [x + w, y + d, t], [x, y + d, t]]),
    left: pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, t], [x, y + d, t]]),
    right: pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, t], [x + w, y, t]]),
  }
}

/** Плоский четырёхугольник на уровне z (участок, дорога, вода). */
export function isoRect(x: number, y: number, w: number, d: number, z = 0): string {
  return pts([[x, y, z], [x + w, y, z], [x + w, y + d, z], [x, y + d, z]])
}

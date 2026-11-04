import { Quaternion, Vector3 } from 'three';
import { hasTile, type Level } from './levels';
import { DIRECTION_DELTAS, type BlockPosition, type Direction } from './logic';

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 510;
const ISO_WIDTH = Math.sqrt(3) / 2;
const HALF_WIDTH = 0.48;
const HALF_HEIGHT = 0.98;

interface Point2D {
  horizontal: number;
  vertical: number;
}

interface Turn {
  pivot: Vector3;
  rotation: Quaternion;
}

type FaceAxis = 'column' | 'height' | 'row';

interface Face {
  axis: FaceAxis;
  sign: number;
}

const FACES: Face[] = [
  { axis: 'column', sign: 1 }, { axis: 'column', sign: -1 },
  { axis: 'height', sign: 1 }, { axis: 'height', sign: -1 },
  { axis: 'row', sign: 1 }, { axis: 'row', sign: -1 },
];

export function blockCenter(position: BlockPosition): Vector3 {
  return new Vector3(
    position.column + (position.axis === 'column' ? 1 : 0.5),
    position.axis === 'upright' ? 1 : 0.5,
    position.row + (position.axis === 'row' ? 1 : 0.5),
  );
}

export function turnFor(direction: Direction, amount: number): Quaternion {
  const delta = DIRECTION_DELTAS[direction];
  if (delta.column !== 0) {
    return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -delta.column * amount);
  }
  return new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), delta.row * amount);
}

export function turnPivot(position: BlockPosition, direction: Direction): Vector3 {
  const center = blockCenter(position);
  const delta = DIRECTION_DELTAS[direction];
  const width = position.axis === 'column' ? 2 : 1;
  const depth = position.axis === 'row' ? 2 : 1;
  return new Vector3(
    delta.column === 0 ? center.x : position.column + (delta.column > 0 ? width : 0),
    0,
    delta.row === 0 ? center.z : position.row + (delta.row > 0 ? depth : 0),
  );
}

function surfacePoint(face: Face, across: number, along: number): Vector3 {
  if (face.axis === 'column') return new Vector3(face.sign * HALF_WIDTH, along, across);
  if (face.axis === 'height') return new Vector3(across, face.sign * HALF_HEIGHT, along);
  return new Vector3(across, along, face.sign * HALF_WIDTH);
}

function surfaceRectangle(face: Face, fromAcross: number, fromAlong: number, toAcross: number, toAlong: number): Vector3[] {
  return [
    surfacePoint(face, fromAcross, fromAlong),
    surfacePoint(face, toAcross, fromAlong),
    surfacePoint(face, toAcross, toAlong),
    surfacePoint(face, fromAcross, toAlong),
  ];
}

function faceNormal(face: Face): Vector3 {
  if (face.axis === 'column') return new Vector3(face.sign, 0, 0);
  if (face.axis === 'height') return new Vector3(0, face.sign, 0);
  return new Vector3(0, 0, face.sign);
}

function faceColor(normal: Vector3): string {
  if (normal.y > 0.55) return '#efaa70';
  if (normal.x > normal.z) return '#ca6c47';
  return '#dc8652';
}

export class BoardRenderer {
  private scale = 1;
  private originHorizontal = 0;
  private originVertical = 0;
  private shadow: SVGGElement;
  private block: SVGGElement;

  constructor(private svg: SVGSVGElement, level: Level) {
    this.shadow = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.block = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.setLevel(level);
  }

  setLevel(level: Level): void {
    const tiles: { column: number; row: number }[] = [];
    level.rows.forEach((line, row) => {
      [...line].forEach((tile, column) => {
        if (tile !== '.') tiles.push({ column, row });
      });
    });
    const minColumn = Math.min(...tiles.map((tile) => tile.column));
    const maxColumn = Math.max(...tiles.map((tile) => tile.column)) + 1;
    const minRow = Math.min(...tiles.map((tile) => tile.row));
    const maxRow = Math.max(...tiles.map((tile) => tile.row)) + 1;
    const minHorizontal = (minColumn - maxRow) * ISO_WIDTH;
    const maxHorizontal = (maxColumn - minRow) * ISO_WIDTH;
    const minVertical = (minColumn + minRow) * 0.5 - 2.2;
    const maxVertical = (maxColumn + maxRow) * 0.5 + 0.35;
    this.scale = Math.min(
      (VIEW_WIDTH - 100) / (maxHorizontal - minHorizontal),
      (VIEW_HEIGHT - 84) / (maxVertical - minVertical),
    );
    this.originHorizontal = (VIEW_WIDTH - (maxHorizontal - minHorizontal) * this.scale) / 2 - minHorizontal * this.scale;
    this.originVertical = (VIEW_HEIGHT - (maxVertical - minVertical) * this.scale) / 2 - minVertical * this.scale;

    tiles.sort((first, second) => first.column + first.row - second.column - second.row);

    const snow = [
      [48, 62, 2], [110, 117, 2.5], [186, 57, 2], [285, 96, 1.5], [407, 48, 2],
      [547, 103, 2], [648, 63, 2.5], [685, 178, 1.5], [62, 257, 1.5], [651, 306, 2],
      [97, 373, 2], [592, 400, 1.5], [202, 442, 1.5], [510, 461, 2],
    ].map(([horizontal, vertical, radius]) => `<circle cx="${horizontal}" cy="${vertical}" r="${radius}"/>`).join('');

    this.svg.innerHTML = `
      <defs>
        <linearGradient id="fox-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#1d3b49"/><stop offset="1" stop-color="#132a36"/>
        </linearGradient>
        <radialGradient id="fox-glow">
          <stop offset="0" stop-color="#7bb5ad" stop-opacity=".19"/><stop offset="1" stop-color="#7bb5ad" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="${VIEW_WIDTH}" height="${VIEW_HEIGHT}" fill="url(#fox-sky)"/>
      <ellipse cx="360" cy="285" rx="330" ry="205" fill="url(#fox-glow)"/>
      <path d="M0 413 Q106 375 209 417 T425 420 T720 408 V510 H0Z" fill="#9abeb4" opacity=".055"/>
      <g fill="#d5ebe1" opacity=".55">${snow}</g>
      <g>${tiles.map(({ column, row }) => this.tile(level, column, row)).join('')}</g>
    `;
    this.shadow = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.block = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    this.svg.append(this.shadow, this.block);
  }

  render(position: BlockPosition, rotation: Quaternion, turn?: Turn, drop = 0): void {
    const center = blockCenter(position);
    const transform = (point: Vector3): Vector3 => {
      const world = point.clone().applyQuaternion(rotation).add(center);
      if (turn) world.sub(turn.pivot).applyQuaternion(turn.rotation).add(turn.pivot);
      world.y -= drop;
      return world;
    };
    const shadowCenter = transform(new Vector3());
    shadowCenter.y = 0.01;
    const shadow = this.project(shadowCenter);
    const opacity = Math.max(0, 0.23 * (1 - drop / 3));
    this.shadow.innerHTML = `<ellipse cx="${shadow.horizontal.toFixed(2)}" cy="${shadow.vertical.toFixed(2)}" rx="${(this.scale * 0.57).toFixed(2)}" ry="${(this.scale * 0.27).toFixed(2)}" fill="#203c3c" opacity="${opacity.toFixed(2)}"/>`;

    const visibleFaces = FACES.map((face) => {
      const normal = faceNormal(face).applyQuaternion(rotation);
      if (turn) normal.applyQuaternion(turn.rotation);
      const alongExtent = face.axis === 'height' ? HALF_WIDTH : HALF_HEIGHT;
      const corners = surfaceRectangle(face, -HALF_WIDTH, -alongExtent, HALF_WIDTH, alongExtent).map(transform);
      const depth = corners.reduce((sum, point) => sum + point.x + point.y + point.z, 0) / corners.length;
      return { face, normal, corners, depth, alongExtent };
    }).filter(({ normal }) => normal.x + normal.y + normal.z > 0.001)
      .sort((first, second) => first.depth - second.depth);

    const blockOpacity = Math.max(0, 1 - drop / 2.6);
    this.block.innerHTML = `<g opacity="${blockOpacity.toFixed(3)}" stroke-linejoin="round">${visibleFaces.map(({ face, normal, corners, alongExtent }) => {
      const verticalRibbon = surfaceRectangle(face, -0.105, -alongExtent, 0.105, alongExtent).map(transform);
      const horizontalRibbon = surfaceRectangle(face, -HALF_WIDTH, -0.105, HALF_WIDTH, 0.105).map(transform);
      return `<polygon points="${this.points(corners)}" fill="${faceColor(normal)}" stroke="#9b583d" stroke-width="2.3"/>
        <polygon points="${this.points(verticalRibbon)}" fill="#f7cf80" opacity=".95"/>
        <polygon points="${this.points(horizontalRibbon)}" fill="#f7cf80" opacity=".95"/>
        <polygon points="${this.points(corners)}" fill="none" stroke="#8f553e" stroke-width="2.3"/>`;
    }).join('')}</g>`;
  }

  private project(point: Vector3): Point2D {
    return {
      horizontal: this.originHorizontal + (point.x - point.z) * ISO_WIDTH * this.scale,
      vertical: this.originVertical + ((point.x + point.z) * 0.5 - point.y) * this.scale,
    };
  }

  private points(points: Vector3[]): string {
    return points.map((point) => {
      const projected = this.project(point);
      return `${projected.horizontal.toFixed(2)},${projected.vertical.toFixed(2)}`;
    }).join(' ');
  }

  private tile(level: Level, column: number, row: number): string {
    const thickness = -0.18;
    const surface = [new Vector3(column, 0, row), new Vector3(column + 1, 0, row), new Vector3(column + 1, 0, row + 1), new Vector3(column, 0, row + 1)];
    const columnSide = [surface[1], surface[2], new Vector3(column + 1, thickness, row + 1), new Vector3(column + 1, thickness, row)];
    const rowSide = [surface[2], surface[3], new Vector3(column, thickness, row + 1), new Vector3(column + 1, thickness, row + 1)];
    const shades = ['#d6e5de', '#e1ede5', '#ccdfd9', '#dceae3'];
    const shade = shades[(column * 7 + row * 11) % shades.length];
    const sideColumn = !hasTile(level, column + 1, row) ? `<polygon points="${this.points(columnSide)}" fill="#76989a" stroke="#67888b" stroke-width="1.3"/>` : '';
    const sideRow = !hasTile(level, column, row + 1) ? `<polygon points="${this.points(rowSide)}" fill="#87a9a7" stroke="#71928f" stroke-width="1.3"/>` : '';
    let detail = '';

    if (level.goal.column === column && level.goal.row === row) {
      const inset = [new Vector3(column + 0.18, 0.012, row + 0.18), new Vector3(column + 0.82, 0.012, row + 0.18), new Vector3(column + 0.82, 0.012, row + 0.82), new Vector3(column + 0.18, 0.012, row + 0.82)];
      const center = this.project(new Vector3(column + 0.5, 0.025, row + 0.5));
      const pawScale = this.scale * 0.17;
      detail = `<polygon points="${this.points(inset)}" fill="#263e43" stroke="#e7b961" stroke-width="3"/>
        <g fill="#f7d187" transform="translate(${center.horizontal.toFixed(2)} ${center.vertical.toFixed(2)}) scale(${pawScale.toFixed(2)})">
          <ellipse cx="0" cy=".18" rx=".57" ry=".38"/><circle cx="-.65" cy="-.42" r=".21"/><circle cx="-.22" cy="-.69" r=".22"/><circle cx=".25" cy="-.68" r=".22"/><circle cx=".65" cy="-.4" r=".21"/>
        </g>`;
    }

    return `${sideColumn}${sideRow}<polygon points="${this.points(surface)}" fill="${shade}" stroke="#b2cbc4" stroke-width="1.1"/>${detail}`;
  }
}

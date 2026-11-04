export interface ScoreImage {
  blob: Blob;
  file: File | null;
  filename: string;
  text: string;
}

type Point = [number, number];

function polygon(context: CanvasRenderingContext2D, points: Point[], color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);
  points.slice(1).forEach(([horizontal, vertical]) => context.lineTo(horizontal, vertical));
  context.closePath();
  context.fill();
}

function tree(context: CanvasRenderingContext2D, horizontal: number, vertical: number, scale: number): void {
  context.fillStyle = '#a3805d';
  context.fillRect(horizontal - 9 * scale, vertical - 50 * scale, 18 * scale, 50 * scale);
  polygon(context, [
    [horizontal, vertical - 180 * scale], [horizontal - 68 * scale, vertical - 44 * scale],
    [horizontal + 68 * scale, vertical - 44 * scale],
  ], '#406c5e');
  polygon(context, [
    [horizontal, vertical - 180 * scale], [horizontal - 23 * scale, vertical - 134 * scale],
    [horizontal + 23 * scale, vertical - 134 * scale],
  ], '#d5e7d4');
}

function drawFox(context: CanvasRenderingContext2D): void {
  context.fillStyle = '#d1e5d0';
  context.beginPath();
  context.arc(540, 354, 150, 0, Math.PI * 2);
  context.fill();
  polygon(context, [[418, 260], [485, 291], [540, 277], [595, 291], [662, 260], [642, 375], [610, 431], [540, 462], [470, 431], [438, 375]], '#d9814d');
  polygon(context, [[433, 277], [479, 303], [448, 321]], '#f3b582');
  polygon(context, [[647, 277], [601, 303], [632, 321]], '#f3b582');
  polygon(context, [[443, 359], [490, 378], [540, 351], [590, 378], [637, 359], [620, 419], [540, 455], [460, 419]], '#f9ead4');
  context.fillStyle = '#263d37';
  context.beginPath();
  context.arc(493, 350, 8, 0, Math.PI * 2);
  context.arc(587, 350, 8, 0, Math.PI * 2);
  context.fill();
  polygon(context, [[528, 397], [540, 389], [552, 397], [540, 408]], '#263d37');
  context.strokeStyle = '#aa593d';
  context.lineWidth = 7;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(515, 418);
  context.quadraticCurveTo(540, 435, 565, 418);
  context.stroke();
}

function fitNumber(context: CanvasRenderingContext2D, value: string, horizontal: number, vertical: number): void {
  let size = 94;
  context.font = `800 ${size}px ui-monospace, Menlo, monospace`;
  while (context.measureText(value).width > 310 && size > 35) {
    size -= 2;
    context.font = `800 ${size}px ui-monospace, Menlo, monospace`;
  }
  context.fillText(value, horizontal, vertical);
}

export async function createScoreImage(level: number, moves: number): Promise<ScoreImage> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const context = canvas.getContext('2d');
  if (!context) return Promise.reject(new Error('Canvas is unavailable'));

  const background = context.createLinearGradient(0, 0, 1080, 1080);
  background.addColorStop(0, '#19343d');
  background.addColorStop(1, '#365f52');
  context.fillStyle = background;
  context.fillRect(0, 0, 1080, 1080);
  context.strokeStyle = '#90aa92';
  context.lineWidth = 3;
  context.strokeRect(38, 38, 1004, 1004);

  const snowflakes: Point[] = [[160, 215], [257, 347], [858, 211], [939, 389], [174, 530], [898, 552], [282, 237], [754, 326]];
  context.strokeStyle = '#d7e8d7';
  context.lineWidth = 4;
  snowflakes.forEach(([horizontal, vertical], index) => {
    const radius = index % 2 ? 6 : 11;
    context.beginPath();
    context.moveTo(horizontal - radius, vertical);
    context.lineTo(horizontal + radius, vertical);
    context.moveTo(horizontal, vertical - radius);
    context.lineTo(horizontal, vertical + radius);
    context.stroke();
  });
  tree(context, 180, 564, 1.1);
  tree(context, 900, 557, 1.2);
  tree(context, 300, 555, .55);
  tree(context, 784, 553, .6);
  drawFox(context);

  context.textAlign = 'center';
  context.fillStyle = '#edbe74';
  context.font = '800 31px ui-monospace, Menlo, monospace';
  context.fillText('MAŁA MŁAWA  ✦  ZIMOWA MISJA', 540, 108);
  context.fillStyle = '#fff6e6';
  context.font = '800 61px ui-monospace, Menlo, monospace';
  context.fillText('DROGA DO LISKA', 540, 175);
  context.font = '700 30px ui-monospace, Menlo, monospace';
  context.fillText('POMAGAM RATOWAĆ LISKA!', 540, 531);

  context.fillStyle = '#f6f1df';
  context.fillRect(108, 589, 420, 230);
  context.fillRect(552, 589, 420, 230);
  context.fillStyle = '#a45d3e';
  context.font = '800 28px ui-monospace, Menlo, monospace';
  context.fillText('PLANSZA', 318, 650);
  context.fillText('RUCHY', 762, 650);
  context.fillStyle = '#27483d';
  fitNumber(context, level.toLocaleString('pl-PL'), 318, 767);
  fitNumber(context, moves.toLocaleString('pl-PL'), 762, 767);

  context.fillStyle = '#fff6e6';
  context.font = '800 32px ui-monospace, Menlo, monospace';
  context.fillText('DOŁĄCZ DO MISJI!', 540, 905);
  context.fillStyle = '#d0e3d3';
  context.font = '700 24px ui-monospace, Menlo, monospace';
  context.fillText('MAŁA MŁAWA  ·  URATUJMY LISKA RAZEM', 540, 956);

  const filename = `mala-mlawa-plansza-${level}.png`;
  const page = new URL(location.href);
  page.search = '';
  page.hash = '';
  const text = `Pomagam ratować liska w Małej Mławie! Plansza ${level}, ruchy: ${moves}. ${page.href}`;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not create score image'));
        return;
      }
      let file: File | null = null;
      try {
        if (typeof File === 'function') file = new File([blob], filename, { type: 'image/png' });
      } catch {
        file = null;
      }
      resolve({ blob, file, filename, text });
    }, 'image/png');
  });
}

export function downloadScoreImage(image: ScoreImage): void {
  const url = URL.createObjectURL(image.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = image.filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

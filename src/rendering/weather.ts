import { ORIGIN } from '../data/geo';

type WeatherMode = 'none' | 'rain' | 'snow';
type Particle = { x: number; y: number; speed: number; size: number };

export function weatherForCode(code: number): { label: string; mode: WeatherMode } {
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label: 'Śnieg', mode: 'snow' };
  if ((code >= 51 && code <= 69) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)) return { label: 'Deszcz', mode: 'rain' };
  if (code === 45 || code === 48) return { label: 'Mgła', mode: 'none' };
  if (code === 0) return { label: 'Bezchmurnie', mode: 'none' };
  if (code >= 1 && code <= 3) return { label: 'Zachmurzenie', mode: 'none' };
  return { label: 'Zmienna pogoda', mode: 'none' };
}

export class Weather {
  private context: CanvasRenderingContext2D;
  private enabled = false;
  private mode: WeatherMode = 'none';
  private particles: Particle[] = [];
  private animation: number | null = null;
  private timer: number | null = null;
  private controller: AbortController | null = null;
  private previous = 0;
  private wind = 0;

  constructor(private canvas: HTMLCanvasElement, private onStatus: (message: string, enabled: boolean) => void) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    addEventListener('resize', this.resize);
    this.resize();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.controller?.abort();
    this.controller = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (!enabled) {
      this.setMode('none');
      this.onStatus('Pogoda na żywo wyłączona. Dane:', false);
      return;
    }
    this.onStatus('Pobieranie pogody…', true);
    void this.refresh();
  }

  private async refresh() {
    const controller = new AbortController();
    this.controller = controller;
    const params = new URLSearchParams({
      latitude: String(ORIGIN.lat), longitude: String(ORIGIN.lon),
      current: 'temperature_2m,precipitation,weather_code,wind_speed_10m', timezone: 'Europe/Warsaw',
    });
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { current?: { weather_code?: number; temperature_2m?: number; wind_speed_10m?: number } };
      if (!this.enabled || controller !== this.controller) return;
      const current = data.current;
      if (!current || !Number.isFinite(current.weather_code) || !Number.isFinite(current.temperature_2m)) throw new Error('Missing current weather');
      const weather = weatherForCode(current.weather_code!);
      const wind = Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m! : 0;
      this.wind = Math.min(20, Math.max(0, wind));
      this.setMode(weather.mode);
      this.onStatus(`${weather.label} · ${Math.round(current.temperature_2m!)}°C · Dane:`, true);
      this.timer = window.setTimeout(() => void this.refresh(), 10 * 60 * 1000);
    } catch (error) {
      if (controller.signal.aborted || !this.enabled || controller !== this.controller) return;
      this.enabled = false;
      this.setMode('none');
      this.onStatus('Nie udało się pobrać pogody. Spróbuj ponownie. Dane:', false);
    }
  }

  private setMode(mode: WeatherMode) {
    this.mode = mode;
    this.canvas.hidden = mode === 'none';
    if (mode === 'none') {
      if (this.animation !== null) cancelAnimationFrame(this.animation);
      this.animation = null;
      this.previous = 0;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.resetParticles();
    if (this.animation === null) this.animation = requestAnimationFrame(this.draw);
  }

  private resize = () => {
    this.canvas.width = Math.max(1, Math.ceil(innerWidth / 2));
    this.canvas.height = Math.max(1, Math.ceil(innerHeight / 2));
    this.resetParticles();
  };

  private resetParticles() {
    const count = Math.min(180, Math.max(35, Math.round(this.canvas.width * this.canvas.height / 1800)));
    this.particles = Array.from({ length: count }, () => ({
      x: Math.random() * this.canvas.width,
      y: Math.random() * this.canvas.height,
      speed: 0.65 + Math.random() * 0.7,
      size: Math.random() > 0.7 ? 2 : 1,
    }));
  }

  private draw = (now: number) => {
    if (!this.enabled || this.mode === 'none') { this.animation = null; return; }
    const delta = Math.min(0.06, (now - (this.previous || now)) / 1000);
    this.previous = now;
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);
    this.context.fillStyle = this.mode === 'snow' ? 'rgba(248, 251, 238, .8)' : 'rgba(198, 220, 232, .5)';
    for (const particle of this.particles) {
      particle.y += delta * particle.speed * (this.mode === 'snow' ? 24 : 180);
      particle.x += delta * (this.wind + (this.mode === 'snow' ? 5 : 20));
      if (particle.y > height + 8) { particle.y = -8; particle.x = Math.random() * width; }
      if (particle.x > width + 8) particle.x = -8;
      this.context.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, this.mode === 'snow' ? particle.size : 5);
    }
    this.animation = requestAnimationFrame(this.draw);
  };
}

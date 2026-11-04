import type { BuildingRec, Manifest } from '../data/types';
import type { ResolvedLandmark } from '../city/landmarksIndex';
import type { Season } from '../rendering/seasons';
import { h } from './dom';
import { HEIGHT_SOURCE, KIND_LABEL, functionLabel } from './labels';

export interface UIHandlers {
  onClosePanel(): void;
  onPlace(id: string): void;
  onReset(): void;
  onNight(on: boolean): void;
  onZoom(factor: number): void;
  onRotate(angle: number): void;
  onSeason(season: Season): void;
  onPixelSize(size: number): void;
  onMarkers(visible: boolean): void;
  onMotion(enabled: boolean): void;
  onLiveTime(enabled: boolean): void;
  onWeather(enabled: boolean): void;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export class UI {
  private panel = $('panel');
  private places = $('places');
  private settings = $('settings');
  private placesBtn = $<HTMLButtonElement>('btn-places');
  private settingsBtn = $<HTMLButtonElement>('btn-settings');
  private nightBtn = $<HTMLButtonElement>('btn-night');
  private liveTime = $<HTMLInputElement>('live-time');
  private liveWeather = $<HTMLInputElement>('live-weather');
  private night = false;

  constructor(private hd: UIHandlers) {
    $('btn-reset').onclick = () => hd.onReset();
    this.placesBtn.onclick = () => this.togglePlaces();
    this.settingsBtn.onclick = () => this.toggleSettings();
    this.nightBtn.onclick = () => this.setNight(!this.night, true);
    $('btn-zoom-in').onclick = () => hd.onZoom(1.4);
    $('btn-zoom-out').onclick = () => hd.onZoom(1 / 1.4);
    $('btn-rotate-left').onclick = () => hd.onRotate(-Math.PI / 2);
    $('btn-rotate-right').onclick = () => hd.onRotate(Math.PI / 2);
    this.panel.querySelector('.close')!.addEventListener('click', () => hd.onClosePanel());
    this.places.querySelector('.close')!.addEventListener('click', () => this.closeMenus());
    this.settings.querySelector('.close')!.addEventListener('click', () => this.closeMenus());
    this.settings.querySelectorAll<HTMLButtonElement>('[data-season]').forEach((button) => {
      button.onclick = () => {
        const season = button.dataset.season;
        if (season !== 'summer' && season !== 'autumn' && season !== 'winter') return;
        this.setPressed('[data-season]', button);
        hd.onSeason(season);
      };
    });
    this.settings.querySelectorAll<HTMLButtonElement>('[data-pixel]').forEach((button) => {
      button.onclick = () => {
        const size = Number(button.dataset.pixel);
        if (!Number.isFinite(size) || size < 1 || size > 3) return;
        this.setPressed('[data-pixel]', button);
        hd.onPixelSize(size);
      };
    });
    $<HTMLInputElement>('show-markers').onchange = (event) => hd.onMarkers((event.target as HTMLInputElement).checked);
    $<HTMLInputElement>('show-motion').onchange = (event) => hd.onMotion((event.target as HTMLInputElement).checked);
    this.liveTime.onchange = () => hd.onLiveTime(this.liveTime.checked);
    this.liveWeather.onchange = () => hd.onWeather(this.liveWeather.checked);
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.closeMenus();
        hd.onClosePanel();
      }
    });
  }

  setNight(on: boolean, notify = false) {
    if (notify && this.liveTime.checked) {
      this.liveTime.checked = false;
      this.hd.onLiveTime(false);
    }
    this.night = on;
    document.body.classList.toggle('night', on);
    this.nightBtn.setAttribute('aria-pressed', String(on));
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', on ? '#0b1230' : '#a9c5c6');
    if (notify) this.hd.onNight(on);
  }

  togglePlaces() {
    const show = this.places.hidden;
    this.closeMenus();
    this.places.hidden = !show;
    this.placesBtn.setAttribute('aria-expanded', String(show));
    if (show) this.panel.hidden = true;
  }

  private toggleSettings() {
    const show = this.settings.hidden;
    this.closeMenus();
    this.settings.hidden = !show;
    this.settingsBtn.setAttribute('aria-expanded', String(show));
    if (show) this.panel.hidden = true;
  }

  private closeMenus() {
    this.places.hidden = true;
    this.settings.hidden = true;
    this.placesBtn.setAttribute('aria-expanded', 'false');
    this.settingsBtn.setAttribute('aria-expanded', 'false');
  }

  private setPressed(selector: string, selected: HTMLButtonElement) {
    this.settings.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => button.setAttribute('aria-pressed', String(button === selected)));
  }

  setPlaces(list: ResolvedLandmark[]) {
    const ul = $('places-list');
    ul.replaceChildren(
      ...list.map((l) => {
        const b = h('button', {}, h('span', { text: l.lm.name }), h('small', { text: l.lm.category ?? '' }));
        b.onclick = () => {
          this.closeMenus();
          this.hd.onPlace(l.lm.id);
        };
        return h('li', {}, b);
      }),
    );
  }

  hidePanel() {
    this.panel.hidden = true;
  }

  private open(title: string, body: Node[]) {
    $('panel-title').textContent = title;
    $('panel-body').replaceChildren(...body);
    this.panel.hidden = false;
    this.closeMenus();
  }

  private facts(rec: BuildingRec): HTMLElement {
    const kv = h('dl', { class: 'kv' });
    const row = (k: string, v: string, small?: string) => kv.append(h('dt', { text: k }), h('dd', {}, v, small ? h('small', { text: ` (${small})` }) : null));
    const heightSource = rec.hs === 4 && rec.hy ? `${HEIGHT_SOURCE[4]}, dane źródłowe ${rec.hy}` : HEIGHT_SOURCE[rec.hs];
    row('Wysokość', `ok. ${Math.round(rec.h)} m`, heightSource);
    if (rec.s === 'egib') row('Obrys', 'EGiB / powiat mławski');
    if (rec.lv) row('Kondygnacje', String(rec.lv));
    if (rec.a) row('Adres', rec.a);
    const fn = functionLabel(rec.t);
    if (fn) row('Funkcja', fn);
    return kv;
  }

  private sourceLink(rec: BuildingRec) {
    if (rec.s === 'egib') return h('p', {}, h('a', { href: 'https://www.gov.pl/web/gugik/dane-egib', text: 'Źródło obrysu: EGiB ↗' }));
    const url = `https://www.openstreetmap.org/${rec.id < 0 ? 'relation' : 'way'}/${Math.abs(rec.id)}`;
    return h('p', {}, h('a', { href: url, text: 'Zobacz w OpenStreetMap ↗' }));
  }

  showBuilding(rec: BuildingRec) {
    this.open(rec.n ?? KIND_LABEL[rec.k], [
      rec.n ? h('p', { class: 'sub', text: KIND_LABEL[rec.k] }) : null,
      this.facts(rec),
      this.sourceLink(rec),
    ].filter(Boolean) as Node[]);
  }

  showLandmark(l: ResolvedLandmark, rec?: BuildingRec) {
    const body: Node[] = [];
    if (l.lm.category) body.push(h('span', { class: 'badge', text: l.lm.category }));
    if (l.lm.description) body.push(h('p', { text: l.lm.description }));
    if (rec) body.push(this.facts(rec), this.sourceLink(rec));
    this.open(l.lm.name, body);
  }

  hideLoading() {
    const el = $('loading');
    el.classList.add('done');
    setTimeout(() => el.remove(), 700);
  }

  showError(msg: string) {
    $('loading').replaceChildren(h('span', { text: msg }));
  }

  setView(lat: number, lon: number, zoom: number) {
    $('coordinates').textContent = `${lat.toFixed(4)}°N  ${lon.toFixed(4)}°E`;
    $('zoom-level').textContent = `ZOOM ${zoom.toFixed(1)}`;
  }

  setDataStatus(manifest: Manifest, lod1Count: number, lod2Count: number) {
    const date = (value?: string) => {
      if (!value || !Number.isFinite(Date.parse(value))) return undefined;
      return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(value));
    };
    const roads = date(manifest.sources?.osmRoads);
    const egib = date(manifest.sources?.egibFetched);
    const status = [`Drogi: OpenStreetMap${roads ? `, dane z ${roads}` : ''}.`];
    if (egib) status.push(`Dodatkowe obrysy: EGiB, pobrano ${egib}.`);
    if (lod1Count) status.push(`${lod1Count.toLocaleString('pl-PL')} wysokości dopasowano do modeli GUGiK LoD1 (zbiór 2024).`);
    if (lod2Count) status.push('Część dachów wykorzystuje modele GUGiK LoD2 z 2017 r.');
    status.push('Pozostałe wysokości mogą być szacowane.');
    $('data-status').textContent = status.join(' ');
  }

  setMotion(enabled: boolean) {
    $<HTMLInputElement>('show-motion').checked = enabled;
  }

  setWeatherStatus(message: string, enabled: boolean) {
    this.liveWeather.checked = enabled;
    $('weather-status').textContent = message;
  }
}

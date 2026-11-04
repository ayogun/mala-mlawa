import { Group } from 'three';
import { project } from '../data/geo';
import type { BuildingRec } from '../data/types';
import type { CameraRig } from '../interactions/controls';
import { Highlight } from '../rendering/highlight';
import { h } from '../ui/dom';
import { activeAdventOffers, dateKey, offerExpired, warsawDate } from './calendar';
import { ADVENT_OFFERS, type AdventOffer } from './offers';

interface OfferMarker {
  offer: AdventOffer;
  button: HTMLButtonElement;
  label: HTMLElement;
  x: number;
  z: number;
  building?: BuildingRec;
}

export class AdventMapMarkers {
  readonly group = new Group();
  private markers = new Map<string, OfferMarker>();
  private highlights = new Map<BuildingRec, Highlight>();
  private projection = { x: 0, y: 0, visible: false };
  private selected: AdventOffer | null = null;
  private preview = false;
  private visible = true;
  private scheduleDate = '';

  constructor(
    private container: HTMLElement,
    private findBuilding: (offer: AdventOffer) => BuildingRec | undefined,
    private onPick: (offer: AdventOffer) => void,
    private onChange: () => void,
  ) {
    this.refresh();
    document.addEventListener('visibilitychange', () => this.refreshWhenDateChanges());
    setInterval(() => this.refreshWhenDateChanges(), 60_000);
  }

  setSelected(offer: AdventOffer | null) {
    this.selected = offer;
    this.refresh();
  }

  setPreview(preview: boolean) {
    this.preview = preview;
    this.refresh();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.onChange();
  }

  offerForBuilding(building: BuildingRec): AdventOffer | undefined {
    const matches = [...this.markers.values()].filter((marker) => marker.building === building);
    return matches.find((marker) => this.isSelected(marker.offer))?.offer ?? matches[0]?.offer;
  }

  resolveBuildings() {
    for (const marker of this.markers.values()) marker.building = this.findBuilding(marker.offer);
    const selectedBuilding = [...this.markers.values()].find((marker) => this.isSelected(marker.offer))?.building;
    const buildings = new Set([...this.markers.values()]
      .map((marker) => marker.building)
      .filter((building): building is BuildingRec => !!building && building !== selectedBuilding));

    for (const [building, highlight] of this.highlights) {
      if (buildings.has(building)) continue;
      this.group.remove(highlight.group);
      highlight.dispose();
      this.highlights.delete(building);
    }
    for (const building of buildings) {
      if (this.highlights.has(building)) continue;
      const highlight = new Highlight();
      highlight.set(building);
      this.highlights.set(building, highlight);
      this.group.add(highlight.group);
    }
  }

  update(rig: CameraRig) {
    for (const marker of this.markers.values()) {
      rig.project(marker.x, (marker.building?.h ?? 0) + 5, marker.z, this.projection);
      marker.button.hidden = (!this.visible && !this.isSelected(marker.offer)) || !this.projection.visible;
      if (!marker.button.hidden) {
        marker.button.style.transform = `translate(${this.projection.x}px, ${this.projection.y}px) translate(-50%, -49px)`;
      }
    }
  }

  private isSelected(offer: AdventOffer): boolean {
    return this.selected?.day === offer.day && this.selected.business.id === offer.business.id;
  }

  private refreshWhenDateChanges() {
    const now = new Date();
    if (dateKey(warsawDate(now)) !== this.scheduleDate) this.refresh(now);
  }

  private refresh(now = new Date()) {
    this.scheduleDate = dateKey(warsawDate(now));
    const desired = new Map<string, AdventOffer>();
    for (const offer of activeAdventOffers(now).sort((first, second) => first.day - second.day)) {
      desired.set(offer.business.id, offer);
    }
    const previewOffer = this.preview && (this.selected?.example ? this.selected : ADVENT_OFFERS.find((offer) => offer.example));
    if (previewOffer && !desired.has(previewOffer.business.id)) desired.set(previewOffer.business.id, previewOffer);
    if (this.selected) desired.set(this.selected.business.id, this.selected);

    for (const [id, marker] of this.markers) {
      if (desired.has(id)) continue;
      marker.button.remove();
      this.markers.delete(id);
    }
    for (const [id, offer] of desired) {
      let marker = this.markers.get(id);
      if (!marker) {
        const pin = h('span', { class: 'advent-map-pin' }, h('span', { text: '🎁' }));
        pin.setAttribute('aria-hidden', 'true');
        const label = h('span', { class: 'advent-map-label' });
        const button = h('button', { class: 'advent-map-marker' }, pin, label);
        button.type = 'button';
        button.hidden = true;
        button.onclick = (event) => {
          event.stopPropagation();
          this.refreshWhenDateChanges();
          const current = this.markers.get(id);
          if (current?.button === button) this.onPick(current.offer);
        };
        this.container.append(button);
        marker = { offer, button, label, x: 0, z: 0 };
        this.markers.set(id, marker);
      }
      marker.offer = offer;
      const point = project(offer.business.latitude, offer.business.longitude);
      marker.x = point.x;
      marker.z = point.z;
      const status = offer.example ? 'PRZYKŁAD' : offerExpired(offer, now) ? 'ZAKOŃCZONA' : 'RABAT';
      marker.label.textContent = `${status} · ${offer.business.name}`;
      marker.button.title = `${status}: ${offer.business.name}`;
      const description = offer.example ? 'przykładową ofertę' : status === 'ZAKOŃCZONA' ? 'zakończoną ofertę' : 'ofertę';
      marker.button.setAttribute('aria-label', `Pokaż ${description}: ${offer.business.name}`);
      marker.button.classList.toggle('sponsor', !!offer.business.sponsor);
      marker.button.classList.toggle('selected', this.isSelected(offer));
    }
    this.resolveBuildings();
    this.onChange();
  }
}

import { ADVENT_OFFERS, ADVENT_YEAR, type AdventOffer } from './offers';
import { h } from '../ui/dom';

export const ADVENT_ENABLED = false;

export interface WarsawDate {
  year: number;
  month: number;
  day: number;
}

const warsawDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function warsawDate(now = new Date()): WarsawDate {
  const parts = warsawDateFormatter.formatToParts(now);
  const part = (name: Intl.DateTimeFormatPartTypes) => Number(parts.find((value) => value.type === name)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

export function dateKey(date: WarsawDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function adventDayOpen(day: number, now = new Date(), year = ADVENT_YEAR): boolean {
  if (!Number.isInteger(day) || day < 1 || day > 24) return false;
  const today = warsawDate(now);
  return today.year > year || (today.year === year && today.month === 12 && today.day >= day);
}

export function offerExpired(offer: AdventOffer, now = new Date(), year = ADVENT_YEAR): boolean {
  const lastDay = offer.validThrough ?? `${year}-12-${String(offer.day).padStart(2, '0')}`;
  return dateKey(warsawDate(now)) > lastDay;
}

export function activeAdventOffers(now = new Date(), offers = ADVENT_OFFERS): AdventOffer[] {
  return offers.filter((offer) => !offer.example && adventDayOpen(offer.day, now) && !offerExpired(offer, now));
}

export class AdventCalendar {
  private root = document.getElementById('advent-calendar')!;
  private trigger = document.getElementById('btn-advent')!;
  private grid = document.getElementById('advent-grid')!;
  private intro = document.getElementById('advent-intro')!;
  private notice = document.getElementById('advent-notice')!;
  private previewButton = document.getElementById('advent-preview')!;
  private renderedDate = '';
  private preview = false;

  constructor(
    private onPick: (offer: AdventOffer) => void,
    private onClose: () => void,
    private onPreviewChange: (preview: boolean) => void,
  ) {
    this.root.querySelector<HTMLButtonElement>('.close')!.onclick = () => this.onClose();
    this.previewButton.onclick = () => {
      this.preview = !this.preview;
      this.onPreviewChange(this.preview);
      this.render();
    };
    document.addEventListener('visibilitychange', () => this.refreshWhenDateChanges());
    setInterval(() => this.refreshWhenDateChanges(), 60_000);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open() {
    this.render();
    this.root.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');
    document.getElementById('advent-title')!.focus({ preventScroll: true });
  }

  close() {
    this.root.hidden = true;
    this.trigger.setAttribute('aria-expanded', 'false');
  }

  private refreshWhenDateChanges() {
    if (this.isOpen && dateKey(warsawDate()) !== this.renderedDate) this.render();
  }

  private render() {
    const now = new Date();
    const today = warsawDate(now);
    document.getElementById('advent-subtitle')!.textContent = `ADWENT ${ADVENT_YEAR} / LOKALNE NIESPODZIANKI`;
    this.renderedDate = dateKey(today);
    const before = today.year < ADVENT_YEAR || (today.year === ADVENT_YEAR && today.month < 12);
    const after = today.year > ADVENT_YEAR || (today.year === ADVENT_YEAR && today.month === 12 && today.day > 24);
    this.intro.textContent = this.preview
      ? 'Podgląd: otwórz przykładowy dzień. Prawdziwe oferty otwierają się w swoim terminie.'
      : before
        ? 'Pierwsze okienko otworzy się 1 grudnia.'
        : after
          ? `Kalendarz ${ADVENT_YEAR} jest zakończony. Możesz wrócić do wcześniejszych dni.`
          : 'Codziennie odkryj lokalną niespodziankę. Wcześniejsze dni też są dostępne.';

    const examples = ADVENT_OFFERS.filter((offer) => offer.example).length;
    this.notice.hidden = examples === 0;
    this.notice.textContent = examples === ADVENT_OFFERS.length
      ? 'Wersja demonstracyjna: rabaty są przykładowe, a udział pozostałych lokali nie jest potwierdzony.'
      : 'Oferty oznaczone jako przykładowe nie są aktywnymi rabatami.';
    this.previewButton.hidden = examples === 0;
    this.previewButton.setAttribute('aria-pressed', String(this.preview));
    this.previewButton.querySelector('strong')!.textContent = this.preview ? 'Zakończ podgląd' : 'Zobacz przykładowe dni';
    this.previewButton.querySelector('small')!.textContent = this.preview ? 'Wróć do kalendarza na żywo' : 'Podgląd — bez aktywnych rabatów';

    const doors = Array.from({ length: 24 }, (_, index) => {
      const day = index + 1;
      const offer = ADVENT_OFFERS.find((item) => item.day === day);
      const open = adventDayOpen(day, now);
      const previewOpen = this.preview && !!offer?.example;
      const canOpen = !!offer && (open || previewOpen);
      const isToday = today.year === ADVENT_YEAR && today.month === 12 && today.day === day;
      const sponsor = !!offer?.business.sponsor;
      const button = h('button', { class: `advent-door${sponsor ? ' sponsor' : ''}${isToday ? ' today' : ''}` });
      button.type = 'button';
      button.disabled = !canOpen;
      const state = previewOpen && !open ? 'otwórz przykład w podglądzie' : !open ? 'jeszcze zamknięte' : offer ? 'otwórz' : 'oferta w przygotowaniu';
      button.setAttribute('aria-label', `${day} grudnia${sponsor ? ', złoty dzień sponsora' : ''}, ${state}`);
      button.append(
        h('span', { class: 'advent-door-number', text: String(day) }),
        h('span', { class: 'advent-door-mark', text: isToday ? 'DZIŚ' : sponsor ? '★' : canOpen ? '✦' : '·' }),
      );
      button.onclick = () => {
        if (!offer || (!adventDayOpen(day) && !(this.preview && offer.example))) {
          this.render();
          return;
        }
        this.onPick(offer);
      };
      return button;
    });
    this.grid.replaceChildren(...doors);
  }
}

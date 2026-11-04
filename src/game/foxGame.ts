import { Quaternion } from 'three';
import { BoardRenderer, turnFor, turnPivot } from './board';
import { getLevel, getLevelName } from './generatedLevels';
import { isGoal, isSupported, roll, startingPosition, type BlockPosition, type Direction } from './logic';

const STORAGE_KEY = 'mala-mlawa-fox-game-v2';
const LEGACY_STORAGE_KEY = 'mala-mlawa-fox-game-v1';
const LEVELS_PER_PAGE = 5;
const RESCUE_GOAL = 20;

type Phase = 'playing' | 'rolling' | 'falling' | 'failed' | 'won';

interface Snapshot {
  position: BlockPosition;
  rotation: Quaternion;
  moves: number;
}

interface PointerStart {
  horizontal: number;
  vertical: number;
  id: number;
}

const element = <ElementType extends HTMLElement>(id: string): ElementType => document.getElementById(id) as ElementType;

export class FoxGame {
  private dialog = element<HTMLDialogElement>('fox-game');
  private opener = element<HTMLButtonElement>('btn-fox-game');
  private mapScene = element<HTMLButtonElement>('fox-map-scene');
  private lastOpener: HTMLButtonElement | null = null;
  private closeButton = element<HTMLButtonElement>('fox-close');
  private svg = document.getElementById('fox-board') as unknown as SVGSVGElement;
  private result = element<HTMLDivElement>('fox-result');
  private resultIcon = element<HTMLSpanElement>('fox-result-icon');
  private resultTitle = element<HTMLElement>('fox-result-title');
  private resultText = element<HTMLParagraphElement>('fox-result-text');
  private resultPrimary = element<HTMLButtonElement>('fox-result-primary');
  private resultSecondary = element<HTMLButtonElement>('fox-result-secondary');
  private undoButton = element<HTMLButtonElement>('fox-undo');
  private restartButton = element<HTMLButtonElement>('fox-restart');
  private previousLevelsButton = element<HTMLButtonElement>('fox-levels-previous');
  private nextLevelsButton = element<HTMLButtonElement>('fox-levels-next');
  private levelButtons: HTMLButtonElement[] = [];
  private board: BoardRenderer;
  private levelIndex = 0;
  private levelPageStart = 0;
  private level = getLevel(0);
  private position = startingPosition(this.level);
  private rotation = new Quaternion();
  private moves = 0;
  private phase: Phase = 'playing';
  private history: Snapshot[] = [];
  private best = new Map<number, number>();
  private storageAvailable = true;
  private animationFrame: number | null = null;
  private pointerStart: PointerStart | null = null;

  constructor() {
    this.loadProgress();
    this.levelIndex = this.completedLevels();
    this.level = getLevel(this.levelIndex);
    this.position = startingPosition(this.level);
    this.levelPageStart = Math.floor(this.levelIndex / LEVELS_PER_PAGE) * LEVELS_PER_PAGE;
    this.board = new BoardRenderer(this.svg, this.level);
    this.createLevelButtons();
    this.board.render(this.position, this.rotation);
    this.updateHud();

    this.opener.addEventListener('click', () => this.open(this.opener));
    this.mapScene.addEventListener('click', () => this.open(this.mapScene));
    this.closeButton.addEventListener('click', () => this.dialog.close());
    this.dialog.addEventListener('close', () => this.onClose());
    this.dialog.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.undoButton.addEventListener('click', () => this.undo());
    this.restartButton.addEventListener('click', () => this.startLevel(this.levelIndex));
    this.previousLevelsButton.addEventListener('click', () => this.changeLevelPage(-1));
    this.nextLevelsButton.addEventListener('click', () => this.changeLevelPage(1));
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-fox-direction]').forEach((button) => {
      button.addEventListener('click', () => {
        const direction = button.dataset.foxDirection;
        if (direction === 'up' || direction === 'right' || direction === 'down' || direction === 'left') this.move(direction);
      });
    });
    this.svg.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    this.svg.addEventListener('pointerup', (event) => this.onPointerUp(event));
    this.svg.addEventListener('pointercancel', () => { this.pointerStart = null; });
    window.addEventListener('storage', (event) => {
      if ((event.key !== STORAGE_KEY && event.key !== LEGACY_STORAGE_KEY) || !event.newValue) return;
      this.readSavedProgress(event.newValue);
      this.updateHud();
    });
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  private open(opener: HTMLButtonElement): void {
    if (this.dialog.open) return;
    this.lastOpener = opener;
    this.dialog.showModal();
    this.closeButton.focus();
  }

  private onClose(): void {
    if (this.phase === 'rolling' || this.phase === 'falling') {
      this.stopAnimation();
      this.restoreLastMove();
    }
    this.pointerStart = null;
    (this.lastOpener && !this.lastOpener.hidden ? this.lastOpener : this.opener).focus();
  }

  private createLevelButtons(): void {
    const container = element<HTMLDivElement>('fox-levels');
    this.levelButtons = Array.from({ length: LEVELS_PER_PAGE }, (_, offset) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.addEventListener('click', () => {
        const index = this.levelPageStart + offset;
        if (index !== this.levelIndex || this.phase !== 'playing') this.startLevel(index);
      });
      container.append(button);
      return button;
    });
  }

  private changeLevelPage(direction: -1 | 1): void {
    const lastPage = Math.floor(this.completedLevels() / LEVELS_PER_PAGE) * LEVELS_PER_PAGE;
    const nextPage = Math.max(0, Math.min(lastPage, this.levelPageStart + direction * LEVELS_PER_PAGE));
    if (nextPage === this.levelPageStart) return;
    this.levelPageStart = nextPage;
    this.updateHud();
    const lastVisible = Math.min(this.levelPageStart + LEVELS_PER_PAGE, this.completedLevels() + 1);
    this.announce(`Plansze od ${this.levelPageStart + 1} do ${lastVisible}.`);
  }

  private startLevel(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index > this.completedLevels()) return;
    const focusWasInResult = this.result.contains(document.activeElement);
    this.stopAnimation();
    this.levelIndex = index;
    this.levelPageStart = Math.floor(index / LEVELS_PER_PAGE) * LEVELS_PER_PAGE;
    this.level = getLevel(index);
    this.position = startingPosition(this.level);
    this.rotation = new Quaternion();
    this.moves = 0;
    this.history = [];
    this.phase = 'playing';
    this.result.hidden = true;
    this.board.setLevel(this.level);
    this.board.render(this.position, this.rotation);
    this.updateHud();
    this.announce(`Plansza ${index + 1}: ${this.level.name}. Postaw prezent pionowo na polu z łapką.`);
    if (focusWasInResult) this.focusDirections();
  }

  private move(direction: Direction): void {
    if (this.phase !== 'playing') return;
    const before: Snapshot = { position: { ...this.position }, rotation: this.rotation.clone(), moves: this.moves };
    const destination = roll(before.position, direction);
    const pivot = turnPivot(before.position, direction);
    this.history.push(before);
    this.moves += 1;
    this.phase = 'rolling';
    this.updateHud();

    this.animate(220, (progress) => {
      const eased = progress * progress * (3 - 2 * progress);
      this.board.render(before.position, before.rotation, { pivot, rotation: turnFor(direction, eased * Math.PI / 2) });
    }, () => {
      this.position = destination;
      this.rotation = turnFor(direction, Math.PI / 2).multiply(before.rotation).normalize();
      if (!isSupported(this.level, destination)) this.drop(false);
      else if (isGoal(this.level, destination)) this.drop(true);
      else {
        this.phase = 'playing';
        this.board.render(this.position, this.rotation);
        this.updateHud();
        const posture = this.position.axis === 'upright' ? 'stoi pionowo' : 'leży';
        this.announce(`Ruch ${this.moves}. Prezent ${posture}, kolumna ${this.position.column + 1}, rząd ${this.position.row + 1}.`);
      }
    });
  }

  private drop(won: boolean): void {
    this.phase = 'falling';
    this.updateHud();
    this.animate(400, (progress) => {
      this.board.render(this.position, this.rotation, undefined, progress * progress * 3);
    }, () => {
      this.phase = won ? 'won' : 'failed';
      if (won) this.completeLevel();
      else this.showFailure();
      this.updateHud();
    });
  }

  private showFailure(): void {
    this.resultIcon.textContent = '↶';
    this.resultTitle.textContent = 'Ups, prezent spadł!';
    this.resultText.textContent = 'Nic straconego. Cofnij ostatni ruch albo spróbuj od początku.';
    this.resultPrimary.textContent = 'Cofnij ruch';
    this.resultSecondary.textContent = 'Od początku';
    this.resultPrimary.onclick = () => this.undo();
    this.resultSecondary.onclick = () => this.startLevel(this.levelIndex);
    this.revealResult();
    this.announce('Prezent spadł. Cofnij ruch albo zacznij planszę od początku.');
  }

  private completeLevel(): void {
    const completedBefore = this.completedLevels();
    const previousBest = this.best.get(this.levelIndex);
    if (previousBest === undefined || this.moves < previousBest) {
      this.best.set(this.levelIndex, this.moves);
      this.saveProgress();
    }
    const completedAfter = this.completedLevels();
    const justRescued = completedBefore < RESCUE_GOAL && completedAfter >= RESCUE_GOAL;
    const progress = Math.round(Math.min(completedAfter, RESCUE_GOAL) / RESCUE_GOAL * 100);
    this.resultIcon.textContent = '✦';
    this.resultTitle.textContent = justRescued ? 'Lisek jest wolny!' : 'Udało się!';
    this.resultText.textContent = justRescued
      ? 'Ukończono misję ratunkową! Lisek i jego przyjaciele dziękują za pomoc. Możesz grać dalej.'
      : previousBest !== undefined
        ? `Plansza ukończona w ${this.moves} ${this.moves === 1 ? 'ruchu' : 'ruchach'}. Powtórki nie zwiększają postępu misji.`
        : completedAfter >= RESCUE_GOAL
          ? `Plansza ukończona w ${this.moves} ${this.moves === 1 ? 'ruchu' : 'ruchach'}. Zimowa przygoda trwa dalej!`
          : `Plansza ukończona w ${this.moves} ${this.moves === 1 ? 'ruchu' : 'ruchach'}. Twój postęp ratowania liska: ${progress}%.`;

    this.resultPrimary.textContent = 'Następna plansza';
    this.resultSecondary.textContent = 'Powtórz planszę';
    this.resultPrimary.onclick = () => this.startLevel(this.levelIndex + 1);
    this.resultSecondary.onclick = () => this.startLevel(this.levelIndex);
    this.revealResult();
    this.announce(`${this.resultTitle.textContent} ${this.resultText.textContent}`);
  }

  private revealResult(): void {
    this.result.hidden = false;
    this.resultPrimary.focus({ preventScroll: true });
  }

  private undo(): void {
    if (this.phase === 'rolling' || this.phase === 'falling' || this.phase === 'won') return;
    const focusWasInResult = this.result.contains(document.activeElement);
    this.restoreLastMove();
    if (focusWasInResult) this.focusDirections();
  }

  private restoreLastMove(): void {
    const snapshot = this.history.pop();
    if (!snapshot) return;
    this.position = snapshot.position;
    this.rotation = snapshot.rotation;
    this.moves = snapshot.moves;
    this.phase = 'playing';
    this.result.hidden = true;
    this.board.render(this.position, this.rotation);
    this.updateHud();
    this.announce('Ruch cofnięty. Spróbuj innej drogi.');
  }

  private focusDirections(): void {
    this.dialog.querySelector<HTMLButtonElement>('[data-fox-direction="up"]')?.focus({ preventScroll: true });
  }

  private completedLevels(): number {
    let completed = 0;
    while (this.best.has(completed)) completed += 1;
    return completed;
  }

  private updateHud(): void {
    const completed = this.completedLevels();
    const rescueCompleted = Math.min(completed, RESCUE_GOAL);
    const progress = Math.round(rescueCompleted / RESCUE_GOAL * 100);
    const rescued = rescueCompleted === RESCUE_GOAL;
    const progressText = `${progress} procent, ukończono ${rescueCompleted} z ${RESCUE_GOAL} plansz`;
    element('fox-level-number').textContent = String(this.levelIndex + 1).padStart(2, '0');
    element('fox-level-name').textContent = this.level.name;
    element('fox-moves').textContent = String(this.moves);
    const record = this.best.get(this.levelIndex);
    element('fox-best').textContent = record === undefined ? 'GRAJ ILE CHCESZ' : `Twój rekord: ${record} ruchów`;
    element('fox-progress-count').textContent = String(completed);
    element('fox-map-percent').textContent = `${progress}%`;
    element('fox-rescue-percent').textContent = `${progress}%`;
    element('fox-map-progress-fill').style.width = `${progress}%`;
    element('fox-rescue-progress-fill').style.width = `${progress}%`;
    for (const id of ['fox-map-progress', 'fox-rescue-progress']) {
      element(id).setAttribute('aria-valuenow', String(progress));
      element(id).setAttribute('aria-valuetext', progressText);
    }
    element('fox-rescue-count').textContent = rescued
      ? `${RESCUE_GOAL} / ${RESCUE_GOAL} plansz — lisek uwolniony!`
      : `${rescueCompleted} / ${RESCUE_GOAL} plansz do uwolnienia`;
    element('fox-story-title').textContent = rescued ? 'Lisek jest wolny!' : 'Lisek czeka na pomoc!';
    element('fox-story-text').textContent = rescued
      ? 'Dzięki Tobie leśni przyjaciele otworzyli klatkę. Graj dalej i odkrywaj kolejne plansze!'
      : `Leśni przyjaciele próbują otworzyć klatkę. Ukończ ${RESCUE_GOAL} kolejnych plansz, aby im pomóc i uwolnić liska!`;
    element('fox-invite-title').textContent = rescued ? 'Lisek jest wolny ↗' : 'Uratuj liska ↗';
    element('fox-scene-label').textContent = rescued ? 'LISEK JEST WOLNY ↗' : 'POMÓŻ LISKOWI ↗';
    this.mapScene.classList.toggle('is-rescued', rescued);
    this.mapScene.setAttribute('aria-label', rescued
      ? 'Lisek został uwolniony. Otwórz grę i graj dalej.'
      : `Lisek czeka w leśnej klatce. Twój postęp ratowania: ${progress} procent. Otwórz grę.`);
    element('fox-storage-note').textContent = this.storageAvailable
      ? 'Bez konta. Postęp zostaje tylko w tej przeglądarce.'
      : 'Bez konta. Postęp jest dostępny tylko w tej sesji.';
    this.undoButton.disabled = this.history.length === 0 || this.phase === 'rolling' || this.phase === 'falling' || this.phase === 'won';
    this.previousLevelsButton.disabled = this.levelPageStart === 0;
    this.nextLevelsButton.disabled = this.levelPageStart + LEVELS_PER_PAGE > completed;
    this.levelButtons.forEach((button, offset) => {
      const index = this.levelPageStart + offset;
      const unlocked = index <= completed;
      button.hidden = !unlocked;
      button.disabled = !unlocked;
      if (!unlocked) {
        button.textContent = '';
        button.removeAttribute('aria-current');
        button.removeAttribute('aria-label');
        button.classList.remove('completed');
        return;
      }
      const wasCompleted = this.best.has(index);
      button.textContent = String(index + 1).padStart(2, '0');
      button.classList.toggle('completed', wasCompleted);
      button.setAttribute('aria-current', index === this.levelIndex ? 'step' : 'false');
      button.setAttribute('aria-label', `Plansza ${index + 1}: ${getLevelName(index)}${wasCompleted ? ', ukończona' : ''}`);
    });
  }

  private announce(message: string): void {
    element('fox-status').textContent = message;
  }

  private loadProgress(): void {
    try {
      this.readSavedProgress(localStorage.getItem(LEGACY_STORAGE_KEY));
      this.readSavedProgress(localStorage.getItem(STORAGE_KEY));
    } catch {
      this.storageAvailable = false;
    }
  }

  private readSavedProgress(saved: string | null): void {
    if (!saved) return;
    try {
      const parsed: unknown = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') return;
      Object.entries(parsed).forEach(([key, score]) => {
        const index = Number(key);
        if (!Number.isSafeInteger(index) || index < 0 || String(index) !== key
          || typeof score !== 'number' || !Number.isSafeInteger(score) || score <= 0) return;
        const previousBest = this.best.get(index);
        if (previousBest === undefined || score < previousBest) this.best.set(index, score);
      });
    } catch {
      return;
    }
  }

  private saveProgress(): void {
    try {
      this.readSavedProgress(localStorage.getItem(LEGACY_STORAGE_KEY));
      this.readSavedProgress(localStorage.getItem(STORAGE_KEY));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(this.best)));
    } catch {
      this.storageAvailable = false;
    }
  }

  private animate(duration: number, update: (progress: number) => void, finish: () => void): void {
    this.stopAnimation();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      update(1);
      finish();
      return;
    }
    const started = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - started) / duration));
      update(progress);
      if (progress < 1) this.animationFrame = requestAnimationFrame(tick);
      else {
        this.animationFrame = null;
        finish();
      }
    };
    this.animationFrame = requestAnimationFrame(tick);
  }

  private stopAnimation(): void {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.dialog.close();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const directions: Record<string, Direction> = {
      arrowup: 'up', w: 'up', arrowright: 'right', d: 'right',
      arrowdown: 'down', s: 'down', arrowleft: 'left', a: 'left',
    };
    const direction = directions[key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    this.move(direction);
  }

  private onPointerDown(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.pointerStart = { horizontal: event.clientX, vertical: event.clientY, id: event.pointerId };
    this.svg.setPointerCapture(event.pointerId);
  }

  private onPointerUp(event: PointerEvent): void {
    const start = this.pointerStart;
    this.pointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const horizontal = event.clientX - start.horizontal;
    const vertical = event.clientY - start.vertical;
    if (Math.hypot(horizontal, vertical) < 24) return;
    const horizontalDistance = Math.abs(horizontal);
    const verticalDistance = Math.abs(vertical);
    if (Math.min(horizontalDistance, verticalDistance) > Math.max(horizontalDistance, verticalDistance) * 0.35) {
      if (vertical < 0) this.move(horizontal > 0 ? 'right' : 'up');
      else this.move(horizontal > 0 ? 'down' : 'left');
    } else if (horizontalDistance > verticalDistance) this.move(horizontal > 0 ? 'right' : 'left');
    else this.move(vertical > 0 ? 'down' : 'up');
  }
}

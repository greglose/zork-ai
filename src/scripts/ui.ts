// DOM side of the illustrated-adventure page. The controller only sees the small IfUi interface below, so the
// game logic is tested with a fake. Everything user- or game-derived goes in through textContent or properties.

export interface IfUi {
  /** Appends one turn of game text (already stripped of the echoed command and the prompt). */
  showText(text: string): void;
  /** Shows the picture, or clears it for null. */
  showImage(blob: Blob | null): void;
  showVideo(blob: Blob): void;
  /** One-line message in the picture pane (live region). */
  showNotice(message: string): void;
  /** True while a paid request is running. */
  setBusy(busy: boolean): void;
}

const MAX_BLOCKS = 200;

export interface IfElements {
  log: HTMLElement;
  input: HTMLInputElement;
  picture: HTMLElement;
  image: HTMLImageElement;
  video: HTMLVideoElement;
  placeholder: HTMLElement;
  notice: HTMLElement;
  closeVideo: HTMLButtonElement;
}

export function findElements(root: HTMLElement): IfElements {
  const q = <T extends HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`Missing ${sel}`);
    return el;
  };
  return {
    log: q('[data-log]'),
    input: q<HTMLInputElement>('[data-input]'),
    picture: q('[data-picture]'),
    image: q<HTMLImageElement>('[data-image]'),
    video: q<HTMLVideoElement>('[data-video]'),
    placeholder: q('[data-placeholder]'),
    notice: q('[data-notice]'),
    closeVideo: q<HTMLButtonElement>('[data-act="close-video"]'),
  };
}

export function createUi(els: IfElements): IfUi & { showCommand(text: string): void } {
  let imageUrl: string | null = null;
  let videoUrl: string | null = null;
  const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const dropVideo = () => {
    els.video.pause();
    els.video.removeAttribute('src');
    els.video.hidden = true;
    els.closeVideo.hidden = true;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = null;
  };

  els.closeVideo.addEventListener('click', () => {
    dropVideo();
    els.image.hidden = !imageUrl;
    els.placeholder.hidden = !!imageUrl;
    els.input.focus();
  });

  const append = (text: string, className: string): HTMLElement => {
    const block = document.createElement('p');
    block.className = className;
    block.textContent = text;
    els.log.append(block);
    while (els.log.childElementCount > MAX_BLOCKS) els.log.firstElementChild?.remove();
    els.log.scrollTop = els.log.scrollHeight;
    return block;
  };

  return {
    showText(text) {
      append(text, 'turn');
    },
    /** The player's own line, shown in the transcript only (never fed to a prompt). Hidden from the live announcement. */
    showCommand(text) {
      append(`> ${text}`, 'turn echo').setAttribute('aria-hidden', 'true');
    },
    showImage(blob) {
      dropVideo();
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      imageUrl = blob ? URL.createObjectURL(blob) : null;
      if (imageUrl) els.image.src = imageUrl;
      else els.image.removeAttribute('src');
      els.image.hidden = !imageUrl;
      els.placeholder.hidden = !!imageUrl;
      els.notice.textContent = '';
    },
    showVideo(blob) {
      dropVideo();
      videoUrl = URL.createObjectURL(blob);
      els.video.src = videoUrl;
      els.video.hidden = false;
      els.closeVideo.hidden = false;
      els.image.hidden = true;
      els.placeholder.hidden = true;
      els.notice.textContent = '';
      // Controls stay on; the clip only starts by itself when the player has not asked for less motion.
      if (!reduceMotion()) void els.video.play().catch(() => undefined);
    },
    showNotice(message) {
      els.notice.textContent = message;
    },
    setBusy(busy) {
      els.picture.setAttribute('aria-busy', String(busy));
      els.picture.dataset.busy = String(busy);
    },
  };
}

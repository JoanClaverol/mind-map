/**
 * The gallery's focusable elements, registered by the component so registry
 * commands can reach them — same pattern as canvas/layoutCache's host.
 */
export interface GalleryDom {
  root: HTMLElement;
  search: HTMLInputElement;
  newTitle: HTMLInputElement;
  newFolder: HTMLInputElement;
}

let dom: GalleryDom | null = null;

export function setGalleryDom(next: GalleryDom | null): void {
  dom = next;
}

export function getGalleryDom(): GalleryDom | null {
  return dom;
}

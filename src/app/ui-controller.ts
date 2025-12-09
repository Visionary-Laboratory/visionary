/**
 * UI event handling and user interaction management
 */

import { DOMElements, setHidden } from './dom-elements';
import { IController } from '../controls/base-controller';

export interface UICallbacks {
  onFileLoad: (file: File) => Promise<void>;
}

/**
 * Manages all UI interactions and event bindings
 */
export class UIController {
  private dom: DOMElements;
  private callbacks: UICallbacks;
  public controller: IController;
  
  // Mouse state
  private lastX = 0;
  private lastY = 0;
  private draggingL = false;
  private draggingR = false;

  constructor(dom: DOMElements, controller: IController, callbacks: UICallbacks) {
    this.dom = dom;
    this.callbacks = callbacks;
    this.controller = controller;
  }

  /**
   * Initialize all UI event listeners
   */
  bindEvents(canvas: HTMLCanvasElement): void {
    this.bindFileHandling();
    this.bindCameraControls(canvas);
    this.bindModalControls();
  }

  /**
   * File handling events (drag & drop, browse, samples)
   */
  private bindFileHandling(): void {
    // Drag & drop
    this.dom.dropZone.addEventListener("dragover", (e) => {
      e.preventDefault();
      this.dom.dropZone.classList.add("dragover");
    });
    
    this.dom.dropZone.addEventListener("dragleave", () => {
      this.dom.dropZone.classList.remove("dragover");
    });
    
    this.dom.dropZone.addEventListener("drop", async (e) => {
      e.preventDefault();
      this.dom.dropZone.classList.remove("dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) await this.callbacks.onFileLoad(file);
    });

    // Browse button
    this.dom.browseBtn.addEventListener("click", () => {
      this.dom.fileInput.click();
    });
    
    this.dom.fileInput.addEventListener("change", async () => {
      const file = this.dom.fileInput.files?.[0];
      if (file) {
        await this.callbacks.onFileLoad(file);
        this.dom.fileInput.value = "";
      }
    });

    // Toggle panel (still available)
    this.dom.togglePanelBtn?.addEventListener("click", () => {
      const panel = document.querySelector(".side-panel") as HTMLElement;
      panel?.classList.toggle("collapsed");
    });
  }

  /**
   * Camera control events (mouse, keyboard, wheel)
   */
  private bindCameraControls(canvas: HTMLCanvasElement): void {
    // Mouse events
    canvas.addEventListener("mousedown", (e) => {
      if (e.button === 0) {
        this.draggingL = true;
        this.controller.leftMousePressed = true;
      }
      if (e.button === 2) {
        this.draggingR = true;
        this.controller.rightMousePressed = true;
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });

    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) {
        this.draggingL = false;
        this.controller.leftMousePressed = false;
      }
      if (e.button === 2) {
        this.draggingR = false;
        this.controller.rightMousePressed = false;
      }
    });

    window.addEventListener("mousemove", (e) => {
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      
      if (this.draggingL || this.draggingR) {
        this.controller.processMouse(dx, dy);
      }
    });

    // Wheel event
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.controller.processScroll(e.deltaY > 0 ? 0.05 : -0.05);
    }, { passive: false });

    // Keyboard events
    window.addEventListener("keydown", (e) => {
      this.controller.processKeyboard(e.code, true);
    });
    
    window.addEventListener("keyup", (e) => {
      this.controller.processKeyboard(e.code, false);
    });

    // Context menu
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /**
   * Modal control events
   */
  private bindModalControls(): void {
    this.dom.closeError.addEventListener("click", () => {
      setHidden(this.dom.errorModal, true);
    });
  }
}
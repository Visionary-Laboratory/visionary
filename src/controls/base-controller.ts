// Base interface for camera controllers
import { PerspectiveCamera } from '../camera';

export interface IController {
  // Core update method
  update(camera: PerspectiveCamera, deltaTime: number): void;
  
  // Input processing
  processKeyboard(code: string, pressed: boolean): boolean;
  processMouse(dx: number, dy: number): void;
  processScroll(delta: number): void;
  
  // State
  leftMousePressed: boolean;
  rightMousePressed: boolean;
  userInput: boolean;
  
  // Optional methods that controllers may implement
  resetOrientation?(): void;
  getControllerType(): 'orbit' | 'fps';
}

export type ControllerType = 'orbit' | 'fps';
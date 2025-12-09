/**
 * Model Entry Interface
 * Data model definitions for Gaussian models
 */

import { PointCloud, DynamicPointCloud } from "../point_cloud";
import { FBXModelWrapper } from "./fbx-model-wrapper";

/**
 * Supported model types
 */
export type ModelType = 
  | 'ply' | 'spz' | 'ksplat' | 'splat' | 'sog' | 'compressed.ply'
  | 'onnx'
  | 'fbx';

/**
 * Model entry interface - represents a loaded Gaussian model
 */
export interface ModelEntry {
    id: string;
    name: string;
    visible: boolean;
    pointCloud: PointCloud | DynamicPointCloud | FBXModelWrapper;
    pointCount: number;
    isDynamic: boolean;
    modelType: ModelType;
    colorMode?: 'sh' | 'rgb';
    colorChannels?: number;
}

/**
 * Simplified model information (public API)
 */
export interface ModelInfo {
    id: string;
    name: string;
    visible: boolean;
    pointCount: number;
    isDynamic: boolean;
    modelType: ModelType;
    colorMode?: 'sh' | 'rgb';
    colorChannels?: number;
}


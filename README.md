# VisionaryCore

<div align="center">

![VisionaryCore Logo](public/vite.svg)

[![NPM Version](https://img.shields.io/npm/v/visionary-core?style=flat-square)](https://www.npmjs.com/package/visionary-core)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![WebGPU](https://img.shields.io/badge/WebGPU-Ready-green?style=flat-square)](https://www.w3.org/TR/webgpu/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square)](https://www.typescriptlang.org/)

**下一代 WebGPU 驱动的 3D Gaussian Splatting 渲染引擎**

[演示视频] | [在线文档](https://your-docs-url.com) | [快速开始](#快速开始) | [常见问题](#faq)

</div>

---

**VisionaryCore** 是一个基于 **WebGPU** 和 **3D Gaussian Splatting** 技术构建的高性能沉浸式 Web 3D 渲染引擎。

它旨在打破传统 3D 网格与新兴点云渲染技术的界限，通过独创的 **混合渲染管线 (Hybrid Rendering Pipeline)**，实现在同一 WebGPU 上下文中无缝融合标准 3D 模型（GLB/GLTF）与高保真 Gaussian Splatting（3DGS/4DGS）内容，并提供统一的深度遮挡与光照处理。

此外，我们还提供了一个功能强大的 [在线编辑器](https://editor-url-placeholder)（开发中），帮助用户轻松管理和编辑 3D 场景。

## ✨ 核心特性

- **🚀 原生 WebGPU 驱动**：利用 `three/webgpu` 与自定义 Compute Shader 光栅化器，实现百万级高斯粒子的高性能并行排序与渲染。
- **🎨 混合渲染架构**：自动处理高斯点云与标准 Mesh 的深度混合（Depth Compositing），完美解决遮挡问题，支持复杂的场景组合。
- **📦 统一资源加载 (Universal Loader)**：单一接口智能识别并加载多种格式：
  - **静态高斯**: PLY, SPLAT, KSplat, SPZ, SOG
  - **标准模型**: GLB, GLTF, FBX, OBJ
  - **动态高斯**: ONNX (4DGS)
- **🧠 强大的 AI 推理**：深度集成 **ONNX Runtime Web (ORT)**，支持 4D 动态高斯模型的实时解码与播放，带来电影级的动态视觉体验。
- **🛠️ 开发者友好**：提供基于 TypeScript 的模块化 API，易于集成到现有的 Web 应用中。

## 🚀 快速开始

### 1. 安装依赖

确保您的环境中已安装 [Node.js](https://nodejs.org/) (推荐 v18+)。

```bash
# 克隆仓库
git clone https://github.com/your-username/Visionary-PrePublic.git
cd Visionary-PrePublic

# 安装依赖
npm install
```

### 2. 准备资产

将您的 3D 模型文件放入 `public/models/` 目录中。

### 3. 启动开发服务器

```bash
npm run dev
```

启动成功后，访问以下地址查看示例：
👉 **http://localhost:8901/src/showcase/index.html**

## 📖 使用指南

VisionaryCore 可以轻松集成到您的项目中。以下是一个简单的初始化示例：

```typescript
import { App, initOrtEnvironment, getDefaultOrtWasmPaths } from 'visionary-core';

// 1. (可选) 配置 ONNX Runtime 环境，用于 4DGS 播放
const wasmPaths = getDefaultOrtWasmPaths();
initOrtEnvironment(wasmPaths);

// 2. 初始化应用
const app = new App();

try {
  await app.init();
  
  // 3. 加载静态高斯模型 (支持 PLY, SPLAT, KSplat 等)
  await app.loadGaussian('models/scene.ply');

  // 4. 加载 4D 动态高斯模型 (ONNX)
  await app.loadONNXModel('models/dynamic_human.onnx');

  // 5. 控制动画播放
  app.controlDynamicAnimation('start');

} catch (err) {
  console.error("Failed to initialize VisionaryCore:", err);
}
```

## 🧠 自制 4DGS 模型

VisionaryCore 支持通过 ONNX 格式加载动态 4D Gaussian Splatting 模型。

1. **训练模型**: 使用兼容的 4DGS 训练管线（如 [4DGaussians](https://github.com/hustvl/4DGaussians)）生成模型。
2. **导出 ONNX**: 将训练好的模型导出为 `.onnx` 格式。
3. **加载播放**: 使用 `app.loadONNXModel()` 加载并在 Web 端实时播放。

*(详细教程及转换脚本将在后续文档中补充)*

## 🤝 贡献与致谢

本项目深受以下开源项目的启发与支持，特此致谢：

- **[3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)**: 革命性的点云渲染技术。
- **[Three.js](https://threejs.org/)**: 强大的 Web 3D 引擎，提供了 WebGPU 后端支持。
- **[ONNX Runtime Web](https://onnxruntime.ai/)**: 使得在浏览器中运行复杂的 4DGS 推理模型成为可能。
- **[SplaTV](https://github.com/antimatter15/splat)** & **[SuperSplat](https://playcanvas.com/supersplat)**: 优秀的 Web 高斯渲染先驱。

## 📄 引用 (Citation)

如果您在研究或项目中使用了 VisionaryCore，请考虑引用：

```bibtex
@misc{visionarycore2025,
  author = {Your Name and Contributors},
  title = {VisionaryCore: High-Performance WebGPU 3D Gaussian Splatting Renderer},
  year = {2025},
  publisher = {GitHub},
  journal = {GitHub repository},
  howpublished = {\url{https://github.com/your-username/Visionary-PrePublic}}
}
```

## 📝 License

本项目采用 [MIT License](LICENSE) 许可证。

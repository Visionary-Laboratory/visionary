# VisionaryCore

<div align="center">

![VisionaryCore Logo](public/vite.svg)

[![NPM Version](https://img.shields.io/npm/v/visionary-core?style=flat-square)](https://www.npmjs.com/package/visionary-core)
[![License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)
[![WebGPU](https://img.shields.io/badge/WebGPU-Ready-green?style=flat-square)](https://www.w3.org/TR/webgpu/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square)](https://www.typescriptlang.org/)

[English](README-en.md) | [中文](README.md)

**Next-Generation WebGPU-Powered 3D Gaussian Splatting Rendering Engine**

[VisionaryEditor](https://editor-url-placeholder) | [Online Docs](https://your-docs-url.com) | [Quick Start](#quick-start) | [FAQ](#faq)

</div>

---

**VisionaryCore** is a high-performance immersive Web 3D rendering engine built on **WebGPU** and **onnx-runtime** technologies.

It aims to break the boundaries between traditional 3D meshes and emerging point cloud rendering technologies. Through an original **Hybrid Rendering Pipeline**, it seamlessly blends standard 3D models (GLB/GLTF) with high-fidelity Gaussian Splatting (3DGS/4DGS) content within the same WebGPU context, providing unified depth occlusion and lighting processing.

Additionally, we provide a powerful [Online Editor](https://editor-url-placeholder) to help users easily manage and edit 3D scenes.

## ✨ Core Features

- **🚀 Native WebGPU Powered**: Utilizes `three/webgpu` and a custom Compute Shader rasterizer to achieve high-performance parallel sorting and rendering of millions of Gaussian particles.
- **🎨 Hybrid Rendering Architecture**: Automatically handles depth mixing (Depth Compositing) between Gaussian point clouds and standard Meshes, perfectly solving occlusion issues and supporting complex scene compositions.
- **📦 Universal Asset Loader**: Single interface to intelligently identify and load multiple formats:
  - **Static Gaussians**: PLY, SPLAT, KSplat, SPZ, SOG
  - **Standard Models**: GLB, GLTF, FBX, OBJ
  - **Dynamic Gaussians**: ONNX (4DGS)
- **🧠 Powerful AI Inference**: Deeply integrated with **ONNX Runtime Web (ORT)** to support real-time decoding and playback of 4D dynamic Gaussian models, delivering cinematic dynamic visual experiences.
- **🛠️ Developer Friendly**: Provides a modular API based on TypeScript, easy to integrate into existing Web applications.

## 🚀 Quick Start

### 1. Install Dependencies

Ensure that [Node.js](https://nodejs.org/) (v18+ recommended) is installed in your environment.

```bash
# Clone the repository
git clone https://github.com/your-username/Visionary-PrePublic.git
cd Visionary-PrePublic

# Install dependencies
npm install
```

### 2. Start Development Server

```bash
npm run dev
```

After successful startup, visit the following address to view the example:
👉 **http://localhost:8901/demo/index.html**

### 3. Model Assets

You can import our provided [example assets](https://editor-url-placeholder) or your own 3DGS/4DGS assets in the page. For details on creating 4DGS assets, see [Convert to ONNX](#convert-to-onnx).

## 🧠 Convert to ONNX

This project supports rendering of various 3DGS/4DGS representations. To achieve this, trained 3D representations need to be exported to the ONNX format. This project provides conversion examples for 4DGS/Dynamic Avatar/Scaffold-GS, see [/examples](/examples/README.md) for details.

## 🤝 Contributions & Acknowledgments

This project is deeply inspired and supported by the following open source projects:

- **[3D Gaussian Splatting](https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/)**
- **[Three.js](https://threejs.org/)**
- **[ONNX Runtime Web](https://onnxruntime.ai/)**
- **[web-splat](https://github.com/KeKsBoTer/web-splat/)**
- **[image-to-line-drawing](https://github.com/luckycucu/image-to-line-drawing/)**

## 📄 Citation

If you use VisionaryCore in your research or projects, please consider citing:

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

This project is licensed under the [MIT License](LICENSE).


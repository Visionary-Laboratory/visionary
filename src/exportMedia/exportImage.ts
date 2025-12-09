import * as THREE from "three/webgpu";

// 导出图片功能
export function exportImage(renderer: THREE.WebGPURenderer, viewName?: string) {
    const canvas = renderer.domElement;
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const fileName = viewName 
        ? `Image-${viewName}-${timestamp}.png`
        : `Image-${timestamp}.png`;
    link.download = fileName;
    
    // 将canvas转换为blob并下载
    canvas.toBlob((blob) => {
        if (blob) {
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
        }
    }, 'image/png');
}
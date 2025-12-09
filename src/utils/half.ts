// Minimal float32 -> float16 (IEEE 754-2008 binary16) packer.
// Returns a JS number in [0..65535] that you can store in Uint16Array.
// High-accuracy f32 -> f16 with parametrized fallbacks.
// - 默认严格 IEEE：保留 subnormals、最近偶数舍入、溢出到 ±Inf、NaN 规范化到 0x7E00
// - 可参数化：FTZ（把半精度 subnormal 直接置 0）、RTZ（向零舍入）、溢出饱和到最大有限值、以及“老代码”的 exp 阈值复现
//
// 用法示例：
//   f32_to_f16(1e-6)                         // 严格 IEEE
//   f32_to_f16(1e-6, { ftz: true })          // 结果 subnormal->0
//   f32_to_f16(x, { emulateLegacyExpCutoff: 103 }) // 复现你旧代码的 <103 直接归零
//
// 也附了 f16_to_f32 方便回读做 AB 对比。

type F16Round = 'rne' | 'rtz';
interface F16Opts {
  round?: F16Round;             // 舍入：rne=最近偶数(默认), rtz=向零
  ftz?: boolean;                // Flush-To-Zero: 把 half 的 subnormal 直接置零（默认 false）
  saturate?: boolean;           // 溢出饱和到 0x7BFF（默认 false=到 ±Inf）
  canonicalNaN?: boolean;       // NaN 规范化到 0x7E00（默认 true）
  emulateLegacyExpCutoff?: number; // 复现“exp < cutoff 就归零”。例：传 103 复现你旧逻辑
}

// 复用的视图，避免频繁分配
const __f32 = new Float32Array(1);
const __u32 = new Uint32Array(__f32.buffer);

export function f32_to_f16(val: number, opts: F16Opts = {}): number {
  const {
    round = 'rne',
    ftz = false,
    saturate = false,
    canonicalNaN = true,
    emulateLegacyExpCutoff,
  } = opts;

  __f32[0] = val;
  const x = __u32[0] >>> 0;

  const sign = (x >>> 31) << 15;
  const exp  = (x >>> 23) & 0xFF;
  const mant = x & 0x7FFFFF;

  // NaN / Inf
  if (exp === 0xFF) {
    if (mant !== 0) return sign | (canonicalNaN ? 0x7E00 : (0x7C00 | (mant >>> 13)));
    return sign | 0x7C00;
  }

  // 复现“老代码”里太激进的归零阈值（可开关）
  if (emulateLegacyExpCutoff !== undefined && exp < emulateLegacyExpCutoff) {
    return sign; // ±0
  }

  // 非偏置指数
  const e32 = exp - 127;
  // 半精度指数（偏置 15）
  let e16 = e32 + 15;

  // 溢出：e16 >= 31
  if (e16 >= 31) {
    return sign | (saturate ? 0x7BFF : 0x7C00);
  }

  // 处理 subnormal/underflow 区间：e16 <= 0
  if (e16 <= 0) {
    // 正确阈值：如果 e16 < -10，半精度确实太小 → 0（注意这里是 < -10，而不是 < -9 或 < -8）
    if (e16 < -10 || ftz) {
      return sign;
    }
    // 生成半精度 subnormal 的 fraction，保留最近偶数
    // 把隐含的 1 带上（f32 正常数才有；f32 的 exp==0 的 subnormal 反正会更小，最终也会走到 0）
    let m = mant | 0x00800000; // 24 bits
    const shift = 14 - e16;    // ∈ [14..24]

    // 取目标 10bit
    let frac = m >>> shift;

    if (round === 'rne') {
      const mask = (1 << shift) - 1;
      const rem  = m & mask;
      const half = 1 << (shift - 1);
      // 最近偶数：大于半就进位；等于半看当前 LSB 是否为 1
      if (rem > half || (rem === half && (frac & 1))) {
        frac++;
        // subnormal 进位成 normal（极少见，但要处理）
        if (frac === 0x400) { // 1024
          // 变成最小 normal：exp=1, frac=0
          return sign | (1 << 10);
        }
      }
    }
    // rtz 不进位

    return sign | frac;
  }

  // 正常数：1..30
  let frac = mant >>> 13; // 取高 10 位
  if (round === 'rne') {
    const roundBit = (mant >>> 12) & 1; // 第 11 位
    const rest     = mant & 0xFFF;      // 低 12 位
    if (roundBit && (rest !== 0 || (frac & 1))) {
      frac++;
      if (frac === 0x400) { // 1024 -> 进位到指数
        frac = 0;
        e16++;
        if (e16 >= 31) {
          return sign | (saturate ? 0x7BFF : 0x7C00);
        }
      }
    }
  }
  // rtz 不进位

  return sign | (e16 << 10) | frac;
}

// 便于做 AB 验证：f16 -> f32
export function f16_to_f32(h: number): number {
  const sign = (h >>> 15) & 1;
  const exp  = (h >>> 10) & 0x1F;
  const mant = h & 0x3FF;

  let out: number;

  if (exp === 0) {
    if (mant === 0) {
      out = sign ? -0 : 0;
    } else {
      // subnormal: (mant / 2^10) * 2^-14
      const e = -14;
      const m = mant / 1024;
      out = (sign ? -1 : 1) * Math.pow(2, e) * m;
    }
  } else if (exp === 0x1F) {
    out = mant ? NaN : (sign ? -Infinity : Infinity);
  } else {
    const e = exp - 15;
    const m = 1 + mant / 1024;
    out = (sign ? -1 : 1) * Math.pow(2, e) * m;
  }

  __f32[0] = out;
  return __f32[0]; // 规整到 f32
}

// 批量工具：从 Float32Array 打包到 Uint16Array（可传 opts 切换策略）
export function packF16Array(src: Float32Array, opts: F16Opts = {}): Uint16Array {
  const out = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = f32_to_f16(src[i], opts);
  return out;
}

export function unpackF16Array(src: Uint16Array): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = f16_to_f32(src[i]);
  return out;
}


const coeffsPerChannel = (k: number) => (k + 1) * (k + 1);

export function makeCopySH_PackedF16(params: {
  props: string[];
  iDC0: number; iDC1: number; iDC2: number;
  k: 0|1|2|3;
  shU32: Uint32Array;              // 目标缓冲（每点 24 u32）
}) {
  const { props, iDC0, iDC1, iDC2, k, shU32 } = params;

  type RestIdx = { idx: number; order: number };
  const restIdx: RestIdx[] = [];
  for (let pi = 0; pi < props.length; ++pi) {
    const name = props[pi];
    if (name.startsWith("f_rest_")) {
      const suf = Number(name.slice("f_rest_".length));
      restIdx.push({ idx: pi, order: Number.isFinite(suf) ? suf : 1e9 + pi });
    }
  }
  restIdx.sort((a, b) => a.order - b.order);

  const needPerChan = coeffsPerChannel(k) - 1;
  const needTotal = needPerChan * 3;
  if (restIdx.length < needTotal) {
    console.warn(`[copySH_f16] f_rest_* too few: have=${restIdx.length}, need=${needTotal}. Will pad zeros.`);
  }

  // 每点 half 个数（k<=3 时固定为 48），对应 24 u32
  const halfsPerPoint = 3 + needTotal; // DC(3) + rest
  if (halfsPerPoint !== 48) {
    // 对 k<3：仍然按 48 half 的点步长写（尾部补 0），方便和 WGSL 的 array<u32,24> 直接对齐
    console.warn(`[copySH_f16] k=${k} gives ${halfsPerPoint} halfs; padding to 48 halfs for fixed 24 u32 stride.`);
  }

  // 生成 copy
// 生成 copy（按 Rust 的顺序：DC，然后每个系数 interleave 成 [R_i, G_i, B_i]）
  const copySH = (dstWordOffset: number, row: number[], print = false) => {
    const M = needPerChan;              // 每通道的高阶个数 = (k+1)^2 - 1
    const need = M * 3;                 // 总共需要的 f_rest_* 数量

    // 先把 48 个 half 填到临时缓冲（不足补 0）
    const tmp = new Uint16Array(48);
    // DC（RGB）
    tmp[0] = f32_to_f16(row[iDC0]);
    tmp[1] = f32_to_f16(row[iDC1]);
    tmp[2] = f32_to_f16(row[iDC2]);

    // 文件/属性中的 f_rest_* 顺序是 channel-first: [R0..R{M-1}, G0..G{M-1}, B0..B{M-1}]
    // 我们写成按系数 interleave： [R0,G0,B0, R1,G1,B1, ...]
    let kOut = 3;
    for (let i = 0; i < M; ++i) {
      // R_i
      {
        const srcR = restIdx[i]?.idx; // 偏移 0*M + i
        const v = (srcR !== undefined) ? row[srcR] : 0.0;
        tmp[kOut++] = f32_to_f16(v);
      }
      // G_i
      {
        const srcG = restIdx[M + i]?.idx; // 偏移 1*M + i
        const v = (srcG !== undefined) ? row[srcG] : 0.0;
        tmp[kOut++] = f32_to_f16(v);
      }
      // B_i
      {
        const srcB = restIdx[2 * M + i]?.idx; // 偏移 2*M + i
        const v = (srcB !== undefined) ? row[srcB] : 0.0;
        tmp[kOut++] = f32_to_f16(v);
      }
    }

    // 其余（到 48）补 0，保证每点固定 24 个 u32
    while (kOut < 48) tmp[kOut++] = 0;

    // 两两 half 打包到 u32
    for (let h = 0; h < 48; h += 2) {
      shU32[dstWordOffset + (h >> 1)] =
        (tmp[h] & 0xFFFF) | ((tmp[h + 1] & 0xFFFF) << 16);
    }

    if (print) {
      console.log(`SH[k=${k}] DC (f16):`, tmp[0], tmp[1], tmp[2]);
    }
  };


  // 固定 stride：每点 24 个 u32
  const wordsPerPoint = 24;
  return { copySH, wordsPerPoint };
}
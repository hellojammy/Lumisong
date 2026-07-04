// troika-three-text 不随包提供类型声明（officially untyped）
declare module 'troika-three-text';

// essentia.js 0.1.3 的 dist ES 构建不随包提供 .d.ts（package 无 types 字段）。
// analyzerEssentia.ts 用结构化接口 EssentiaApi 收窄，这里仅声明模块存在。
declare module 'essentia.js/dist/essentia-wasm.es.js' {
  // 非模块化 Emscripten Module 对象（运行时异步初始化）
  export const EssentiaWASM: Record<string, unknown>;
}
declare module 'essentia.js/dist/essentia.js-core.es.js' {
  export default class Essentia {
    constructor(wasm: unknown, isDebug?: boolean);
  }
}

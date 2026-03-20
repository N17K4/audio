import type { FlowStep } from '../components/shared/ProcessFlow';

// ─── 图像理解流程 ─────────────────────────────────────────────────────────────
export const IMG_UNDERSTAND_FLOW: FlowStep[] = [
  { label: '图片上传' },
  { label: '图像编码',    tech: 'ViT / CLIP' },
  { label: '多模态推理',  tech: 'VLM' },
  { label: '文字回答' },
];

// ─── 翻译流程 ─────────────────────────────────────────────────────────────────
export const TRANSLATE_FLOW: FlowStep[] = [
  { label: '源文本' },
  { label: '语言检测',     tech: '自动 / 手动' },
  { label: '构建 Prompt',  tech: 'Few-shot' },
  { label: 'LLM 翻译',    tech: 'OpenAI/Gemini...' },
  { label: '译文输出' },
];

// ─── 代码助手流程 ─────────────────────────────────────────────────────────────
export const CODE_FLOW: FlowStep[] = [
  { label: '代码问题' },
  { label: '语言标注',     tech: 'Language Tag' },
  { label: '上下文拼接',   tech: 'Context Window' },
  { label: 'LLM 推理',    tech: 'Code LLM' },
  { label: '代码回答' },
];

// ─── 文字生图（本地 / 云端）流程 ─────────────────────────────────────────────
export const IMG_GEN_FLOW_LOCAL: FlowStep[] = [
  { label: '提示词' },
  { label: '文本编码',    tech: 'CLIP / T5' },
  { label: '噪声采样',    tech: 'Latent' },
  { label: '扩散去噪',    tech: 'UNet / DiT' },
  { label: 'VAE 解码' },
  { label: '图像输出' },
];
export const IMG_GEN_FLOW_CLOUD: FlowStep[] = [
  { label: '提示词' },
  { label: '安全审核' },
  { label: '云端生成',    tech: 'DALL-E / Imagen' },
  { label: '图像输出' },
];

// ─── 换脸换图（FaceFusion / ComfyUI）流程 ────────────────────────────────────
export const IMG_I2I_FLOW_FACEFUSION: FlowStep[] = [
  { label: '源人脸图' },
  { label: '人脸检测',    tech: 'RetinaFace' },
  { label: '目标图/视频' },
  { label: '换脸',        tech: 'FaceFusion 3.x' },
  { label: '增强',        tech: 'GFPGAN/CodeFormer' },
  { label: '输出' },
];
export const IMG_I2I_FLOW_COMFYUI: FlowStep[] = [
  { label: '源图片' },
  { label: '参考图 / Prompt' },
  { label: '图像编码',    tech: 'VAE Encoder' },
  { label: '扩散推理',    tech: 'ComfyUI / SD' },
  { label: '图像解码',    tech: 'VAE Decoder' },
  { label: '输出图片' },
];

// ─── 视频生成（本地 Wan2.1 / 云端）流程 ──────────────────────────────────────
export const VIDEO_GEN_FLOW_LOCAL: FlowStep[] = [
  { label: '提示词 / 图片' },
  { label: '文本编码',    tech: 'CLIP / T5' },
  { label: '时序扩散',    tech: 'Wan2.1 DiT' },
  { label: 'VAE 解码' },
  { label: '帧合成',      tech: 'FFmpeg' },
  { label: '视频输出' },
];
export const VIDEO_GEN_FLOW_CLOUD: FlowStep[] = [
  { label: '提示词 / 图片' },
  { label: '云端处理',    tech: '可灵 / RunwayML' },
  { label: '异步等待',    note: '数秒至数分钟' },
  { label: '视频输出' },
];

// ─── OCR 识别（本地 GOT-OCR / 云端 VLM）流程 ─────────────────────────────────
export const OCR_FLOW_LOCAL: FlowStep[] = [
  { label: '图片 / PDF' },
  { label: '图像编码',    tech: 'ViT' },
  { label: 'OCR LLM',    tech: 'GOT-OCR 2.0' },
  { label: '文字输出' },
];
export const OCR_FLOW_CLOUD: FlowStep[] = [
  { label: '图片 / PDF' },
  { label: '图像压缩',    tech: 'Base64' },
  { label: '视觉大模型',  tech: 'GPT-4o / Gemini' },
  { label: '文字输出' },
];

// ─── 口型同步流程 ─────────────────────────────────────────────────────────────
export const LIPSYNC_FLOWS: Record<string, FlowStep[]> = {
  liveportrait: [
    { label: '人物图片' },
    { label: '关键点检测',  tech: 'FaceKeypoints' },
    { label: '驱动视频' },
    { label: '运动迁移',    tech: 'LivePortrait' },
    { label: '渲染',        tech: 'OpenCV' },
    { label: '动画输出' },
  ],
  sadtalker: [
    { label: '人物图片' },
    { label: '音频文件' },
    { label: '头部建模',    tech: '3D Morphable Model' },
    { label: '口型驱动',    tech: 'SadTalker' },
    { label: '视频输出' },
  ],
  heygen: [
    { label: '人物视频' },
    { label: '音频 / 文字' },
    { label: '云端处理',    tech: 'HeyGen API' },
    { label: '口型同步视频' },
  ],
  did: [
    { label: '人物图片' },
    { label: '音频 / 文字' },
    { label: '云端处理',    tech: 'D-ID API' },
    { label: '口型同步视频' },
  ],
};

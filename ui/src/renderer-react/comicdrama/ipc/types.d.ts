/**
 * 漫剧模块 - 类型定义
 */

export type AspectRatio = '9:16' | '16:9';
export type ShotStatus = 'pending' | 'done' | 'error';
export type Camera = 'in' | 'out' | 'left' | 'right';
export type ProjectStatus = 'draft' | 'scripted' | 'arting' | 'composed';

export interface CdCharacter {
  id: number;
  project_id: number;
  name: string;
  appearance_prompt?: string;
  seed?: number;
  ref_image_path?: string;
  lora_name?: string;
  lora_strength?: number;
  ipadapter_weight?: number;
}

export interface CdShot {
  id: number;
  project_id: number;
  idx: number;
  scene_desc?: string;
  image_prompt?: string;
  subtitle?: string;
  duration_ms: number;
  camera: Camera;
  character_id?: number | null;
  image_path?: string;
  status: ShotStatus;
  error?: string;
  recipe_json?: string;
  seed?: number;
}

export interface CdProject {
  id: number;
  title: string;
  logline?: string;
  synopsis?: string;
  style_prompt?: string;
  aspect_ratio: AspectRatio;
  bgm_path?: string;
  output_path?: string;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
  gen_config_json?: string;
  characters?: CdCharacter[];
  shots?: CdShot[];
}

export interface ComfyConfig {
  url: string;
  workflow?: string;
  negativePrompt?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  checkpoint?: string;
  vae?: string;
  baseSize?: number;
}

export interface ComfyModels {
  checkpoints: string[];
  vaes: string[];
  loras: string[];
  controlnets: string[];
  clipVisions: string[];
  upscalers: string[];
  samplers: string[];
  schedulers: string[];
  nodesPresent: {
    ipadapter: boolean;
    controlnetAux: boolean;
    controlnet: boolean;
    upscaleModel: boolean;
  };
  error?: string;
}

export interface SetupCapability {
  id: string;
  label: string;
  desc: string;
  present: boolean;
  targetDir: string;
  commands: string[];
  sizeHint: string;
}

export interface SetupManifest {
  comfyRoot: string;
  reachable: boolean;
  error?: string;
  capabilities: SetupCapability[];
}

/** 每镜生成配方(存入 cd_shots.recipe_json) */
export interface Recipe {
  mode?: 'text2img' | 'img2img';
  checkpoint?: string;
  vae?: string;
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  width?: number;
  height?: number;
  init?: { image: string; denoise?: number };
  loras?: { name: string; strength_model?: number; strength_clip?: number }[];
  controlnets?: { model: string; image: string; strength?: number; start?: number; end?: number }[];
  ipadapter?: { preset?: string; image: string; weight?: number };
  upscale?: { model: string; factor?: number };
}

export interface PickAssetResult {
  path?: string;
  width?: number | null;
  height?: number | null;
  canceled?: boolean;
  error?: string;
}

export interface SubtitleStyle {
  fontSize?: number;
  color?: string;
  boxOpacity?: number;
  position?: 'bottom' | 'top' | 'center';
  margin?: number;
}

export interface ComposeOptions {
  fps?: number;
  crf?: number;
  bgmVolume?: number;
  resolution?: { width?: number; height?: number; short?: number };
  subtitle?: SubtitleStyle;
}

export type GenerateArtOnly = 'failed' | 'pending' | number[];

export interface ArtProgress {
  projectId: number;
  shotId: number;
  idx: number;
  total: number;
  percent: number;
}

export interface ShotUpdated {
  projectId: number;
  shotId: number;
  status: ShotStatus;
  imagePath?: string;
  error?: string;
}

export interface ComicDramaAPI {
  getComfyConfig: () => Promise<ComfyConfig>;
  saveComfyConfig: (patch: Partial<ComfyConfig>) => Promise<ComfyConfig>;
  pingComfy: (url?: string) => Promise<{ ok: boolean; status?: number; error?: string }>;
  listModels: (url?: string) => Promise<ComfyModels>;
  checkSetup: (url?: string) => Promise<SetupManifest>;
  pickAsset: (projectId: number, kind?: 'ref' | 'pose') => Promise<PickAssetResult>;

  listProjects: () => Promise<CdProject[]>;
  getProject: (projectId: number) => Promise<CdProject>;
  deleteProject: (projectId: number) => Promise<{ success: boolean }>;
  updateProject: (projectId: number, fields: Partial<Pick<CdProject, 'title' | 'logline' | 'synopsis' | 'style_prompt' | 'aspect_ratio' | 'bgm_path' | 'gen_config_json'>>) => Promise<CdProject>;
  generateScript: (params: { logline: string; style?: string; aspect: AspectRatio; shotCount?: number }) => Promise<CdProject & { error?: string }>;
  regenerateScript: (params: { projectId: number; logline?: string; style?: string; aspect?: AspectRatio; shotCount?: number }) => Promise<CdProject & { error?: string }>;

  addCharacter: (projectId: number, fields: Partial<Pick<CdCharacter, 'name' | 'appearance_prompt' | 'seed' | 'ref_image_path' | 'lora_name' | 'lora_strength' | 'ipadapter_weight'>>) => Promise<CdProject>;
  updateCharacter: (characterId: number, fields: Partial<Pick<CdCharacter, 'name' | 'appearance_prompt' | 'seed' | 'ref_image_path' | 'lora_name' | 'lora_strength' | 'ipadapter_weight'>>) => Promise<CdProject>;
  deleteCharacter: (characterId: number) => Promise<CdProject>;

  updateShot: (shotId: number, fields: Partial<Pick<CdShot, 'scene_desc' | 'image_prompt' | 'subtitle' | 'duration_ms' | 'camera' | 'character_id' | 'recipe_json' | 'seed'>>) => Promise<CdShot>;
  addShot: (projectId: number, fields?: Partial<Pick<CdShot, 'scene_desc' | 'image_prompt' | 'subtitle' | 'duration_ms' | 'camera' | 'character_id'>>) => Promise<CdProject>;
  deleteShot: (shotId: number) => Promise<CdProject>;
  reorderShots: (projectId: number, orderedIds: number[]) => Promise<CdProject>;
  generateArt: (projectId: number, only?: GenerateArtOnly) => Promise<{ started?: boolean; total?: number; error?: string }>;
  cancelArt: (projectId: number) => Promise<{ success: boolean }>;
  generateShot: (shotId: number) => Promise<{ started?: boolean; error?: string }>;

  compose: (projectId: number, options?: ComposeOptions) => Promise<{ started?: boolean; error?: string }>;
  cancelCompose: (projectId: number) => Promise<{ success: boolean }>;
  pickBgm: (projectId?: number) => Promise<{ path?: string; canceled?: boolean }>;

  onArtProgress: (cb: (data: ArtProgress) => void) => () => void;
  onShotUpdated: (cb: (data: ShotUpdated) => void) => () => void;
  onArtDone: (cb: (data: { projectId: number; error?: string }) => void) => () => void;
  onComposeProgress: (cb: (data: { projectId: number; percent: number }) => void) => () => void;
  onComposeDone: (cb: (data: { projectId: number; output: string }) => void) => () => void;
  onComposeError: (cb: (data: { projectId: number; error: string }) => void) => () => void;
}

declare global {
  interface Window {
    comicDrama?: ComicDramaAPI;
  }
}

/**
 * 漫剧 Phase 2 本地能力清单
 * 交叉比对 ComfyUI 已装模型/自定义节点, 列出「角色一致性/画质」所需能力的缺失项,
 * 给出目标目录与手动下载命令(绝不自动安装/下载)。
 */

const DEFAULT_COMFY_ROOT = '/Users/bgd/repo/ComfyUI';

const hasMatch = (arr, re) => Array.isArray(arr) && arr.some((n) => re.test(String(n)));

/**
 * @param {object} models listModels() 结果(含 nodesPresent), 或 { error }
 * @param {object} [config] getComfyConfig()(可含 comfyRoot)
 * @returns {{ comfyRoot:string, reachable:boolean, error?:string, capabilities:Array }}
 */
export function buildSetupManifest(models, config) {
  const root = (config?.comfyRoot || DEFAULT_COMFY_ROOT).replace(/\/+$/, '');
  const nodesDir = `${root}/custom_nodes`;
  const modelsDir = `${root}/models`;

  if (!models || models.error) {
    return { comfyRoot: root, reachable: false, error: models?.error || '无法连接 ComfyUI', capabilities: [] };
  }

  const np = models.nodesPresent || {};
  const capabilities = [
    {
      id: 'controlnet_openpose',
      label: '姿态控制(OpenPose ControlNet)',
      desc: '用骨架图约束人物姿态, 跨镜保持构图/动作一致',
      present: hasMatch(models.controlnets, /openpose/i),
      targetDir: `${modelsDir}/controlnet`,
      commands: [
        `cd "${modelsDir}/controlnet" && \\`,
        `  curl -L -o control_v11p_sd15_openpose.pth \\`,
        `  https://huggingface.co/lllyasviel/ControlNet-v1-1/resolve/main/control_v11p_sd15_openpose.pth`,
      ],
      sizeHint: '~1.4 GB',
    },
    {
      id: 'controlnet_aux',
      label: '姿态自动提取(controlnet_aux 预处理器)',
      desc: '从任意照片自动提取 OpenPose 骨架(无需手工准备骨架图)',
      present: !!np.controlnetAux,
      targetDir: nodesDir,
      commands: [
        `cd "${nodesDir}" && \\`,
        `  git clone https://github.com/Fannovel16/comfyui_controlnet_aux && \\`,
        `  cd comfyui_controlnet_aux && pip install -r requirements.txt`,
      ],
      sizeHint: '节点+首次运行拉取预处理模型',
    },
    {
      id: 'ipadapter',
      label: '人脸/风格一致性(IPAdapter)',
      desc: '用参考图锁定角色长相与画风, 跨镜脸部稳定(含 FaceID)',
      present: !!np.ipadapter && hasMatch(models.clipVisions || [], /.+/),
      targetDir: `${nodesDir} + ${modelsDir}/ipadapter + ${modelsDir}/clip_vision`,
      commands: [
        `cd "${nodesDir}" && \\`,
        `  git clone https://github.com/cubiq/ComfyUI_IPAdapter_plus`,
        `mkdir -p "${modelsDir}/ipadapter" "${modelsDir}/clip_vision"`,
        `curl -L -o "${modelsDir}/ipadapter/ip-adapter-plus_sd15.safetensors" \\`,
        `  https://huggingface.co/h94/IP-Adapter/resolve/main/models/ip-adapter-plus_sd15.safetensors`,
        `curl -L -o "${modelsDir}/clip_vision/CLIP-ViT-H-14.safetensors" \\`,
        `  https://huggingface.co/h94/IP-Adapter/resolve/main/models/image_encoder/model.safetensors`,
      ],
      sizeHint: 'IPAdapter ~100 MB + CLIP-Vision ~2.5 GB',
    },
    {
      id: 'upscale_anime',
      label: '动漫放大(Upscale)',
      desc: '成片前 2~4x 高清放大, 细节更锐利',
      present: hasMatch(models.upscalers, /anime|realesr|4x/i),
      targetDir: `${modelsDir}/upscale_models`,
      commands: [
        `cd "${modelsDir}/upscale_models" && \\`,
        `  curl -L -o RealESRGAN_x4plus_anime_6B.pth \\`,
        `  https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth`,
      ],
      sizeHint: '~18 MB',
    },
  ];

  return { comfyRoot: root, reachable: true, capabilities };
}

/** 便捷入口: 拿 listModels 结果算清单 */
export function checkSetup(models, config) {
  return buildSetupManifest(models, config);
}

export default { checkSetup, buildSetupManifest };

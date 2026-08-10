---
name: comfyui-local-api
description: "Use this skill when working with a local ComfyUI repository or running ComfyUI server: inspect supported generation capabilities, discover node schemas, submit workflows through the HTTP/WebSocket API, upload or fetch images/videos/assets, manage queue/history/jobs, or generate API-oriented ComfyUI workflow guidance for another agent."
---

# ComfyUI Local API

Use the local repository and running server as the source of truth. ComfyUI capabilities are model, node, template, and custom-node dependent, so always discover runtime node schemas and model lists before generating or submitting a workflow.

## Server Address and Memory

- Require a ComfyUI server address from the user when no verified address is already available in global memory. Do not guess LAN/private URLs.
- If a remembered ComfyUI address exists, try it first. Verify it with `GET <base>/api/system_stats` and at least one capability call such as `GET <base>/api/object_info` or `GET <base>/api/models` before relying on it.
- When the user provides a ComfyUI address and the API test succeeds, immediately save it to global memory as a `reference` memory and add it to `/Users/bgd/.moss/memory/MEMORY.md`, so future runs can use it directly.
- If the remembered address fails, ask the user for a current ComfyUI address instead of retrying blindly.

## Workflow

1. Read `references/api.md` when you need endpoint details, workflow JSON shape, or capability mapping.
2. Resolve and verify the ComfyUI base address using the Server Address and Memory rules above.
3. Call `GET /api/object_info` for node schemas and `GET /api/models` or `GET /api/experiment/models` for available model files.
4. For reusable tasks, prefer existing workflow templates under `blueprints/` and adapt their widgets/nodes rather than inventing a full graph from memory.
5. Submit API prompt graphs with `POST /api/prompt`, then monitor `/api/queue`, `/api/history/{prompt_id}`, `/api/jobs/{job_id}`, or `/ws`.
6. Use `/api/upload/image` for input images and `/api/view` or asset endpoints to fetch outputs.

## Safety

Do not trigger remote API nodes, model downloads, feedback, telemetry, or other internet-facing behavior unless the user explicitly authorizes it. Core ComfyUI is local-first, but optional API nodes can call external services.

## Video Generation Rules

- When the user asks for a short video, generate the video through ComfyUI nodes and outputs. Do not use local `ffmpeg`, ImageMagick, OpenCV, shell video encoders, or other non-Comfy local composition tools unless the user explicitly asks for that fallback.
- Do not present a repeated still image or static slideshow as a generated short video unless the user explicitly requested a slideshow. If falling back to storyboards, clearly label it as a storyboard/slideshow, not continuous motion video.
- For continuous motion, prefer installed local video workflows/models such as Wan, LTXV, Hunyuan Video, SVD, or other discovered local video nodes. Verify all required model files, VAE/text encoders/CLIP vision files, LoRAs, and node schemas before submitting.
- If the intended video model fails, report the exact failing node and error, then diagnose model/VAE/node mismatch before switching approach.

## Manga Short-Drama Generation

When the user asks for 漫剧, manga drama, comic short, or similar, treat it as a short-drama production task, not a single image task. Follow the principle: **first lock the framework, then control details, then render consistently**.

### Standard Production Flow

1. **Pre-production / 基础定位**
   - Lock the genre and visual style: anime, semi-realistic, thick paint, chibi, healing, comedy, revenge, romance, suspense, etc.
   - Lock episode specs: duration, shot count, aspect ratio, fps, target resolution. Default manga short-drama output should be vertical 9:16; use 720x1280 for fast tests and 1080x1920 for final output when models/resources allow.
   - Keep core characters small, preferably 1-3. More core characters make consistency harder.

2. **Fast demo / Demo 初稿**
   - First generate 3-5 low-cost style/atmosphere demo images to validate visual tone, color, lighting, scene mood, and model suitability.
   - Do not optimize faces, actions, or dialogue during demo. The demo only decides global look and atmosphere.
   - Use the selected demo/style image as the style reference for later shots when reference nodes are available.

3. **Storyboard script / 分镜剧本**
   - Every shot must map to visible content. Use this schema: `shot number | duration | shot type | scene + character action + expression | dialogue/subtitle | sound/effect note`.
   - Keep one shot to one action and one emotion. Avoid packing multiple actions into a single prompt.
   - Alternate shot types: establishing shot, medium shot, close-up, detail shot, reaction shot, action shot. Avoid repetitive framing.
   - Preserve continuity anchors: the end action/position of one shot should logically connect to the start of the next shot.

4. **Character bible / 人物规划**
   - Create a fixed character profile for every recurring character: age, face shape, eyes, hair, skin tone, clothing, height, temperament, color palette, props, and unique visual identifiers.
   - For consistency, prefer character reference images plus IP-Adapter, Reference Only, CLIP vision, LoRA, ControlNet, or equivalent discovered nodes when available.
   - Keep model, seed strategy, CFG range, outfit colors, skin tone, and lighting stable. Do not change models casually between shots.
   - For two-character scenes, define standing positions, gaze direction, distance, and interaction explicitly.

5. **Action coordination / 动作协调**
   - Describe one precise action per shot: e.g. “raises head in surprise”, not “raises head, waves, steps back, smiles”.
   - Add body-quality constraints in negative prompts: distorted limbs, bad hands, extra fingers, broken anatomy, twisted body.
   - Use OpenPose/pose/control nodes when available for important actions, especially two-person interaction, running, grabbing, collision, fighting, or emotional close-ups.
   - Match action scale to emotion: calm scenes use subtle motion (blink, head turn, slight smile); conflict scenes use larger motion (step back, reach out, turn around, run).

6. **Subtitles/dialogue / 字幕规范**
   - Use ComfyUI subtitle/text nodes such as `TextOverlay` when available. Keep subtitle rendering in ComfyUI unless the user authorizes external post-production.
   - Default subtitle style: bottom-center, white text, thin black outline, consistent font size, no flashy effects.
   - Keep dialogue short. Prefer one line under 12 Chinese characters for character speech. Use smaller/light-gray style for narration if supported.
   - Ensure subtitles do not cover faces or key actions. For vertical video, keep them near the lower safe area.

7. **Global consistency pass / 全局一致性**
   - Check all generated shots for: visual style, color tone, character face/hair/outfit, lighting direction, subtitle position, and resolution.
   - If batch color/LUT/upscale nodes exist, use consistent settings across all shots instead of manually varying each shot.
   - Reject or regenerate frames with character drift, wrong outfit, broken hands, missing props, wrong scene continuity, or unreadable/shifted subtitles.

8. **Final assembly / 成片合成**
   - Compose in ComfyUI: shot ordering -> per-shot duration -> transitions if Comfy nodes exist -> subtitle timing/appearance -> final `CreateVideo`/`SaveVideo` or equivalent discovered video save node.
   - Do not use local `ffmpeg` for assembly unless explicitly authorized.
   - Default final output: MP4, 9:16, 30 fps, 1080x1920 when feasible. For fast proof of concept: 720x1280 or model-appropriate lower resolution.

### Required Planning Output Before Generation

Before submitting a manga short-drama workflow, produce a concise production plan containing:

- Title and one-sentence premise.
- Genre/style, aspect ratio, duration, fps, and expected shot count.
- Character bible for each recurring character.
- Shot table using `shot | seconds | framing | visual/action | subtitle/dialogue | continuity note`.
- Consistency strategy: reference image/seed/model/control nodes to use.
- Video strategy: continuous video model per shot (preferred) or clearly labeled storyboard video fallback if true I2V/T2V is unavailable.

### Quick Proof-of-Concept Requirements

For a quick test, generate a coherent 4-6 shot mini-drama, not a single image. It must include:

- Multiple planned shots.
- Visible story progression.
- At least one character action change per shot.
- Subtitles/dialogue or narration.
- A stated consistency strategy.
- ComfyUI-only final video output.

### Production-Quality Preferred Pipeline

`style demo -> character reference sheet -> storyboard table -> keyframe per shot -> image-to-video per shot with character/reference controls -> ComfyUI stitch/merge -> subtitle overlay -> final SaveVideo`.

If true continuous motion models are unavailable or fail, report the exact missing model/node/error and ask whether the user wants to install missing local models or accept a clearly labeled storyboard-video fallback.

## Key Rules

- Treat `/api/object_info` as the authoritative node interface at runtime.
- Remember that most legacy routes are also mounted with `/api` by `server.py`; prefer the `/api` form for agents.
- Do not submit frontend canvas workflow JSON directly to `/api/prompt`; submit the API prompt map shape described in `references/api.md`.
- Use `client_id` with WebSocket clients so execution events and previews can be correlated.
- Check installed models before promising text-to-image, image-to-video, text-to-video, audio, or 3D execution.
- Before claiming a video is a real short drama, verify it has multiple planned shots or continuous generated motion, plus story/action/subtitle elements when requested.

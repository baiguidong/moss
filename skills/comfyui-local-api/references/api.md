# ComfyUI Local API Reference

This reference is based on the local repository files `README.md`, `server.py`, `openapi.yaml`, `nodes.py`, `app/*`, `api_server/*`, and `blueprints/*`.

## Capability Summary

ComfyUI is a node-graph engine for AI content creation. The local README and bundled blueprints show support for:

- Text to image: yes. Blueprint examples include `blueprints/Text to Image.json`, Flux, Qwen Image, Z Image, Ernie Image, Anima, Ideogram, and others.
- Image to video: yes. Blueprint examples include `blueprints/Image to Video (Wan 2.2).json` and `blueprints/Image to Video (LTX-2.3).json`.
- Text to video: yes. Blueprint examples include `blueprints/Text to Video (Wan 2.2).json` and `blueprints/Text to Video (LTX-2.3).json`.
- Image editing: yes. Includes inpaint, outpaint, image edit, background removal, segmentation, upscaling, depth/pose/control workflows.
- Video processing: yes. Includes video edit, inpaint, segmentation, captioning, depth estimation, pose maps, stitch/merge, frame interpolation, upscale.
- Audio generation: yes. Blueprint examples include Stable Audio and ACE-Step.
- 3D: yes. Blueprint examples include image to model and Gaussian splat.
- Model families listed locally include SD1.x/2.x, SDXL, Stable Cascade, SD3/3.5, PixArt, AuraFlow, HunyuanDiT, Flux, Lumina, HiDream, Qwen Image, Hunyuan Image, Wan, LTX, Hunyuan Video, Stable Video Diffusion, Stable Audio, Hunyuan3D, and API-node backed models.

Actual execution requires installed model files and available nodes. Discover them at runtime.

## Runtime Discovery

Use these first:

```text
GET /api/object_info
GET /api/object_info/{node_class}
GET /api/models
GET /api/models/{folder}
GET /api/experiment/models
GET /api/experiment/models/{folder}
GET /api/features
GET /api/system_stats
```

`/api/object_info` returns one entry per registered node:

```json
{
  "KSampler": {
    "input": {"required": {}, "optional": {}},
    "input_order": {"required": ["model", "seed"]},
    "output": ["LATENT"],
    "output_name": ["LATENT"],
    "name": "KSampler",
    "display_name": "KSampler",
    "description": "",
    "python_module": "nodes",
    "category": "sampling",
    "output_node": false
  }
}
```

Core node registration is in `nodes.py` via `NODE_CLASS_MAPPINGS`. Custom nodes are loaded into the same mapping when their modules expose `NODE_CLASS_MAPPINGS` or Comfy API entrypoints.

## Workflow Submission Contract

Use `POST /api/prompt` with an API prompt graph, not the frontend canvas JSON from `blueprints/` or saved workflows.

Minimal request shape:

```json
{
  "client_id": "agent-session-id",
  "prompt_id": "optional-canonical-lowercase-uuid",
  "prompt": {
    "1": {
      "class_type": "CheckpointLoaderSimple",
      "inputs": {"ckpt_name": "model.safetensors"}
    },
    "2": {
      "class_type": "CLIPTextEncode",
      "inputs": {"clip": ["1", 1], "text": "positive prompt"}
    }
  },
  "extra_data": {
    "workflow": {}
  }
}
```

Node input links are two-item arrays: `[source_node_id, output_index]`. Literal widget values are plain JSON values. The server validates node IDs, class names, required inputs, types, and output targets before queueing.

Successful response:

```json
{
  "prompt_id": "uuid",
  "number": 1,
  "node_errors": {}
}
```

Validation failure returns HTTP 400 with `error` and `node_errors`.

## Typical Local Generation Flow

1. Start or locate the server, usually `http://127.0.0.1:8188`.
2. Connect `GET /ws?clientId=<id>` if live progress or previews are needed.
3. Discover nodes and models with `/api/object_info` and model endpoints.
4. Upload source images with `/api/upload/image` if doing img2img or image-to-video.
5. Build an API prompt map using discovered node schemas.
6. Submit `POST /api/prompt`.
7. Monitor `/api/queue`, `/api/jobs/{prompt_id}`, `/api/history/{prompt_id}`, and WebSocket messages.
8. Fetch outputs using `/api/view?filename=...&type=output&subfolder=...` or asset endpoints if enabled.

## WebSocket

```text
GET /ws?clientId=<id>
```

Initial message from server includes:

```json
{"type": "status", "data": {"status": {"exec_info": {"queue_remaining": 0}}, "sid": "..."}}
```

Client may send a first JSON message of type `feature_flags`. Server messages include status, executing node, execution progress, executed outputs, binary image previews, and feature flag negotiation. Use the same `client_id` in `/api/prompt` to correlate events.

## Endpoint Notes

`server.py` mounts most legacy routes twice: the original path and an `/api`-prefixed path. Prefer `/api/*`. Routes that already start with `/api`, asset routes, `/internal/*`, `/health`, and static routes are exceptions.

### Core Runtime

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/prompt` | Current queue/execution summary. |
| POST | `/api/prompt` | Validate and enqueue an API prompt graph. |
| GET | `/api/queue` | Running and pending queue items. |
| POST | `/api/queue` | Clear queue or delete queued prompt IDs. |
| POST | `/api/interrupt` | Interrupt current job, optionally by `prompt_id`. |
| POST | `/api/free` | Request model unload and/or memory cleanup. |
| GET | `/api/history` | Execution history, optional `max_items` and `offset`. |
| GET | `/api/history/{prompt_id}` | History for a prompt ID. |
| POST | `/api/history` | Clear or delete history entries. |
| GET | `/api/jobs` | Job list with filtering, sorting, limit, and offset. |
| GET | `/api/jobs/{job_id}` | Job details. |
| POST | `/api/jobs/{job_id}/cancel` | Cancel one job. |
| POST | `/api/jobs/cancel` | Cancel multiple jobs with `{"job_ids": [...]}`. |
| GET | `/api/job/{job_id}/status` | Deprecated status endpoint listed in OpenAPI. |
| GET | `/ws` | WebSocket execution/progress channel. |

### Node, Model, and Feature Discovery

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/object_info` | All registered node schemas. |
| GET | `/api/object_info/{node_class}` | One registered node schema. |
| GET | `/api/models` | Available model folder types. |
| GET | `/api/models/{folder}` | Model filenames in one folder. |
| GET | `/api/experiment/models` | Model folders with paths and extensions. |
| GET | `/api/experiment/models/{folder}` | Model files with metadata. |
| GET | `/api/experiment/models/preview/{folder}/{path_index}/{filename}` | Model preview image. |
| GET | `/api/embeddings` | Embedding names without extension. |
| GET | `/api/extensions` | Frontend extension JS paths. |
| GET | `/api/features` | Server feature flags. |
| GET | `/api/system_stats` | System, device, VRAM, and Python stats. |
| GET | `/api/node_replacements` | Node replacement mappings. |
| GET | `/api/global_subgraphs` | Available subgraph blueprints. |
| GET | `/api/global_subgraphs/{id}` | One subgraph blueprint. |
| GET | `/api/workflow_templates` | Custom-node workflow template index. |
| GET | `/api/i18n` | Custom-node translation strings. |

### Files, Images, and Outputs

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/upload/image` | Multipart upload into input/temp/output. Fields include `image`, optional `type`, `subfolder`, `overwrite`. |
| POST | `/api/upload/mask` | Multipart mask upload; updates alpha against `original_ref`. |
| GET | `/api/view` | Fetch image/output by `filename`, optional `type`, `subfolder`, `preview`, `channel`. |
| GET | `/api/view_metadata/{folder_name}` | Read safetensors metadata for model files. Code-scanned route. |
| GET | `/api/files/mask-layers` | Related mask layer files. Listed in OpenAPI. |
| GET | `/internal/files/{directory_type}` | Internal list of visible input/output/temp files. |

### User Data and Settings

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/users` | User storage info or multi-user map. |
| POST | `/api/users` | Create multi-user profile. |
| GET | `/api/user` | Current user info. Listed in OpenAPI. |
| GET | `/api/userdata` | List userdata files. |
| GET | `/api/v2/userdata` | Structured userdata directory listing. Code-scanned route. |
| GET | `/api/userdata/{file}` | Fetch userdata file. |
| POST | `/api/userdata/{file}` | Upload/update userdata file. |
| DELETE | `/api/userdata/{file}` | Delete userdata file. |
| POST | `/api/userdata/{file}/move/{dest}` | Move/rename userdata file. |
| GET | `/api/userdata/{file}/publish` | Publish info for a workflow file. Listed in OpenAPI. |
| POST | `/api/userdata/{file}/publish` | Publish a workflow file. Listed in OpenAPI. |
| GET | `/api/settings` | All settings. |
| POST | `/api/settings` | Merge settings. |
| GET | `/api/settings/{id}` | One setting. |
| POST | `/api/settings/{id}` | Set one setting. |

### Assets

Asset routes are registered only when the assets system is enabled; otherwise they return disabled errors.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/assets` | List assets. |
| POST | `/api/assets` | Upload/create asset from multipart body. |
| GET | `/api/assets/{id}` | Asset details. |
| PUT | `/api/assets/{id}` | Update asset metadata. |
| DELETE | `/api/assets/{id}` | Delete asset reference. |
| GET | `/api/assets/{id}/content` | Download asset content. |
| HEAD | `/api/assets/hash/{hash}` | Test content hash existence. Code-scanned route. |
| POST | `/api/assets/from-hash` | Create an asset reference from an existing hash. |
| POST | `/api/assets/{id}/tags` | Add tags. |
| DELETE | `/api/assets/{id}/tags` | Remove tags. |
| GET | `/api/assets/tags/refine` | Tag histogram for filtered assets. |
| GET | `/api/tags` | List tags. |
| POST | `/api/assets/seed` | Scan/seed assets from filesystem. |
| GET | `/api/assets/seed/status` | Scan status. |
| POST | `/api/assets/seed/cancel` | Cancel scan. |
| POST | `/api/assets/prune` | Mark missing backing files. |

### Workflows, Tasks, Feedback, Health, Internal

These are listed in `openapi.yaml`; some are cloud/frontend/product surfaces rather than core generation calls.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/workflows` | List saved workflows. |
| POST | `/api/workflows` | Create workflow. |
| GET | `/api/workflows/{workflow_id}` | Workflow metadata. |
| PATCH | `/api/workflows/{workflow_id}` | Update workflow metadata. |
| DELETE | `/api/workflows/{workflow_id}` | Delete workflow. |
| GET | `/api/workflows/{workflow_id}/content` | Workflow JSON content. |
| POST | `/api/workflows/{workflow_id}/fork` | Fork workflow. |
| POST | `/api/workflows/{workflow_id}/versions` | Create workflow version. |
| GET | `/api/workflows/published/{share_id}` | Fetch published workflow. |
| GET | `/api/tasks` | Background tasks. |
| GET | `/api/tasks/{task_id}` | One background task. |
| POST | `/api/feedback` | Submit feedback; avoid unless explicitly requested. |
| GET | `/api/vhs/queryvideo` | VHS video metadata compatibility route. |
| GET | `/health` | Health probe. |
| GET | `/internal/logs` | Internal logs as text. |
| GET | `/internal/logs/raw` | Internal structured logs. |
| PATCH | `/internal/logs/subscribe` | Subscribe/unsubscribe log streaming by WebSocket client ID. |
| GET | `/internal/folder_paths` | Internal configured folder paths. |

## Core Nodes Useful for Text-to-Image

Common core node classes from `nodes.py`:

- `CheckpointLoaderSimple`: load checkpoint, returns `MODEL`, `CLIP`, `VAE`.
- `CLIPTextEncode`: prompt text to `CONDITIONING`.
- `EmptyLatentImage`: create latent canvas.
- `KSampler` or `KSamplerAdvanced`: sample latent image.
- `VAEDecode`: latent to image.
- `SaveImage` or `PreviewImage`: output image.
- `LoraLoader`, `ControlNetLoader`, `ControlNetApply`, `VAEEncodeForInpaint`, `LoadImage`, `LoadImageMask`: common extensions for LoRA, ControlNet, img2img, and inpaint flows.

Video workflows are generally model-family specific and should be adapted from `blueprints/` or discovered custom nodes rather than guessed from core image nodes.

## Blueprint Guidance

`blueprints/*.json` files are frontend workflow templates. They are useful examples for capability and graph structure, but they usually are not directly accepted by `/api/prompt`. Use them to identify node types, widget values, model names, and expected inputs; then build or export an API prompt map.

Useful local templates:

- `blueprints/Text to Image.json`
- `blueprints/Text to Image (Flux.1 Dev).json`
- `blueprints/Text to Image (Qwen-Image).json`
- `blueprints/Image to Video (Wan 2.2).json`
- `blueprints/Image to Video (LTX-2.3).json`
- `blueprints/Text to Video (Wan 2.2).json`
- `blueprints/Text to Video (LTX-2.3).json`
- `blueprints/Image Edit (Flux.2 Dev).json`
- `blueprints/Video Inpainting (Wan2.1 VACE).json`

## Internet and Remote API Nodes

Core ComfyUI is local-first and the README states it works offline except for user-authorized downloads. Optional API nodes can use external providers through Comfy API and can be disabled with `--disable-api-nodes`. Agents should not use API nodes, feedback, publishing, model download, or any remote path unless the user explicitly requests and authorizes it.

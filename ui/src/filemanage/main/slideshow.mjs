/**
 * 集锦短视频渲染 Worker (Electron utilityProcess 入口)
 *
 * 把一组照片渲染成带 Ken Burns 运镜 + 转场 + 背景音乐的 mp4:
 *   - 每张照片裁切填满画面, zoompan 缓慢推近(Ken Burns)
 *   - 相邻片段 xfade 交叉淡入淡出
 *   - 可选背景音乐(末尾自动淡出)
 *   - 通过 ffmpeg -progress 解析渲染进度
 *
 * 消息协议:
 *   in : { type:'start', taskId, options }
 *        options = { images:string[], audio?:string, output:string,
 *                    width?:number, height?:number, perImage?:number,
 *                    transition?:number, fps?:number }
 *        { type:'stop' }
 *   out: { type:'progress', taskId, percent, outTime }
 *        { type:'done', taskId, output }
 *        { type:'error', taskId, error }
 */

import { spawn } from 'node:child_process';
import { getFfmpegPath } from './ffmpeg.mjs';

const port = process.parentPort;
let child = null;

function post(msg) { port.postMessage(msg); }

port.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'stop') { try { child?.kill('SIGKILL'); } catch {} return; }
  if (msg.type === 'start') {
    run(msg).catch((err) => post({ type: 'error', taskId: msg.taskId, error: err.message }));
  }
});

// 构造 ffmpeg 参数: 逐图 zoompan + xfade 链 + 音乐
function buildArgs(opts) {
  const W = opts.width || 1280;
  const H = opts.height || 720;
  const fps = opts.fps || 30;
  const d = opts.perImage || 3.5;      // 每张展示秒数(含转场)
  const t = Math.min(opts.transition || 1, d - 0.5); // 转场秒数
  const images = opts.images || [];
  const N = images.length;
  const frames = Math.round(d * fps);

  const args = ['-y'];
  for (const img of images) {
    args.push('-loop', '1', '-t', String(d), '-i', img);
  }
  const hasAudio = !!opts.audio;
  if (hasAudio) args.push('-i', opts.audio);

  // 每张图: 填满裁切 + Ken Burns 推近
  const parts = [];
  for (let i = 0; i < N; i++) {
    parts.push(
      `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${H},` +
      `zoompan=z='min(zoom+0.0012,1.5)':d=${frames}:s=${W}x${H}:fps=${fps},` +
      `setsar=1,format=yuv420p[v${i}]`
    );
  }

  let videoLabel;
  if (N === 1) {
    videoLabel = '[v0]';
  } else {
    let prev = '[v0]';
    for (let i = 1; i < N; i++) {
      const out = i === N - 1 ? '[vout]' : `[x${i}]`;
      const offset = (i * (d - t)).toFixed(3);
      parts.push(`${prev}[v${i}]xfade=transition=fade:duration=${t}:offset=${offset}${out}`);
      prev = out;
    }
    videoLabel = '[vout]';
  }

  // 总时长 = N*d - (N-1)*t
  const total = N * d - (N - 1) * t;

  let audioLabel = null;
  if (hasAudio) {
    const fadeStart = Math.max(0, total - 2);
    parts.push(`[${N}:a]afade=t=out:st=${fadeStart.toFixed(3)}:d=2[aout]`);
    audioLabel = '[aout]';
  }

  args.push('-filter_complex', parts.join(';'));
  args.push('-map', videoLabel);
  if (audioLabel) args.push('-map', audioLabel);

  args.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(fps), '-preset', 'medium', '-crf', '20', '-movflags', '+faststart');
  if (audioLabel) args.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-t', total.toFixed(3));
  args.push('-progress', 'pipe:1', '-nostats', '-loglevel', 'error');
  args.push(opts.output);

  return { args, total };
}

function run({ taskId, options }) {
  return new Promise((resolve) => {
    const images = options?.images || [];
    if (images.length === 0) {
      post({ type: 'error', taskId, error: '没有可用于渲染的照片' });
      return resolve();
    }
    const { args, total } = buildArgs(options);
    const ffmpeg = getFfmpegPath();

    let stderr = '';
    child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    // -progress 写到 stdout: out_time_ms=... / progress=continue|end
    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith('out_time_ms=')) {
          const us = Number(line.slice('out_time_ms='.length));
          if (Number.isFinite(us) && total > 0) {
            const percent = Math.max(0, Math.min(99, (us / 1e6 / total) * 100));
            post({ type: 'progress', taskId, percent: Math.round(percent), outTime: us / 1e6 });
          }
        }
      }
    });

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    child.on('error', (err) => {
      post({ type: 'error', taskId, error: `ffmpeg 启动失败: ${err.message}` });
      resolve();
    });

    child.on('close', (code) => {
      child = null;
      if (code === 0) {
        post({ type: 'progress', taskId, percent: 100, outTime: total });
        post({ type: 'done', taskId, output: options.output });
      } else if (code === null) {
        post({ type: 'error', taskId, error: '渲染已取消' });
      } else {
        post({ type: 'error', taskId, error: `ffmpeg 退出码 ${code}: ${stderr.slice(-500)}` });
      }
      resolve();
    });
  });
}

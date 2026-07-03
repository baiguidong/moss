/**
 * 成片合成 Worker (Electron utilityProcess 入口)
 * 三步管线, 每步都是简单命令, 可独立验证(避免单条巨型 filter_complex 的连锁故障):
 *   1) 逐镜渲染独立小片: Ken Burns 运镜(zoompan) + 字幕烧录(drawtext); 首镜淡入/末镜淡出
 *   2) concat demuxer 流拷贝拼接(无重编码, 时间轴简单可靠)
 *   3) 封装输出: 可选背景音乐(循环铺满/音量/末尾淡出), 视频仍流拷贝
 *
 * 消息协议:
 *   in : { type:'start', taskId, options }
 *        options = { shots:[{image, duration_ms, subtitle, camera}], audio?, output,
 *                    width, height, fps?, crf?, bgmVolume?,
 *                    subtitle?:{ fontSize, color, boxOpacity, position:'bottom'|'top'|'center', margin } }
 *        { type:'stop' }
 *   out: { type:'progress', taskId, percent, outTime }
 *        { type:'done', taskId, output }
 *        { type:'error', taskId, error }
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getFfmpegPath } from '../../filemanage/main/ffmpeg.mjs';

const port = process.parentPort; // 仅在 utilityProcess 中存在; plain node 下可 import 本模块做测试
let child = null;
let stopped = false;

function post(msg) { if (port) port.postMessage(msg); }

if (port) {
  port.on('message', (e) => {
    const msg = e.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'stop') { stopped = true; try { child?.kill('SIGKILL'); } catch {} return; }
    if (msg.type === 'start') {
      const { taskId, options } = msg;
      composeVideo({
        options,
        onProgress: (percent, outTime) => post({ type: 'progress', taskId, percent, outTime }),
      })
        .then((output) => {
          post({ type: 'progress', taskId, percent: 100 });
          post({ type: 'done', taskId, output });
        })
        .catch((err) => post({ type: 'error', taskId, error: err.message }));
    }
  });
}

// 探测一个可用的中日韩字体文件, 找不到返回 null(则不烧字幕)
function findFont() {
  const candidates = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    'C:/Windows/Fonts/msyh.ttc',
    'C:/Windows/Fonts/simhei.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];
  for (const f of candidates) {
    try { if (fs.existsSync(f)) return f; } catch { /* ignore */ }
  }
  return null;
}

// drawtext 的路径值需转义 ':' 和 '\\'
function escFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

// 字符显示宽度: CJK/全角约 1 个字距, 其它约 0.5
function charUnits(ch) {
  const code = ch.codePointAt(0);
  // CJK 统一表意 / 假名 / 全角标点 等
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) return 1;
  return 0.5;
}

// 按每行容量(以字距为单位)对文本硬换行, 支持 CJK(无空格)与含空格文本
function wrapText(text, capacity) {
  if (capacity <= 0) return text;
  const lines = [];
  for (const rawLine of String(text).split('\n')) {
    let cur = '';
    let units = 0;
    for (const ch of rawLine) {
      const w = charUnits(ch);
      if (units + w > capacity && cur) {
        lines.push(cur);
        cur = '';
        units = 0;
      }
      cur += ch;
      units += w;
    }
    lines.push(cur);
  }
  return lines.join('\n');
}

// 生成单段的 Ken Burns zoompan 表达式
function kenburns(camera, frames) {
  const cx = "'iw/2-(iw/zoom/2)'";
  const cy = "'ih/2-(ih/zoom/2)'";
  switch (camera) {
    case 'out':
      return { z: `'max(1.15-0.15*on/${frames},1.0)'`, x: cx, y: cy };
    case 'left':
      return { z: `'1.12'`, x: `'(iw-iw/zoom)*(1-on/${frames})'`, y: cy };
    case 'right':
      return { z: `'1.12'`, x: `'(iw-iw/zoom)*(on/${frames})'`, y: cy };
    case 'in':
    default:
      return { z: `'min(1+0.15*on/${frames},1.15)'`, x: cx, y: cy };
  }
}

// 跑一条 ffmpeg 命令; onSec 为 -progress 的 out_time 回调(秒)
function execFfmpeg(args, onSec) {
  return new Promise((resolve, reject) => {
    const p = spawn(getFfmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child = p;
    let stderr = '';
    let buf = '';
    p.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line.startsWith('out_time_ms=')) {
          const us = Number(line.slice('out_time_ms='.length));
          if (Number.isFinite(us) && onSec) onSec(us / 1e6);
        }
      }
    });
    p.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    p.on('error', (err) => { child = null; reject(new Error(`ffmpeg 启动失败: ${err.message}`)); });
    p.on('close', (code) => {
      child = null;
      if (code === 0) resolve();
      else if (code === null || stopped) reject(new Error('渲染已取消'));
      else reject(new Error(`ffmpeg 退出码 ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// 单镜小片的 ffmpeg 参数
function buildClipArgs({ shot, index, count, dur, ctx, clipPath, tmpDir }) {
  const { W, H, fps, font, sub } = ctx;
  const frames = Math.round(dur * fps);
  const kb = kenburns(shot.camera, frames);

  // zoompan 对 -loop 1 的多帧输入会按"每输入帧 × d"爆量(单段可膨胀到数百秒),
  // trim 裁回 frames 帧(即首帧动画的完整运镜)。
  let chain =
    `[0:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,` +
    `crop=${W * 2}:${H * 2},` +
    `zoompan=z=${kb.z}:x=${kb.x}:y=${kb.y}:d=${frames}:s=${W}x${H}:fps=${fps},` +
    `trim=end_frame=${frames},setpts=PTS-STARTPTS`;

  // 字幕(CJK 硬换行 + 可配样式/位置)
  const text = (shot.subtitle || '').trim();
  if (text && font) {
    const txtFile = path.join(tmpDir, `sub_${index}.txt`);
    fs.writeFileSync(txtFile, wrapText(text, sub.lineCapacity), 'utf-8');
    const y = sub.position === 'top' ? String(sub.margin)
      : sub.position === 'center' ? '(h-text_h)/2'
      : `h-text_h-${sub.margin}`;
    chain +=
      `,drawtext=fontfile='${escFilterPath(font)}':textfile='${escFilterPath(txtFile)}':` +
      `fontcolor=${sub.color}:fontsize=${sub.fontSize}:line_spacing=6:box=1:boxcolor=black@${sub.boxOpacity}:boxborderw=12:` +
      `x=(w-text_w)/2:y=${y}`;
  }

  // 镜头之间硬切; 只在整片头尾淡入淡出(烧在首/末小片上, 拼接时无需重编码)
  const g = Math.min(0.5, dur / 2);
  if (index === 0) chain += `,fade=t=in:st=0:d=${g.toFixed(3)}`;
  if (index === count - 1) chain += `,fade=t=out:st=${Math.max(0, dur - g).toFixed(3)}:d=${g.toFixed(3)}`;
  chain += `,setsar=1,format=yuv420p[v]`;

  return [
    '-y', '-loop', '1', '-t', dur.toFixed(3), '-i', shot.image,
    '-filter_complex', chain, '-map', '[v]',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', String(fps), '-preset', 'medium', '-crf', String(ctx.crf),
    '-progress', 'pipe:1', '-nostats', '-loglevel', 'error',
    clipPath,
  ];
}

/** 三步合成; 返回输出路径。可在 plain node 中直接调用做验证。 */
export async function composeVideo({ options, onProgress }) {
  const opts = options || {};
  const W = opts.width || 832;
  const H = opts.height || 1216;
  const fps = opts.fps || 30;
  const crf = Number.isFinite(opts.crf) ? Math.min(Math.max(opts.crf, 0), 51) : 20;
  const shots = (opts.shots || []).filter((s) => s.image && fs.existsSync(s.image));
  const N = shots.length;
  if (!N) throw new Error('没有可用于合成的画面(请先生成美术)');

  const font = findFont();
  const st = opts.subtitle || {};
  const fontSize = Number.isFinite(st.fontSize) ? st.fontSize : Math.round(H / 22);
  const sub = {
    fontSize,
    color: typeof st.color === 'string' && st.color.trim() ? st.color.trim() : 'white',
    boxOpacity: Number.isFinite(st.boxOpacity) ? Math.min(Math.max(st.boxOpacity, 0), 1) : 0.5,
    position: ['bottom', 'top', 'center'].includes(st.position) ? st.position : 'bottom',
    margin: Number.isFinite(st.margin) ? st.margin : Math.round(H / 12),
    // 每行可容纳的字距数(留 ~10% 边距)
    lineCapacity: Math.max(6, Math.floor((W * 0.9) / fontSize)),
  };
  const ctx = { W, H, fps, crf, font, sub };

  const durations = shots.map((s) => Math.max(0.8, (Number(s.duration_ms) || 3000) / 1000));
  const total = durations.reduce((a, b) => a + b, 0);
  // 单调递增(ffmpeg 每条命令起始会吐一个无效的 out_time_ms, 避免进度回跳)
  let lastPct = 0;
  const report = (pct, outTime) => {
    const v = Math.min(99, Math.round(pct));
    if (!onProgress || v <= lastPct) return;
    lastPct = v;
    onProgress(v, outTime);
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moss-comic-'));
  try {
    // 1) 逐镜渲染小片(占进度 0-92%)
    const clips = [];
    let doneDur = 0;
    for (let i = 0; i < N; i++) {
      if (stopped) throw new Error('渲染已取消');
      const clipPath = path.join(tmpDir, `clip_${String(i).padStart(3, '0')}.mp4`);
      const args = buildClipArgs({ shot: shots[i], index: i, count: N, dur: durations[i], ctx, clipPath, tmpDir });
      await execFfmpeg(args, (sec) => report(((doneDur + Math.min(sec, durations[i])) / total) * 92, doneDur + sec));
      clips.push(clipPath);
      doneDur += durations[i];
    }

    // 2) concat demuxer 流拷贝拼接(92-95%)
    if (stopped) throw new Error('渲染已取消');
    const listPath = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(listPath, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8');
    const concatPath = path.join(tmpDir, 'concat.mp4');
    await execFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-loglevel', 'error', concatPath]);
    report(95, total);

    // 3) 封装输出: 可选 BGM(循环/音量/末尾淡出), 视频流拷贝(95-99%)
    if (stopped) throw new Error('渲染已取消');
    const hasAudio = !!(opts.audio && fs.existsSync(opts.audio));
    if (hasAudio) {
      const vol = Number.isFinite(opts.bgmVolume) ? Math.max(0, opts.bgmVolume) : 1;
      const fadeStart = Math.max(0, total - 2);
      await execFfmpeg([
        '-y', '-i', concatPath, '-stream_loop', '-1', '-i', opts.audio,
        '-map', '0:v', '-map', '1:a',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
        '-af', `volume=${vol},afade=t=out:st=${fadeStart.toFixed(3)}:d=2`,
        '-t', total.toFixed(3), '-movflags', '+faststart', '-loglevel', 'error',
        opts.output,
      ]);
    } else {
      await execFfmpeg(['-y', '-i', concatPath, '-c', 'copy', '-movflags', '+faststart', '-loglevel', 'error', opts.output]);
    }
    report(99, total);
    return opts.output;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

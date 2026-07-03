/**
 * ffmpeg / ffprobe 封装
 * - 解析打包态(asar.unpacked)与开发态的二进制路径
 * - probe: 读取媒体时长/分辨率
 * - extractFrame: 抽取视频帧作缩略图
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// 打包后二进制被 asarUnpack 解出到 app.asar.unpacked
function unpacked(p) {
  if (!p) return p;
  return p.includes('app.asar') ? p.replace('app.asar', 'app.asar.unpacked') : p;
}

let _ffmpegPath = null;
let _ffprobePath = null;

export function getFfmpegPath() {
  if (_ffmpegPath) return _ffmpegPath;
  try {
    _ffmpegPath = unpacked(require('ffmpeg-static'));
  } catch {
    _ffmpegPath = 'ffmpeg'; // 回退到系统 PATH
  }
  return _ffmpegPath;
}

export function getFfprobePath() {
  if (_ffprobePath) return _ffprobePath;
  try {
    _ffprobePath = unpacked(require('ffprobe-static').path);
  } catch {
    _ffprobePath = 'ffprobe';
  }
  return _ffprobePath;
}

/**
 * 探测媒体信息: { duration(秒,int), width, height, hasVideo, hasAudio }
 */
export async function probe(filePath) {
  try {
    const { stdout } = await execFileAsync(
      getFfprobePath(),
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { maxBuffer: 1024 * 1024 * 8 }
    );
    const info = JSON.parse(stdout);
    const streams = info.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const durationStr = info.format?.duration ?? video?.duration ?? audio?.duration;
    const duration = durationStr ? Math.round(parseFloat(durationStr)) : null;
    return {
      duration: Number.isFinite(duration) ? duration : null,
      width: video?.width ?? null,
      height: video?.height ?? null,
      hasVideo: !!video,
      hasAudio: !!audio,
    };
  } catch (err) {
    return { duration: null, width: null, height: null, hasVideo: false, hasAudio: false, error: err.message };
  }
}

/**
 * 抽取一帧作为视频缩略图
 * @param {string} filePath 源视频
 * @param {string} outPath 输出 jpg 路径
 * @param {{ time?: number, width?: number }} opts time=抽帧时间(秒), width=缩略图宽度
 */
export async function extractFrame(filePath, outPath, opts = {}) {
  const time = opts.time ?? 1;
  const width = opts.width ?? 480;
  try {
    await execFileAsync(
      getFfmpegPath(),
      [
        '-ss', String(time),
        '-i', filePath,
        '-frames:v', '1',
        '-vf', `scale=${width}:-2:force_original_aspect_ratio=decrease`,
        '-q:v', '3',
        '-y', outPath,
      ],
      { maxBuffer: 1024 * 1024 * 8, timeout: 30000 }
    );
    return outPath;
  } catch (err) {
    // 某些视频在 time 处无帧, 回退到 0 秒
    if (time > 0) {
      try {
        await execFileAsync(
          getFfmpegPath(),
          ['-ss', '0', '-i', filePath, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '3', '-y', outPath],
          { maxBuffer: 1024 * 1024 * 8, timeout: 30000 }
        );
        return outPath;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export default { getFfmpegPath, getFfprobePath, probe, extractFrame };

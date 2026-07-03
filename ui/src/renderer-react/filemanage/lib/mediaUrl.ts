/**
 * 把本地绝对路径转成自定义流媒体协议 URL, 供 <img>/<video>/<audio> 直接使用。
 * 后端 moss-media:// 协议支持 HTTP Range, 视频可边下边播。
 */
export function mediaUrl(absPath?: string | null): string | undefined {
  if (!absPath) return undefined;
  // 已是 url 直接返回
  if (/^(moss-media|data|blob|https?|file):/.test(absPath)) return absPath;
  return `moss-media://local/${encodeURIComponent(absPath)}`;
}

export default mediaUrl;

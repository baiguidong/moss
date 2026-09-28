import * as React from 'react';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { MAX_USER_AVATAR_BYTES, USER_AVATAR_MIME_TYPES } from '../../user-avatar-settings.mjs';

async function readAvatar(file: File): Promise<string> {
  if (!USER_AVATAR_MIME_TYPES.includes(file.type)) throw new Error('请选择 PNG、JPG、WebP、GIF、SVG 或 AVIF 图片。');
  if (file.size > MAX_USER_AVATAR_BYTES) throw new Error('请选择不超过 5 MB 的图片。');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('无法读取图片，请重新选择。'));
    reader.readAsDataURL(file);
  });
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('无法打开这张图片，请选择其他图片。'));
    image.src = dataUrl;
  });
  return dataUrl;
}

export function UserAvatarSetting({ value = '', onChange }: {
  value?: string;
  onChange: (value: string) => Promise<void>;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');

  async function save(file?: File) {
    setBusy(true);
    setError('');
    try {
      await onChange(file ? await readAvatar(file) : '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <UserAvatar src={value} className="self-center" />
        <input
          ref={inputRef}
          type="file"
          accept={USER_AVATAR_MIME_TYPES.join(',')}
          aria-label="选择用户头像"
          className="hidden"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void save(file);
          }}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? '保存中…' : value ? '更换头像' : '选择头像'}
        </Button>
        {value ? (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save()}>
            恢复默认
          </Button>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}

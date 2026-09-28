import * as React from 'react';
import { UserRound } from 'lucide-react';
import { cn } from '@/lib/utils';

export const UserAvatarContext = React.createContext('');

export function UserAvatar({ src, className }: { src?: string; className?: string }) {
  const configuredAvatar = React.useContext(UserAvatarContext);
  const avatar = src ?? configuredAvatar;
  const [failedAvatar, setFailedAvatar] = React.useState<string | null>(null);

  return (
    <span className={cn('flex h-7 w-7 shrink-0 self-start items-center justify-center overflow-hidden rounded-sm bg-muted text-muted-foreground', className)}>
      {avatar && avatar !== failedAvatar ? (
        <img src={avatar} alt="用户头像" className="h-full w-full object-cover" onError={() => setFailedAvatar(avatar)} />
      ) : (
        <UserRound className="h-4 w-4" role="img" aria-label="默认用户头像" />
      )}
    </span>
  );
}

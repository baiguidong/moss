import { ExternalLink, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import appPackage from '../../../package.json';

export function AboutView() {
  return (
    <section aria-labelledby="about-title" className="flex h-full flex-col overflow-y-auto bg-background px-5 pt-6 pb-[clamp(3rem,14vh,8rem)] text-foreground">
      <div className="m-auto w-full max-w-md">
        <header className="flex items-center justify-center gap-3">
          <img src="./build/icon.png" alt="" className="size-14 rounded-xl" />
          <h1 id="about-title" className="text-2xl font-semibold">关于 Moss</h1>
        </header>
        <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-8 gap-y-4 border-y border-border py-6 text-base">
          <dt className="text-muted-foreground">版本</dt><dd>v{appPackage.version}</dd>
          <dt className="text-muted-foreground">作者</dt><dd>小白</dd>
          <dt className="text-muted-foreground">邮箱</dt>
          <dd className="select-text break-all"><a href="mailto:baigdmoss@gmail.com" className="text-primary hover:underline">baigdmoss@gmail.com</a></dd>
        </dl>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {!window.mossWeb && <Button onClick={() => window.dispatchEvent(new Event('moss:open-update-modal'))}>
            <RefreshCw />检查更新
          </Button>}
          <Button asChild variant="outline">
            <a href="https://github.com/baiguidong/moss/releases" target="_blank" rel="noopener noreferrer"><ExternalLink />GitHub 发布页</a>
          </Button>
        </div>
      </div>
    </section>
  );
}

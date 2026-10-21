"use client";

import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScrollArea } from "@/components/ui/scroll-area";
import { LocalImage } from "@/components/local-image";

function localImageUrlTransform(url: string) {
  if (/^(moss-image|moss-media|file):/i.test(url) || url.startsWith("/") || /^[A-Za-z]:[\\/]/.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

export function MarkdownViewer({ content }: { content: string }) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-4xl px-5 py-6 text-sm leading-7 text-foreground">
        <div className="space-y-4 [&_a]:text-primary [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:font-semibold [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_th]:border-b [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_td]:border-b [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-1.5 [&_code]:rounded-md [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_img]:rounded-xl [&_img]:border [&_img]:border-border/70 [&_img]:shadow-sm [&_pre]:overflow-auto [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-card/80 [&_pre]:p-4">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            urlTransform={localImageUrlTransform}
            components={{
              img: ({ src, alt }) => (
                <LocalImage
                  src={typeof src === "string" ? src : ""}
                  alt={alt}
                  className="max-h-[520px] max-w-full rounded-xl border border-border/70 object-contain shadow-sm"
                />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </ScrollArea>
  );
}

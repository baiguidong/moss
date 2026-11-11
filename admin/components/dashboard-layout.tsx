'use client'

interface DashboardLayoutProps {
  children: React.ReactNode
  title: string
  description?: string
}

export function DashboardLayout({ children, title, description }: DashboardLayoutProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <header className="shrink-0 border-b border-border/70 bg-card/70 px-6 py-5 backdrop-blur md:px-8">
        <div className="mx-auto w-full max-w-[1440px]">
          <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.14em] text-primary/80">moss · 控制平面</p>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </header>
      <main className="moss-page-pattern flex-1 overflow-auto px-6 py-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-[1440px]">{children}</div>
      </main>
    </div>
  )
}

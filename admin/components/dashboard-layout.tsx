'use client'

interface DashboardLayoutProps {
  children: React.ReactNode
  title: string
}

export function DashboardLayout({ children, title }: DashboardLayoutProps) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <main aria-label={title} className="moss-page-pattern flex-1 overflow-auto px-6 py-6 md:px-8 md:py-8">
        <div className="mx-auto w-full max-w-[1440px]">{children}</div>
      </main>
    </div>
  )
}

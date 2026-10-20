import * as React from 'react';

export function PdfFileIcon({ className, ...props }: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 36"
      fill="none"
      className={className}
      data-pdf-icon="true"
      aria-hidden="true"
      {...props}
    >
      <path d="M5.5 1.5H21l8 8V32a2.5 2.5 0 0 1-2.5 2.5h-21A2.5 2.5 0 0 1 3 32V4a2.5 2.5 0 0 1 2.5-2.5Z" stroke="currentColor" strokeWidth="2" />
      <path d="M21 1.5V8a1.5 1.5 0 0 0 1.5 1.5H29" stroke="currentColor" strokeWidth="2" />
      <rect y="15" width="32" height="13" rx="3" fill="currentColor" />
      <text x="16" y="24.4" fill="white" fontFamily="Arial, sans-serif" fontSize="8.5" fontWeight="800" letterSpacing="0.4" textAnchor="middle">PDF</text>
    </svg>
  );
}

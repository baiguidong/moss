import type JSZip from 'jszip'
export function managedPackageFiles(zip: JSZip, kind: 'skill' | 'expert'): Array<{ name: string; entry: JSZip.JSZipObject }>

export interface SourceFile { path: string; size: number; sha256: string; executable?: boolean }
export interface SourceCommand { cwd: string; argv: string[] }
export interface SourceSdkSnapshot {
  provider?: 'moss' | string; sdkVersion?: string; coreVersion?: string; coreCommit?: string;
  path?: string; sdkHash?: string; coreHash?: string; dirty?: boolean; [key: string]: unknown;
}
export interface SourceManifest {
  schemaVersion: 1; appId: string; version: string; sourceRoot: 'source'; appRoot: string;
  origin: { kind: 'repository' | 'builder'; [key: string]: unknown };
  toolchain: { node: string; packageManager: { name: 'npm' | 'bun'; version: string } };
  lockfile: string | null; commands: { build: SourceCommand; install?: SourceCommand; check?: SourceCommand; test?: SourceCommand };
  sdk: SourceSdkSnapshot; files: SourceFile[]; sourceHash: string; runtimeHash: string;
}
export const SOURCE_MANIFEST: 'source-manifest.json';
export const SHARED_SDK_WORKSPACES: readonly string[];
export const SHARED_SDK_PACKAGES: readonly string[];
export const APP_SOURCE_MANIFEST_SCHEMA: Record<string, unknown>;
export function sourcePath(root: string, relative: string): string;
export function excludeSourceEntry(name: string, relative?: string): boolean;
export function sourceFileList(root: string, options?: { filter?: (name: string, entry: import('node:fs').Dirent) => boolean; maxFileBytes?: number; maxBytes?: number }): Promise<SourceFile[]>;
export function copySourceTree(root: string, destination: string, options?: { includeSdk?: boolean }): Promise<SourceFile[]>;
export function inspectSourceProject(root: string, options?: { appRoot?: string; packageManagerVersion?: string }): Promise<{ manifest: Record<string, any>; appPath: string; appRoot: string; lockfile: string | null; toolchain: SourceManifest['toolchain']; commands: SourceManifest['commands'] }>;
export function runtimeFileList(root: string): Promise<SourceFile[]>;
export function attachSourcePackage(packageRoot: string, sourceRoot: string, options?: { appRoot?: string; packageManagerVersion?: string; origin?: SourceManifest['origin']; toolchain?: SourceManifest['toolchain']; sdk?: SourceSdkSnapshot }): Promise<SourceManifest>;
export function validateSourcePackage(packageRoot: string, options?: { required?: boolean }): Promise<{ descriptor: SourceManifest; root: string; appPath: string } | null>;

export function restoreSourceModes(root: string, descriptor: SourceManifest): Promise<void>;

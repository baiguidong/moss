/**
 * 加密保险箱视图组件
 */

import * as React from 'react';
import {
  Lock,
  Unlock,
  Eye,
  Trash2,
  Shield,
  AlertCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { EncryptedFile, FileManagerFile } from '../ipc/types';

export function VaultView() {
  const [encryptedFiles, setEncryptedFiles] = React.useState<EncryptedFile[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedFile, setSelectedFile] = React.useState<EncryptedFile | null>(null);
  const [password, setPassword] = React.useState('');
  const [decrypting, setDecrypting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // 加载加密文件
  React.useEffect(() => {
    const loadFiles = async () => {
      setLoading(true);
      try {
        const files = await window.fileManager?.getEncryptedFiles();
        if (files) {
          setEncryptedFiles(files as EncryptedFile[]);
        }
      } catch (err) {
        console.error('Failed to load encrypted files:', err);
      } finally {
        setLoading(false);
      }
    };
    loadFiles();
  }, []);

  // 格式化文件大小
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // 解密文件
  const handleDecrypt = async () => {
    if (!selectedFile || !password) return;

    setDecrypting(true);
    setError(null);

    try {
      const result = await window.fileManager?.decryptFile(selectedFile.id, password);

      if (result?.success) {
        // 解密成功，可以预览
        console.log('Decrypted to:', result.tempPath);
        // TODO: 打开预览
        setSelectedFile(null);
        setPassword('');
      } else {
        setError(result?.error || '解密失败');
      }
    } catch (err) {
      setError('解密失败');
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <div className="flex h-full">
      {/* 文件列表 */}
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="font-medium">加密保险箱</h3>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {encryptedFiles.length} 个加密文件
          </p>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {encryptedFiles.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Lock className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">保险箱为空</h3>
              <p className="text-sm text-muted-foreground">
                在画廊中选择文件进行加密
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {encryptedFiles.map((file) => (
                <div
                  key={file.id}
                  className={cn(
                    'flex items-center justify-between rounded-lg border border-border/40 p-3 cursor-pointer',
                    'hover:bg-muted/50',
                    selectedFile?.id === file.id && 'bg-primary/5 border-primary/50'
                  )}
                  onClick={() => setSelectedFile(file)}
                >
                  <div className="flex items-center gap-3">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{file.original_filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatSize(file.original_size)} → {formatSize(file.encrypted_size)}
                      </p>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    {new Date(file.created_at).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 解密面板 */}
      {selectedFile && (
        <div className="w-80 border-l border-border/40 p-4">
          <h3 className="font-medium mb-4">解密文件</h3>

          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">文件名</p>
              <p className="text-sm">{selectedFile.original_filename}</p>
            </div>

            {selectedFile.password_hint && (
              <div>
                <p className="text-sm text-muted-foreground">密码提示</p>
                <p className="text-sm">{selectedFile.password_hint}</p>
              </div>
            )}

            <div>
              <label className="text-sm text-muted-foreground">输入密码</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入解密密码"
                className="mt-1"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                {error}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={handleDecrypt}
                disabled={!password || decrypting}
                className="flex-1"
              >
                <Unlock className="mr-2 h-4 w-4" />
                解密预览
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default VaultView;
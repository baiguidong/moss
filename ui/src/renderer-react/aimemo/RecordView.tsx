/**
 * 记录页 - 语音 / 文字输入
 */

import * as React from 'react';
import { Mic, Square, Loader2, Send, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { aiMemoAPI } from './ipc/aiMemo.ipc';

interface RecordViewProps {
  onSaved?: () => void;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] || '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function RecordView({ onSaved }: RecordViewProps) {
  const [voiceEnabled, setVoiceEnabled] = React.useState(false);
  const [text, setText] = React.useState('');
  const [recording, setRecording] = React.useState(false);
  const [transcribing, setTranscribing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [pendingAudioPath, setPendingAudioPath] = React.useState('');

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const unmountedRef = React.useRef(false);

  React.useEffect(() => {
    aiMemoAPI.voiceEnabled().then((r) => setVoiceEnabled(!!r?.enabled)).catch(() => setVoiceEnabled(false));
  }, []);

  React.useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      recorder?.stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startRecording = async () => {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        if (unmountedRef.current) return; // 组件已卸载(如导航离开时触发的 stop), 不再更新状态
        setTranscribing(true);
        try {
          const base64 = await blobToBase64(blob);
          const res = await aiMemoAPI.transcribe(base64, blob.type);
          if (unmountedRef.current) return;
          if (res?.error) {
            setError(`转写失败: ${res.error}`);
          } else {
            setText((prev) => (prev ? `${prev}\n${res?.text}` : res?.text || ''));
            setPendingAudioPath(res?.audioPath || '');
          }
        } catch (err) {
          if (!unmountedRef.current) setError(`转写失败: ${(err as Error).message}`);
        } finally {
          if (!unmountedRef.current) setTranscribing(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(`无法访问麦克风: ${(err as Error).message}`);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const handleSave = async () => {
    const content = text.trim();
    if (!content) return;
    setSaving(true);
    setError('');
    try {
      await aiMemoAPI.createNote({
        source: pendingAudioPath ? 'voice' : 'text',
        rawText: content,
        audioPath: pendingAudioPath || undefined,
      });
      setText('');
      setPendingAudioPath('');
      onSaved?.();
    } catch (err) {
      setError(`保存失败: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <div className="w-full max-w-2xl space-y-4">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={voiceEnabled ? '说点什么,或直接打字…' : '记点什么…'}
          className="h-48 w-full resize-none rounded-lg border border-border/60 bg-background p-4 text-sm outline-none focus:border-primary"
        />

        {error && <div className="text-xs text-red-500">{error}</div>}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {voiceEnabled ? (
              recording ? (
                <Button variant="destructive" size="sm" onClick={stopRecording} className="gap-2">
                  <Square className="h-4 w-4" /> 停止录音
                </Button>
              ) : (
                <Button variant="secondary" size="sm" onClick={startRecording} disabled={transcribing} className="gap-2">
                  {transcribing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  {transcribing ? '转写中…' : '语音输入'}
                </Button>
              )
            ) : (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Settings2 className="h-3.5 w-3.5" /> 未配置语音模型,前往设置开启语音输入
              </span>
            )}
          </div>

          <Button size="sm" onClick={handleSave} disabled={saving || !text.trim()} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            保存并分析
          </Button>
        </div>
      </div>
    </div>
  );
}

export default RecordView;

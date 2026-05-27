'use client'

import React from 'react'
import Editor from '@monaco-editor/react'

interface JsonEditorProps {
  value: string
  onChange: (value: string) => void
  height?: string
  readOnly?: boolean
  language?: string
}

export function JsonEditor({
  value,
  onChange,
  height = '300px',
  readOnly = false,
  language = 'json'
}: JsonEditorProps) {
  return (
    <div className="border rounded-md overflow-hidden">
      <Editor
        height={height}
        language={language}
        value={value}
        onChange={(val) => onChange(val || '')}
        theme="vs-light"
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          lineNumbers: 'on',
          rulers: [],
          wordWrap: 'on',
          formatOnPaste: true,
          formatOnType: true,
          automaticLayout: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}
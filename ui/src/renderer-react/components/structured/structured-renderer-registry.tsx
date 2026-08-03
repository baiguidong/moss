"use client";

import * as React from "react";
import { DelimitedRenderer } from "@/components/chat/delimited-renderer";
import { JsonRenderer } from "@/components/chat/json-renderer";
import { MermaidRenderer } from "@/components/chat/mermaid-renderer";
import { SqlRenderer } from "@/components/chat/sql-renderer";
import { XmlRenderer } from "@/components/chat/xml-renderer";
import { YamlRenderer } from "@/components/chat/yaml-renderer";

export type StructuredCodeRendererProps = {
  code: string;
  language: string;
  blockId: string;
};

type StructuredRenderer = (props: StructuredCodeRendererProps) => React.ReactNode;

const LANGUAGE_ALIASES: Record<string, string> = {
  mmd: "mermaid",
  jsonc: "json",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  shell: "bash",
  sh: "bash",
  zsh: "bash",
  yml: "yaml",
  text: "text",
  plaintext: "text",
};

const STRUCTURED_RENDERERS: Record<string, StructuredRenderer> = {
  mermaid: ({ code, blockId }) => <MermaidRenderer code={code} blockId={blockId} />,
  json: ({ code, blockId }) => <JsonRenderer code={code} blockId={blockId} />,
  yaml: ({ code, blockId }) => <YamlRenderer code={code} blockId={blockId} />,
  csv: ({ code, blockId }) => <DelimitedRenderer code={code} blockId={blockId} kind="csv" />,
  tsv: ({ code, blockId }) => <DelimitedRenderer code={code} blockId={blockId} kind="tsv" />,
  xml: ({ code, blockId }) => <XmlRenderer code={code} blockId={blockId} kind="xml" />,
  html: ({ code, blockId }) => <XmlRenderer code={code} blockId={blockId} kind="html" />,
  svg: ({ code, blockId }) => <XmlRenderer code={code} blockId={blockId} kind="svg" />,
  sql: ({ code, blockId }) => <SqlRenderer code={code} blockId={blockId} />,
};

export function normalizeCodeLanguage(language: string) {
  const normalized = String(language || "text").trim().toLowerCase();
  return LANGUAGE_ALIASES[normalized] || normalized || "text";
}

export function renderStructuredCodeBlock(props: StructuredCodeRendererProps) {
  const language = normalizeCodeLanguage(props.language);
  const renderer = STRUCTURED_RENDERERS[language];
  return renderer ? renderer({ ...props, language }) : null;
}

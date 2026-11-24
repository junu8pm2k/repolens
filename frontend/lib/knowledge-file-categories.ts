export type FileDescription = { path: string; title?: string; manifest?: boolean };

const categories = [
  { id: "overview", label: "项目概览" },
  { id: "guide", label: "使用与运维" },
  { id: "development", label: "架构与开发" },
  { id: "testing", label: "测试与评测" },
  { id: "configuration", label: "配置清单" },
  { id: "other", label: "其他资料" }
] as const;

type FileCategory = (typeof categories)[number]["id"];

function classifyFile({ path, title = "", manifest = false }: FileDescription): FileCategory {
  const normalizedPath = path.replaceAll("\\", "/");
  const filename = normalizedPath.split("/").at(-1) ?? normalizedPath;
  const name = `${filename} ${title}`.replace(/[._-]+/g, " ");
  const hints = `${normalizedPath} ${title}`.replace(/[/_.-]+/g, " ");

  if (manifest || /\b(?:configuration|config|manifest)\b|配置|依赖清单/i.test(name)) return "configuration";
  if (/\b(?:tests?|testing|evals?|evaluation|benchmarks?|qa|acceptance|scor(?:e|ing)|regression)\b|测试|评测|评估|验收|评分/i.test(hints)) return "testing";
  if (/^readme(?:\.[^.]+)?$/i.test(normalizedPath) || /\b(?:introduction|project overview)\b|项目简介|项目概览|项目介绍/i.test(name)) return "overview";
  if (/\b(?:guides?|tutorials?|usage|install(?:ation)?|setup|deploy(?:ment)?|runbooks?|troubleshooting|contributing|getting started)\b|使用指南|快速开始|教程|安装|部署|运维|排障/i.test(hints)) return "guide";
  if (/\b(?:architecture|design|adr|api|sdk|mcp|implementation|development|developers?|codebase|project structure)\b|架构|设计|开发|接口|实现/i.test(hints)) return "development";
  return "other";
}

export function groupKnowledgeFiles<T>(files: readonly T[], describe: (file: T) => FileDescription) {
  const byCategory = new Map<FileCategory, T[]>();
  for (const file of files) {
    const category = classifyFile(describe(file));
    const group = byCategory.get(category);
    if (group) group.push(file);
    else byCategory.set(category, [file]);
  }
  return categories.flatMap((category) => {
    const files = byCategory.get(category.id);
    return files ? [{ ...category, files }] : [];
  });
}

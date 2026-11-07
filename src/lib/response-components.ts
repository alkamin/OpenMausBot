interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
  position?: { start: { line: number; column: number; offset?: number }; end: { line: number; column: number; offset?: number } };
}

export const CALLOUT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export function calloutKind(value: unknown): CalloutKind | undefined {
  return CALLOUT_KINDS.find((kind) => kind === value);
}

const DETAILS_OPEN = /^\s*<details(?:\s+(open))?\s*>\s*<summary>([^<>]+)<\/summary>\s*$/i;
const DETAILS_CLOSE = /^\s*<\/details>\s*$/i;

function detailsOpening(node: MarkdownNode) {
  return node.type === "html" ? DETAILS_OPEN.exec(node.value ?? "") : null;
}

function foldDetails(nodes: MarkdownNode[]): MarkdownNode[] {
  const result: MarkdownNode[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const opening = detailsOpening(node);
    if (!opening) {
      if (node.children) node.children = foldDetails(node.children);
      result.push(node);
      continue;
    }
    let depth = 1;
    let end = index + 1;
    for (; end < nodes.length; end++) {
      const candidate = nodes[end]!;
      if (detailsOpening(candidate)) depth++;
      else if (candidate.type === "html" && DETAILS_CLOSE.test(candidate.value ?? "")) depth--;
      if (depth === 0) break;
    }
    if (depth !== 0) {
      result.push(node);
      continue;
    }
    result.push({
      type: "responseDetails",
      data: { hName: "details", hProperties: { open: Boolean(opening[1]) } },
      children: [
        { type: "responseSummary", data: { hName: "summary" }, children: [{ type: "text", value: opening[2]!.trim() }] },
        ...foldDetails(nodes.slice(index + 1, end)),
      ],
      ...(node.position && nodes[end]!.position ? { position: { start: node.position.start, end: nodes[end]!.position!.end } } : {}),
    });
    index = end;
  }
  return result;
}

function decorateCallouts(node: MarkdownNode): void {
  if (node.type === "blockquote") {
    const paragraph = node.children?.[0];
    const first = paragraph?.type === "paragraph" ? paragraph.children?.[0] : undefined;
    const marker = first?.type === "text" ? /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\r?\n|[ \t]+|$)/.exec(first.value ?? "") : null;
    if (marker && first && paragraph) {
      first.value = first.value!.slice(marker[0].length);
      if (!first.value) paragraph.children!.shift();
      if (!paragraph.children?.length) node.children!.shift();
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, "data-response-callout": marker[1] } };
    }
  }
  node.children?.forEach(decorateCallouts);
}

// Security: only this details/summary grammar becomes elements; other HTML and attributes stay text.
export function remarkResponseComponents() {
  return (tree: MarkdownNode) => {
    if (tree.children) tree.children = foldDetails(tree.children);
    decorateCallouts(tree);
  };
}

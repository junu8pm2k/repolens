type Point = { x: number; y: number };
type Rectangle = { left: number; top: number; right: number; bottom: number };

type NodeLabel = Point & { key: string; title: string; radius: number };
type RelationLabel = Point & { key: string; title: string };
type PlacedLabel = Point & { title: string; box: Rectangle };

export const graphViewBox = { left: 0, top: -24, right: 720, bottom: 432 };

function overlaps(first: Rectangle, second: Rectangle) {
  return first.left < second.right && second.left < first.right &&
    first.top < second.bottom && second.top < first.bottom;
}

function rectangle({ x, y }: Point, halfWidth: number, halfHeight: number): Rectangle {
  return { left: x - halfWidth, top: y - halfHeight, right: x + halfWidth, bottom: y + halfHeight };
}

function shortenTitle(title: string, limit: number) {
  const characters = Array.from(title);
  if (characters.length <= limit) return title;
  const suffixSize = Math.floor(limit / 3);
  return characters.slice(0, limit - suffixSize - 1).join("") + "…" + characters.slice(-suffixSize).join("");
}

function paddedLabelSize(title: string, fontSize: number) {
  const ems = Array.from(title).reduce((width, character) => {
    if (character === " ") return width + 0.4;
    if (/[\u0021-\u007e]/.test(character) && !/[MW@%&]/.test(character)) return width + 0.8;
    return width + 1.1;
  }, 0);
  return { halfWidth: Math.ceil(ems * fontSize / 2) + 4, halfHeight: fontSize / 2 + 5 };
}

export function placeGraphLabels(
  nodes: NodeLabel[],
  relations: RelationLabel[],
  selectedKey: string | undefined,
  labelLimit: number
) {
  const occupied = nodes.map((node) => rectangle(node, node.radius + 3, node.radius + 3));
  const labels = new Map<string, PlacedLabel>();

  function place(key: string, title: string, size: ReturnType<typeof paddedLabelSize>, positions: Point[]) {
    for (const point of positions) {
      const box = rectangle(point, size.halfWidth, size.halfHeight);
      if (box.left < graphViewBox.left || box.top < graphViewBox.top ||
          box.right > graphViewBox.right || box.bottom > graphViewBox.bottom ||
          occupied.some((other) => overlaps(box, other))) continue;
      occupied.push(box);
      labels.set(key, { ...point, title, box });
      return;
    }
  }

  const selected = nodes.find((node) => node.key === selectedKey);
  const orderedNodes = selected ? [selected, ...nodes.filter((node) => node !== selected)] : nodes;
  for (const node of orderedNodes) {
    const title = shortenTitle(node.title, labelLimit);
    const size = paddedLabelSize(title, 11);
    const gap = node.radius + 5;
    place(node.key, title, size, [
      { x: node.x, y: node.y + gap + size.halfHeight },
      { x: node.x, y: node.y - gap - size.halfHeight },
      { x: node.x + gap + size.halfWidth, y: node.y },
      { x: node.x - gap - size.halfWidth, y: node.y }
    ]);
  }

  for (const relation of relations) {
    const size = paddedLabelSize(relation.title, 10);
    place(relation.key, relation.title, size, [
      { x: relation.x, y: relation.y - 7 },
      { x: relation.x, y: relation.y + 7 }
    ]);
  }

  return labels;
}

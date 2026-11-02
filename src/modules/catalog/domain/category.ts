/** Category aggregate: types and tree rules (pure, no I/O). */

export interface CategoryRecord {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  description: string | null;
  imageMediaId: string | null;
  menuMediaId: string | null;
  imageUrl: string | null;
  menuUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  productCount: number;
  childCount: number;
}

export interface CategoryNode extends CategoryRecord {
  depth: number;
  /** "Moda / Erkek / Kazak" */
  path: string;
  children: CategoryNode[];
}

export interface CategoryTree {
  tree: CategoryNode[];
  /** Depth-first order, as shown in the admin tree. */
  flat: CategoryNode[];
}

export interface CategoryInput {
  name: string;
  slug?: string;
  parentId?: string | null;
  description?: string | null;
  imageMediaId?: string | null;
  menuMediaId?: string | null;
  sortOrder: number;
  isActive: boolean;
}

export type CategoryPatch = Partial<CategoryInput>;

export interface ParentOption {
  id: string;
  name: string;
  depth: number;
  path: string;
}

const bySortThenName = (a: CategoryNode, b: CategoryNode) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "tr");

export function buildTree(records: CategoryRecord[]): CategoryTree {
  const nodes = new Map<string, CategoryNode>();
  for (const r of records) nodes.set(r.id, { ...r, depth: 0, path: r.name, children: [] });

  const roots: CategoryNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  for (const n of nodes.values()) n.children.sort(bySortThenName);
  roots.sort(bySortThenName);

  const flat: CategoryNode[] = [];
  const visit = (node: CategoryNode, depth: number, parentPath: string) => {
    node.depth = depth;
    node.path = parentPath ? `${parentPath} / ${node.name}` : node.name;
    flat.push(node);
    for (const c of node.children) visit(c, depth + 1, node.path);
  };
  for (const r of roots) visit(r, 0, "");
  return { tree: roots, flat };
}

/** Ids of `node` and everything below it. */
export function subtreeIds(node: CategoryNode): Set<string> {
  const ids = new Set<string>();
  const walk = (n: CategoryNode) => {
    ids.add(n.id);
    n.children.forEach(walk);
  };
  walk(node);
  return ids;
}

/** Categories `node` may be moved under without creating a cycle. */
export function parentOptionsFor(node: CategoryNode, flat: CategoryNode[]): ParentOption[] {
  const blocked = subtreeIds(node);
  return flat.filter((c) => !blocked.has(c.id)).map((c) => ({ id: c.id, name: c.name, depth: c.depth, path: c.path }));
}

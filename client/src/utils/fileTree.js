// 按相对路径分组，详情页与分享页共用同一棵目录结构。
export function buildFileTree(files) {
  const root = { name: '', path: '', children: new Map(), file: null };
  for (const file of files) {
    const parts = file.path.split('/');
    let node = root;
    parts.forEach((part, depth) => {
      const isLeaf = depth === parts.length - 1;
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, path: parts.slice(0, depth + 1).join('/'), children: new Map(), file: null });
      }
      node = node.children.get(part);
      if (isLeaf) node.file = file;
    });
  }
  return root;
}


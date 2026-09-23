export const folderLabels = {
  all: '全部技能',
  inbox: '收件箱',
  starred: '收藏',
  trash: '废纸篓',
  recent: '最近浏览',
};

// 系统视图中只有 inbox 是实际可存放技能的目录。
export function targetFolderForView(folder) {
  return Object.hasOwn(folderLabels, folder) && folder !== 'inbox' ? 'inbox' : folder;
}

// Единый экземпляр дерева + кодек для всего приложения
import raw from '../../data/data.json';
import { buildTree } from './tree.js';
import { makeCodecCtx, encodeTree, encodeOfficial, parseAnyLink, makeLink } from './codec.js';
import { settings } from '../store.js';

export const tree = buildTree(raw);
export const codecCtx = makeCodecCtx(tree);

export function shareLink(t, { withName = false, robust = false } = {}) {
  const code = encodeTree(
    { nodeIds: t.nodes.filter((id) => id !== tree.startId), choices: t.choices || {}, name: withName ? t.name : '' },
    codecCtx,
    { compact: !robust },
  );
  return makeLink(code, settings.get('linkBase', ''));
}

export function officialLink(t) {
  const code = encodeOfficial({ nodeIds: t.nodes.filter((id) => id !== tree.startId), choices: t.choices || {} });
  return 'https://www.pathofexile.com/fullscreen-atlas-skill-tree/' + code;
}

export function parseLink(input) {
  return parseAnyLink(input, codecCtx);
}

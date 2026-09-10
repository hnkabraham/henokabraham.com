declare const __SCENE_VERSION__: string;

export function sceneAsset(path: string): string {
  return typeof __SCENE_VERSION__ !== 'undefined' && __SCENE_VERSION__
    ? `/scene/${__SCENE_VERSION__}${path}`
    : path;
}

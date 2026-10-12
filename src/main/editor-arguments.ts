// A dedicated workspace window preserves existing windows and unsaved buffers.
export function editorArguments(root:string,file:string,line:number){
  return ['--new-window',root,'--goto',`${file}:${line}:1`];
}

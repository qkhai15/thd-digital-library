// Only public document IDs are retained on this device. No identity or reading
// activity is sent to a separate server-side history/analytics endpoint.
export type LibraryShelf = 'saved' | 'recent';
const keys = {saved:'thd-library:saved:v1',recent:'thd-library:recent:v1'};
const empty: readonly number[] = Object.freeze([]);
const isDocumentId=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<=2147483647;
const snapshots: Record<LibraryShelf,{raw:string|null;ids:readonly number[]}> = {
  saved:{raw:null,ids:empty},recent:{raw:null,ids:empty},
};
export function validDocumentIds(value:unknown,limit=100):number[] {
  if(!Array.isArray(value))return [];
  return [...new Set(value.filter(isDocumentId))].slice(0,limit);
}
export function shelfSnapshot(shelf:LibraryShelf):readonly number[] {
  if(typeof window==='undefined')return empty;
  try {
    const raw=window.localStorage.getItem(keys[shelf]);
    if(raw===snapshots[shelf].raw)return snapshots[shelf].ids;
    let ids:number[]=[];
    try {if(raw&&raw.length>4096)throw new Error('Invalid device data');ids=validDocumentIds(JSON.parse(raw||'[]'),shelf==='recent'?20:100);}catch { /* Invalid device data is ignored. */ }
    snapshots[shelf]={raw,ids};return ids;
  }catch {return empty;}
}
export function emptyShelfSnapshot(){return empty;}
export function subscribeShelf(listener:()=>void){
  window.addEventListener('storage',listener);window.addEventListener('thd-shelf',listener);
  return ()=>{window.removeEventListener('storage',listener);window.removeEventListener('thd-shelf',listener);};
}
function writeShelf(shelf:LibraryShelf,ids:readonly number[]){
  try {window.localStorage.setItem(keys[shelf],JSON.stringify(ids));window.dispatchEvent(new Event('thd-shelf'));return true;}catch{return false;}
}
export function toggleSaved(id:number){
  if(!isDocumentId(id))return false;
  const ids=shelfSnapshot('saved');
  return writeShelf('saved',ids.includes(id)?ids.filter(value=>value!==id):[id,...ids].slice(0,100));
}
export function rememberDocument(id:number){
  if(!isDocumentId(id))return false;
  return writeShelf('recent',[id,...shelfSnapshot('recent').filter(value=>value!==id)].slice(0,20));
}
export function removeSaved(id:number){return writeShelf('saved',shelfSnapshot('saved').filter(value=>value!==id));}
export function clearRecent(){return writeShelf('recent',[]);}

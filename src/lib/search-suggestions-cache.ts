import type { LibraryItem } from "@/lib/library-types";

type Suggestion=Pick<LibraryItem,"id"|"title"|"author"|"type">;
type CacheState={revision:number;items:Map<string,{at:number;items:Suggestion[]}>};
// Next route bundles share this process-local cache through globalThis. Current
// Railway has one replica; multiple replicas would need shared invalidation.
const globalCache=globalThis as typeof globalThis&{thdSearchSuggestions?:CacheState};
const cache=globalCache.thdSearchSuggestions??={revision:0,items:new Map()};

export function searchSuggestionsRevision(){return cache.revision;}
export function cachedSearchSuggestions(query:string,now=Date.now()) {
  const entry=cache.items.get(query);
  if(entry&&now-entry.at<30000)return entry.items;
  if(entry)cache.items.delete(query);
  return null;
}
export function cacheSearchSuggestions(query:string,items:Suggestion[],revision:number,now=Date.now()) {
  // An in-flight lookup started before an Admin mutation must not repopulate
  // stale titles after the cache has been invalidated.
  if(revision!==cache.revision)return;
  if(cache.items.size>=256)cache.items.delete(cache.items.keys().next().value!);
  cache.items.set(query,{at:now,items:items.slice(0,6)});
}
export function invalidateSearchSuggestions(){cache.items.clear();cache.revision++;}

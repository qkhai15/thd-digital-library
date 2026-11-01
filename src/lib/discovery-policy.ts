export type DiscoverySettings={collections:boolean;grades:boolean;subjects:boolean;recommended:boolean;featured_collection_ids:number[]};
export const DEFAULT_DISCOVERY:DiscoverySettings={collections:true,grades:true,subjects:true,recommended:false,featured_collection_ids:[]};
export function discoverySettings(value:unknown,strict=false):DiscoverySettings{
  if(!value||typeof value!=='object'||Array.isArray(value)){if(strict)throw new Error('Cài đặt khám phá không hợp lệ.');return {...DEFAULT_DISCOVERY};}
  const input=value as Record<string,unknown>;
  const output={...DEFAULT_DISCOVERY};
  for(const field of ['collections','grades','subjects','recommended'] as const){
    if(input[field]===undefined)continue;
    if(typeof input[field]!=='boolean'){if(strict)throw new Error('Cài đặt hiển thị phải là bật hoặc tắt.');continue;}
    output[field]=input[field];
  }
  if(input.featured_collection_ids!==undefined){
    const ids=input.featured_collection_ids;
    if(!Array.isArray(ids)||ids.length>6||ids.some(id=>!Number.isSafeInteger(id)||id<=0)||new Set(ids).size!==ids.length){if(strict)throw new Error('Chọn tối đa 6 bộ sưu tập, không trùng nhau.');}
    else output.featured_collection_ids=ids;
  }
  return output;
}

import {catalogGet,catalogMutation} from '@/lib/catalog-admin';
export const GET=()=>catalogGet('subjects');
export const POST=(request:Request)=>catalogMutation(request,'subjects');

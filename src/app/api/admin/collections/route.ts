import {catalogGet,catalogMutation} from '@/lib/catalog-admin';
export const GET=()=>catalogGet('collections');
export const POST=(request:Request)=>catalogMutation(request,'collections');

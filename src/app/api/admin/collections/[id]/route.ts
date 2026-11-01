import {catalogMutation} from '@/lib/catalog-admin';
type Context={params:Promise<{id:string}>};
export async function PUT(request:Request,{params}:Context){return catalogMutation(request,'collections',(await params).id);}
export const DELETE=PUT;

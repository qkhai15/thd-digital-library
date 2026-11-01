import {NextResponse} from 'next/server';
import {getCollection} from '@/lib/catalog';
export async function GET(_request:Request,{params}:{params:Promise<{slug:string}>}){const collection=await getCollection((await params).slug);return collection?NextResponse.json(collection):NextResponse.json({message:'Không tìm thấy bộ sưu tập.'},{status:404});}

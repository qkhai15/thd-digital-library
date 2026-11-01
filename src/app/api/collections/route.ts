import {NextResponse} from 'next/server';
import {getCollections} from '@/lib/catalog';
export async function GET(){return NextResponse.json(await getCollections());}

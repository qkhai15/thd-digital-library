import {NextResponse} from 'next/server';
import {getSubjects} from '@/lib/catalog';
export async function GET(){return NextResponse.json(await getSubjects());}

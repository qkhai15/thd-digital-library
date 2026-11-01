import {NextResponse} from 'next/server';
import QRCode from 'qrcode';
import {getItemById} from '@/lib/library-repository';
import {getItemHref} from '@/lib/library-url';
import {publicUrl} from '@/lib/public-metadata';
import {ACTIVE_LIBRARY_TYPES} from '@/lib/library-types';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  const {id}=await params;
  if(!/^\d{1,10}$/.test(id)||Number(id)>2147483647)return NextResponse.json({message:'Không tìm thấy tài liệu.'},{status:404});
  const format=new URL(request.url).searchParams.get('format')||'svg';
  if(!['svg','png'].includes(format))return NextResponse.json({message:'Định dạng QR không hợp lệ.'},{status:400});
  const item=await getItemById(Number(id));
  if(!item||!ACTIVE_LIBRARY_TYPES.includes(item.type))return NextResponse.json({message:'Không tìm thấy tài liệu.'},{status:404});
  // Only a published document fetched by ID supplies the destination. There is
  // deliberately no arbitrary URL input, redirect or Storage write.
  const value=publicUrl(getItemHref(item));
  const headers={'Content-Type':format==='svg'?'image/svg+xml':'image/png','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`inline; filename="tai-lieu-${item.id}-qr.${format}"`};
  if(format==='svg')return new Response(await QRCode.toString(value,{type:'svg',errorCorrectionLevel:'M',margin:4,width:320}),{headers});
  return new Response(new Uint8Array(await QRCode.toBuffer(value,{type:'png',errorCorrectionLevel:'M',margin:4,width:640})),{headers});
}

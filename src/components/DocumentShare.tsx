'use client';
import {useRef,useState} from 'react';
import {Copy,QrCode,Share2,X} from 'lucide-react';
import styles from './DocumentShare.module.css';
export default function DocumentShare({id,title,url}:{id:number;title:string;url:string}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [message,setMessage]=useState('');
  const [qrOpen,setQrOpen]=useState(false);const [qrState,setQrState]=useState('loading');const [attempt,setAttempt]=useState(0);
  function open(){setQrOpen(true);setQrState('loading');dialog.current?.showModal();}
  async function copy(){try{await navigator.clipboard.writeText(url);setMessage('Đã sao chép liên kết.');}catch{setMessage('Hãy chọn và sao chép liên kết trong ô bên dưới.');if(!dialog.current?.open)open();}}
  async function share(){if(navigator.share){try{await navigator.share({title,url});}catch(error){if(!(error instanceof Error&&error.name==='AbortError'))setMessage('Chia sẻ chưa thực hiện được. Bạn có thể sao chép liên kết.');}}else await copy();}
  return <><button className="action-chip" onClick={copy}><Copy size={17}/>Sao chép liên kết</button><button className="action-chip" onClick={share}><Share2 size={17}/>Chia sẻ</button><button className="action-chip" onClick={open}><QrCode size={17}/>Mã QR</button><span role="status">{message}</span>
    <dialog ref={dialog} className={styles.dialog} aria-labelledby={`share-title-${id}`} onClose={()=>setQrOpen(false)} onClick={event=>{if(event.target===event.currentTarget)dialog.current?.close();}}>
      <button className={styles.close} aria-label="Đóng mã QR" onClick={()=>dialog.current?.close()}><X/></button><h2 id={`share-title-${id}`}>Chia sẻ tài liệu</h2><p>{title}</p>
      {/* Dynamic same-origin SVG is intentionally displayed as an ordinary image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {qrOpen&&<img className={styles.qr} src={`/api/library/${id}/qr?retry=${attempt}`} alt={`Mã QR mở ${title}`} width="320" height="320" onLoad={()=>setQrState('ready')} onError={()=>setQrState('error')}/>}
      {qrState==='loading'&&qrOpen&&<p role="status">Đang tạo mã QR…</p>}
      {qrState==='error'&&<div><p role="alert">Chưa thể tải mã QR. Bạn vẫn có thể sao chép liên kết.</p><button className="action-chip" onClick={()=>{setQrState('loading');setAttempt(value=>value+1);}}>Thử lại mã QR</button></div>}
      <label className={styles.link}>Liên kết tài liệu<input readOnly value={url} onFocus={event=>event.target.select()}/></label><div className={styles.actions}><button className="action-chip" onClick={copy}>Sao chép</button><a className="action-chip" href={`/api/library/${id}/qr?format=png`} download={`tai-lieu-${id}-qr.png`}>Tải QR PNG</a></div>
    </dialog>
  </>;
}

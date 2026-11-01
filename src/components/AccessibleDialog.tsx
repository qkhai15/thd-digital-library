'use client';
import {useEffect,useRef,type ReactNode} from 'react';
import styles from './DocumentShare.module.css';
export default function AccessibleDialog({label,onClose,children}:{label:string;onClose:()=>void;children:ReactNode}){
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();return ()=>{if(previous instanceof HTMLElement)previous.focus();};},[]);
  return <dialog ref={ref} className={styles.dialog} aria-label={label} onCancel={onClose} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>{children}</dialog>;
}

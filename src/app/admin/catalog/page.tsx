import {redirect} from 'next/navigation';
import {isAdmin} from '@/lib/admin-auth';
import AdminCatalogClient from './AdminCatalogClient';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isAdmin())redirect('/admin/login');return <AdminCatalogClient/>;}

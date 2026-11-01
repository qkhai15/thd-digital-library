import {redirect} from 'next/navigation';
import {isAdmin} from '@/lib/admin-auth';
import {homepageDiscovery} from '@/lib/site-settings';
import {getCollections} from '@/lib/catalog';
import DiscoverySettingsClient from './DiscoverySettingsClient';
export const dynamic='force-dynamic';
export default async function Page(){if(!await isAdmin())redirect('/admin/login');const [settings,collections]=await Promise.all([homepageDiscovery(),getCollections({admin:true})]);return <DiscoverySettingsClient initial={settings} collections={collections}/>;}

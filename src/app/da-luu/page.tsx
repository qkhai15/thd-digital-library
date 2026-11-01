import LibraryShell from '@/components/LibraryShell';
import {DeviceLibrary} from '@/components/DeviceLibrary';
import {publicMetadata} from '@/lib/public-metadata';
export const metadata={...publicMetadata({title:'Tài liệu đã lưu và đã xem',path:'/da-luu'}),robots:{index:false,follow:true}};
export default function Page(){return <LibraryShell><main className="flow-page"><div className="container"><h1>Thư viện trên thiết bị của bạn</h1><DeviceLibrary shelf="saved"/><DeviceLibrary shelf="recent"/></div></main></LibraryShell>;}

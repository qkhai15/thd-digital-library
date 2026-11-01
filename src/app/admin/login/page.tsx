import Link from "next/link";

export default async function AdminLogin({searchParams}:{searchParams:Promise<{error?:string}>}){
  const {error}=await searchParams;
  return <main className="admin-login-page"><div className="admin-login-card"><Link href="/" className="back-home">← Về trang chủ</Link><span>THƯ VIỆN ĐIỆN TỬ</span><h1>Đăng nhập quản trị</h1><p>Quản lý tài liệu, ảnh bìa, PDF, sách nói, video và album.</p>{error&&<div className="login-error">Sai tài khoản hoặc mật khẩu.</div>}<form action="/api/admin/login" method="post"><label>Tài khoản<input name="username" defaultValue="admin" autoComplete="username" required/></label><label>Mật khẩu<input name="password" type="password" autoComplete="current-password" required/></label><button>Đăng nhập</button></form></div></main>
}
